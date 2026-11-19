-- ==============================================================================
-- MIGRATION 6 — FASE 3: ONBOARDING DO DONO
-- Rode DEPOIS de 20261119000100_intervalo_retorno.sql. Pode ser reexecutada.
--
-- O que muda:
--   1. "Carregar modelo": categorias e procedimentos de exemplo (INATIVOS, o dono
--      revisa e ativa) e horários padrão. Pode ser pedido ao criar a clínica
--      (create_clinic ganha p_load_template) ou depois, pelo dono (load_clinic_template).
--   2. Publicação do link de agendamento: clinics.booking_published. Enquanto for
--      FALSE, clientes não entram na clínica nem agendam (a equipe continua usando
--      o painel). O banco só deixa PUBLICAR se houver ao menos 1 profissional ativo,
--      1 horário ativo (de profissional ativo) e 1 procedimento ativo.
--   3. clinic_setup_status(): contagens para o checklist "Primeiros passos".
--
-- Clínicas que JÁ existem continuam abertas (booking_published = TRUE só na primeira
-- execução desta migration); as criadas daqui em diante nascem fechadas.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. COLUNAS
-- ------------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'clinics' AND column_name = 'booking_published'
    ) THEN
        ALTER TABLE public.clinics ADD COLUMN booking_published BOOLEAN NOT NULL DEFAULT FALSE;
        -- Só na primeira execução: quem já operava não pode "fechar" de repente.
        UPDATE public.clinics SET booking_published = TRUE;
    END IF;
END $$;

-- Jornada padrão da clínica (usada ao cadastrar novos profissionais). NULL = padrão do app.
ALTER TABLE public.clinics ADD COLUMN IF NOT EXISTS default_working_hours JSONB;

COMMENT ON COLUMN public.clinics.booking_published IS
    'FALSE = link de agendamento fechado para clientes. Só vira TRUE com 1 profissional, 1 horário e 1 procedimento ativos.';
COMMENT ON COLUMN public.clinics.default_working_hours IS
    'Jornada semanal padrão (array de 7 objetos day_of_week/start_time/end_time/break_*/is_active) aplicada a novos profissionais.';

-- ------------------------------------------------------------------------------
-- 2. REQUISITOS PARA PUBLICAR
-- ------------------------------------------------------------------------------

-- Contagens (sem checagem de permissão: uso interno por gatilhos e funções abaixo)
CREATE OR REPLACE FUNCTION public.clinic_setup_counts(p_clinic UUID)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT jsonb_build_object(
        'professionals', (SELECT count(*) FROM public.professionals p
                           WHERE p.clinic_id = p_clinic AND p.is_active),
        'hours', (SELECT count(*) FROM public.professional_working_hours w
                    JOIN public.professionals p ON p.id = w.professional_id AND p.clinic_id = w.clinic_id
                   WHERE w.clinic_id = p_clinic AND w.is_active AND p.is_active),
        'services', (SELECT count(*) FROM public.services s
                      WHERE s.clinic_id = p_clinic AND s.is_active)
    );
$$;

CREATE OR REPLACE FUNCTION public.clinic_is_ready(p_clinic UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT (c->>'professionals')::int >= 1 AND (c->>'hours')::int >= 1 AND (c->>'services')::int >= 1
      FROM (SELECT public.clinic_setup_counts(p_clinic) AS c) x;
$$;

-- Estado do checklist para o painel do dono
CREATE OR REPLACE FUNCTION public.clinic_setup_status(p_clinic_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_counts JSONB;
    v_published BOOLEAN;
BEGIN
    IF NOT (public.is_clinic_staff(p_clinic_id) OR public.is_platform_admin()) THEN
        RAISE EXCEPTION 'Sem acesso a esta clínica.' USING ERRCODE = '42501';
    END IF;
    SELECT booking_published INTO v_published FROM public.clinics WHERE id = p_clinic_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Clínica não encontrada.';
    END IF;
    v_counts := public.clinic_setup_counts(p_clinic_id);
    RETURN v_counts || jsonb_build_object(
        'ready', public.clinic_is_ready(p_clinic_id),
        'published', v_published
    );
END;
$$;

-- ------------------------------------------------------------------------------
-- 3. TRAVAS NO BANCO
-- ------------------------------------------------------------------------------

-- 3.1 Publicar exige os requisitos (vale para dono, plataforma e SQL Editor).
--     Mantém as regras anteriores: slug e suspensão só pela plataforma.
CREATE OR REPLACE FUNCTION public.guard_clinic_update()
RETURNS TRIGGER AS $$
BEGIN
    IF auth.uid() IS NOT NULL AND NOT public.is_platform_admin() THEN
        IF NEW.slug IS DISTINCT FROM OLD.slug OR NEW.is_active IS DISTINCT FROM OLD.is_active THEN
            RAISE EXCEPTION 'Endereço (slug) e status da clínica só podem ser alterados pelo administrador da plataforma.'
                USING ERRCODE = '42501';
        END IF;
    END IF;

    IF NEW.booking_published AND NOT OLD.booking_published AND NOT public.clinic_is_ready(NEW.id) THEN
        RAISE EXCEPTION 'Para publicar o link de agendamento, cadastre ao menos 1 profissional ativo, 1 horário de atendimento e 1 procedimento ativo.'
            USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- 3.2 Com o link fechado, cliente não agenda (a equipe pode agendar normalmente).
CREATE OR REPLACE FUNCTION public.guard_booking_published()
RETURNS TRIGGER AS $$
BEGIN
    IF auth.uid() IS NOT NULL
       AND NOT public.is_clinic_staff(NEW.clinic_id)
       AND NOT EXISTS (SELECT 1 FROM public.clinics c WHERE c.id = NEW.clinic_id AND c.booking_published) THEN
        RAISE EXCEPTION 'O agendamento online desta clínica ainda não foi aberto. Fale diretamente com a clínica.'
            USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS tr_appointments_guard_published ON public.appointments;
CREATE TRIGGER tr_appointments_guard_published BEFORE INSERT ON public.appointments
    FOR EACH ROW EXECUTE FUNCTION public.guard_booking_published();

-- 3.3 Com o link fechado, ninguém novo entra como CLIENTE (equipe e convites seguem valendo;
--     a rota /api/admin/create-client usa service_role e não é afetada).
CREATE OR REPLACE FUNCTION public.guard_member_join_published()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.role = 'CLIENT'
       AND auth.uid() IS NOT NULL
       AND NOT public.is_platform_admin()
       AND NOT EXISTS (SELECT 1 FROM public.clinics c WHERE c.id = NEW.clinic_id AND c.booking_published) THEN
        RAISE EXCEPTION 'Esta clínica ainda não abriu o agendamento online. Se você é a dona, confirme o e-mail do convite e entre novamente.'
            USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS tr_members_guard_published ON public.clinic_members;
CREATE TRIGGER tr_members_guard_published BEFORE INSERT ON public.clinic_members
    FOR EACH ROW EXECUTE FUNCTION public.guard_member_join_published();

-- ------------------------------------------------------------------------------
-- 4. DADOS PÚBLICOS: o app precisa saber se o link está aberto
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_clinic_public(p_slug TEXT)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT jsonb_build_object(
        'id', c.id, 'slug', c.slug, 'name', c.name, 'tagline', c.tagline,
        'hero_badge', c.hero_badge, 'hero_title', c.hero_title, 'hero_subtitle', c.hero_subtitle,
        'logo_url', c.logo_url, 'primary_color', c.primary_color,
        'phone', c.phone, 'whatsapp', c.whatsapp, 'address', c.address,
        'is_active', c.is_active, 'booking_published', c.booking_published
    )
      FROM public.clinics c
     WHERE c.slug = lower(trim(p_slug));
$$;

-- ------------------------------------------------------------------------------
-- 5. MODELO: categorias, procedimentos de exemplo (inativos) e horários padrão
-- ------------------------------------------------------------------------------

-- Interna: sem checagem de permissão (quem chama já validou). Idempotente: nunca
-- sobrescreve nem duplica o que a clínica já tem.
CREATE OR REPLACE FUNCTION public.seed_clinic_template(p_clinic UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_hours CONSTANT JSONB := '[
        {"day_of_week":"SUNDAY",    "start_time":"09:00","end_time":"18:00","break_start_time":"12:00","break_end_time":"13:00","is_active":false},
        {"day_of_week":"MONDAY",    "start_time":"09:00","end_time":"18:00","break_start_time":"12:00","break_end_time":"13:00","is_active":true},
        {"day_of_week":"TUESDAY",   "start_time":"09:00","end_time":"18:00","break_start_time":"12:00","break_end_time":"13:00","is_active":true},
        {"day_of_week":"WEDNESDAY", "start_time":"09:00","end_time":"18:00","break_start_time":"12:00","break_end_time":"13:00","is_active":true},
        {"day_of_week":"THURSDAY",  "start_time":"09:00","end_time":"18:00","break_start_time":"12:00","break_end_time":"13:00","is_active":true},
        {"day_of_week":"FRIDAY",    "start_time":"09:00","end_time":"18:00","break_start_time":"12:00","break_end_time":"13:00","is_active":true},
        {"day_of_week":"SATURDAY",  "start_time":"09:00","end_time":"13:00","break_start_time":null,   "break_end_time":null,   "is_active":false}
    ]'::jsonb;
    v_cats INT := 0;
    v_services INT := 0;
    v_pros_with_hours INT := 0;
    v_n INT;
BEGIN
    -- Categorias
    INSERT INTO public.service_categories (clinic_id, name, slug, description, display_order, icon_name) VALUES
        (p_clinic, 'Facial', 'facial', 'Limpeza, hidratação e renovação da pele.', 1, 'Sparkles'),
        (p_clinic, 'Corporal', 'corporal', 'Drenagem, massagens e remodelagem corporal.', 2, 'Activity'),
        (p_clinic, 'Injetáveis & Harmonização', 'injetaveis', 'Procedimentos injetáveis com profissional habilitado.', 3, 'Syringe'),
        (p_clinic, 'Tecnologias & Laser', 'laser', 'Depilação a laser e tratamentos com tecnologia.', 4, 'Zap')
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_cats = ROW_COUNT;

    -- Procedimentos de exemplo: INATIVOS (preços e durações são só sugestão; o dono revisa e ativa)
    INSERT INTO public.services
        (clinic_id, category_id, name, slug, description, duration_minutes, price_cents, return_interval_days, is_active)
    SELECT p_clinic, c.id, t.name, t.slug, t.description, t.duration, t.price, t.return_days, FALSE
      FROM (VALUES
        ('facial',     'Limpeza de Pele Profunda',         'modelo-limpeza-de-pele',    'Higienização, extração e máscara calmante.',                60, 18000, 30),
        ('facial',     'Peeling de Diamante',               'modelo-peeling-diamante',   'Esfoliação mecânica para renovar a textura da pele.',       45, 15000, 30),
        ('facial',     'Hidratação Facial',                 'modelo-hidratacao-facial',  'Reposição de hidratação com ativos de acordo com a pele.',  50, 14000, 21),
        ('corporal',   'Drenagem Linfática',                'modelo-drenagem-linfatica', 'Massagem para reduzir inchaço e retenção de líquidos.',     60, 12000, 15),
        ('corporal',   'Massagem Modeladora',               'modelo-massagem-modeladora','Massagem de manobras vigorosas para contorno corporal.',     50, 13000, 15),
        ('injetaveis', 'Avaliação de Harmonização',         'modelo-avaliacao-harmonizacao', 'Consulta para avaliar e planejar o tratamento.',            30,     0, NULL),
        ('laser',      'Depilação a Laser — Axilas',        'modelo-laser-axilas',       'Sessão de depilação a laser nas axilas.',                   20,  9000, 30),
        ('laser',      'Depilação a Laser — Pernas',        'modelo-laser-pernas',       'Sessão de depilação a laser nas pernas completas.',         60, 28000, 30)
      ) AS t(cat_slug, name, slug, description, duration, price, return_days)
      JOIN public.service_categories c ON c.clinic_id = p_clinic AND c.slug = t.cat_slug
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_services = ROW_COUNT;

    -- Vincula os exemplos aos profissionais ativos já cadastrados (poupa o trabalho de vincular um a um)
    INSERT INTO public.professional_services (clinic_id, professional_id, service_id)
    SELECT p_clinic, p.id, s.id
      FROM public.professionals p
      CROSS JOIN public.services s
     WHERE p.clinic_id = p_clinic AND p.is_active
       AND s.clinic_id = p_clinic AND s.slug LIKE 'modelo-%'
    ON CONFLICT DO NOTHING;

    -- Horários padrão: ficam na clínica (novos profissionais já nascem com eles)...
    UPDATE public.clinics SET default_working_hours = v_hours
     WHERE id = p_clinic AND default_working_hours IS NULL;

    -- ...e valem para quem já está cadastrado e ainda não tem nenhum horário.
    INSERT INTO public.professional_working_hours
        (clinic_id, professional_id, day_of_week, start_time, end_time, break_start_time, break_end_time, is_active)
    SELECT p_clinic, p.id, (h->>'day_of_week')::public.day_of_week,
           (h->>'start_time')::time, (h->>'end_time')::time,
           NULLIF(h->>'break_start_time', '')::time, NULLIF(h->>'break_end_time', '')::time,
           (h->>'is_active')::boolean
      FROM public.professionals p
      CROSS JOIN jsonb_array_elements(v_hours) h
     WHERE p.clinic_id = p_clinic AND p.is_active
       AND NOT EXISTS (SELECT 1 FROM public.professional_working_hours w WHERE w.professional_id = p.id)
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_pros_with_hours := v_n / 7;

    RETURN jsonb_build_object(
        'categories_added', v_cats,
        'services_added', v_services,
        'professionals_with_new_hours', v_pros_with_hours
    );
END;
$$;

-- Pública (RPC): o dono carrega o modelo na própria clínica
CREATE OR REPLACE FUNCTION public.load_clinic_template(p_clinic_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF auth.uid() IS NOT NULL AND NOT (public.is_clinic_admin(p_clinic_id) OR public.is_platform_admin()) THEN
        RAISE EXCEPTION 'Apenas o administrador da clínica pode carregar o modelo.' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.clinics WHERE id = p_clinic_id) THEN
        RAISE EXCEPTION 'Clínica não encontrada.';
    END IF;
    RETURN public.seed_clinic_template(p_clinic_id);
END;
$$;

-- ------------------------------------------------------------------------------
-- 6. create_clinic: agora com a opção de carregar o modelo (e nasce com o link FECHADO)
-- ------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.create_clinic(TEXT, TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.create_clinic(
    p_slug TEXT,
    p_name TEXT,
    p_owner_email TEXT,
    p_primary_color TEXT DEFAULT '#e11d48',
    p_phone TEXT DEFAULT '',
    p_load_template BOOLEAN DEFAULT FALSE
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_slug TEXT := lower(trim(p_slug));
    v_email TEXT := lower(trim(p_owner_email));
    v_id UUID;
    v_owner UUID;
BEGIN
    IF auth.uid() IS NOT NULL AND NOT public.is_platform_admin() THEN
        RAISE EXCEPTION 'Apenas o administrador da plataforma pode criar clínicas.' USING ERRCODE = '42501';
    END IF;
    IF v_slug !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$' THEN
        RAISE EXCEPTION 'Endereço inválido: use letras minúsculas, números e hífen (ex.: clinica-bella).';
    END IF;
    IF v_slug = ANY (ARRAY['www', 'app', 'api', 'admin', 'plataforma', 'painel', 'login', 'mail', 'static', 'assets']) THEN
        RAISE EXCEPTION 'O endereço "%" é reservado.', v_slug;
    END IF;
    IF EXISTS (SELECT 1 FROM public.clinics WHERE slug = v_slug) THEN
        RAISE EXCEPTION 'Já existe uma clínica com o endereço "%".', v_slug;
    END IF;
    IF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
        RAISE EXCEPTION 'E-mail do dono inválido.';
    END IF;
    IF COALESCE(trim(p_name), '') = '' THEN
        RAISE EXCEPTION 'Informe o nome da clínica.';
    END IF;

    INSERT INTO public.clinics (slug, name, primary_color, phone, whatsapp, booking_published)
    VALUES (v_slug, trim(p_name), COALESCE(p_primary_color, '#e11d48'), COALESCE(p_phone, ''), COALESCE(p_phone, ''), FALSE)
    RETURNING id INTO v_id;

    -- Categorias iniciais (o dono edita, apaga ou cria outras); com o modelo, vêm também
    -- os procedimentos de exemplo (inativos) e os horários padrão.
    INSERT INTO public.service_categories (clinic_id, name, slug, description, display_order, icon_name) VALUES
        (v_id, 'Facial', 'facial', 'Limpeza, hidratação e renovação da pele.', 1, 'Sparkles'),
        (v_id, 'Corporal', 'corporal', 'Drenagem, massagens e remodelagem corporal.', 2, 'Activity'),
        (v_id, 'Injetáveis & Harmonização', 'injetaveis', 'Procedimentos injetáveis com profissional habilitado.', 3, 'Syringe'),
        (v_id, 'Tecnologias & Laser', 'laser', 'Depilação a laser e tratamentos com tecnologia.', 4, 'Zap');

    IF COALESCE(p_load_template, FALSE) THEN
        PERFORM public.seed_clinic_template(v_id);
    END IF;

    -- Dono: vínculo imediato se já tem conta; senão, convite aplicado no primeiro acesso.
    SELECT id INTO v_owner FROM public.profiles WHERE lower(email) = v_email;
    IF v_owner IS NOT NULL THEN
        INSERT INTO public.clinic_members (clinic_id, user_id, role) VALUES (v_id, v_owner, 'ADMIN');
    ELSE
        INSERT INTO public.clinic_invites (clinic_id, email, role) VALUES (v_id, v_email, 'ADMIN');
    END IF;

    RETURN v_id;
END;
$$;

-- Painel da plataforma: agora também mostra se o link está aberto
CREATE OR REPLACE FUNCTION public.platform_list_clinics()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF NOT public.is_platform_admin() THEN
        RAISE EXCEPTION 'Acesso restrito ao administrador da plataforma.' USING ERRCODE = '42501';
    END IF;

    RETURN COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'id', c.id, 'slug', c.slug, 'name', c.name, 'primary_color', c.primary_color,
            'is_active', c.is_active, 'booking_published', c.booking_published, 'created_at', c.created_at,
            'members', (SELECT count(*) FROM public.clinic_members m WHERE m.clinic_id = c.id),
            'appointments_30d', (SELECT count(*) FROM public.appointments a
                                  WHERE a.clinic_id = c.id AND a.created_at > now() - interval '30 days'),
            'owners', COALESCE((
                SELECT jsonb_agg(p.email) FROM public.clinic_members m
                  JOIN public.profiles p ON p.id = m.user_id
                 WHERE m.clinic_id = c.id AND m.role = 'ADMIN' AND m.is_active
            ), '[]'::jsonb),
            'pending_owner_invites', COALESCE((
                SELECT jsonb_agg(i.email) FROM public.clinic_invites i WHERE i.clinic_id = c.id AND i.role = 'ADMIN'
            ), '[]'::jsonb)
        ) ORDER BY c.created_at)
          FROM public.clinics c
    ), '[]'::jsonb);
END;
$$;

-- ------------------------------------------------------------------------------
-- 7. PERMISSÕES DE EXECUÇÃO
-- ------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.clinic_setup_counts(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.clinic_is_ready(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.seed_clinic_template(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.clinic_setup_status(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.load_clinic_template(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_clinic(TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.platform_list_clinics() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_clinic_public(TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.clinic_setup_status(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.load_clinic_template(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_clinic(TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_list_clinics() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_clinic_public(TEXT) TO anon, authenticated;
