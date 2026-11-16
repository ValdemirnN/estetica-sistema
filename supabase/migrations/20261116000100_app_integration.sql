-- ==============================================================================
-- MIGRATION 2 — INTEGRAÇÃO DO APP COM O SUPABASE
-- Rode DEPOIS de 20261104000100_initial_schema.sql.
--
-- O que esta migration faz:
--   1. Corrige falhas de segurança do schema inicial (escalada de privilégio,
--      trigger de signup que sobrescrevia o perfil a cada login, etc.)
--   2. Adiciona colunas/tabelas que o app precisa (configurações da clínica,
--      histórico de status, nome/foto do profissional, ícones, badges...)
--   3. Move as operações sensíveis para funções (RPC) que validam tudo no banco:
--      agendar, cancelar, mudar status, abrir anamnese com auditoria.
--   4. Completa as políticas de RLS que faltavam (ex.: professional_services
--      não tinha nenhuma política de leitura).
--   5. Carrega os dados-base da clínica (configurações, catálogo completo).
--
-- Fuso horário da clínica: America/Sao_Paulo.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. CORREÇÕES DE SEGURANÇA
-- ------------------------------------------------------------------------------

-- 1.1 Helpers de papel com search_path fixo
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS public.user_role AS $$
    SELECT role FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
    SELECT COALESCE(public.current_user_role() = 'ADMIN', FALSE);
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS BOOLEAN AS $$
    SELECT COALESCE(public.current_user_role() IN ('ADMIN', 'RECEPTIONIST', 'PROFESSIONAL'), FALSE);
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp;

-- 1.2 Signup: o papel NUNCA vem do cliente.
--     Antes, `role` era lido de raw_user_meta_data — qualquer pessoa podia se
--     cadastrar como ADMIN passando {"role":"ADMIN"} no signUp.
--     Também deixa de rodar em UPDATE de auth.users: antes, cada login
--     (que atualiza last_sign_in_at) reescrevia o nome do perfil.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, email, full_name, phone, role, avatar_url)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NULLIF(NEW.raw_user_meta_data->>'full_name', ''), NULLIF(NEW.raw_user_meta_data->>'name', ''), 'Novo Cliente'),
        COALESCE(NEW.raw_user_meta_data->>'phone', ''),
        'CLIENT',
        COALESCE(NEW.raw_user_meta_data->>'avatar_url', '')
    )
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 1.3 Perfil: usuário comum não pode alterar o próprio papel, status ou e-mail.
--     (A política de UPDATE deixava o usuário editar a própria linha inteira.)
--     Quem roda SQL pelo painel/service_role (auth.uid() nulo) continua livre.
CREATE OR REPLACE FUNCTION public.guard_profile_update()
RETURNS TRIGGER AS $$
BEGIN
    IF auth.uid() IS NOT NULL AND NOT public.is_admin() THEN
        IF NEW.id IS DISTINCT FROM OLD.id
           OR NEW.role IS DISTINCT FROM OLD.role
           OR NEW.is_active IS DISTINCT FROM OLD.is_active
           OR NEW.email IS DISTINCT FROM OLD.email THEN
            RAISE EXCEPTION 'Você não tem permissão para alterar papel, status ou e-mail do perfil.'
                USING ERRCODE = '42501';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS tr_profiles_guard ON public.profiles;
CREATE TRIGGER tr_profiles_guard
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.guard_profile_update();

-- ------------------------------------------------------------------------------
-- 2. COLUNAS E TABELAS QUE O APP PRECISA
-- ------------------------------------------------------------------------------

-- 2.1 Catálogo
ALTER TABLE public.service_categories ADD COLUMN IF NOT EXISTS icon_name VARCHAR(50) NOT NULL DEFAULT 'Sparkles';
ALTER TABLE public.services           ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE public.services           ADD COLUMN IF NOT EXISTS badge VARCHAR(50);

-- 2.2 Profissionais: nome de exibição, título e foto ficam na própria tabela,
--     pois `profiles` (CPF, telefone, e-mail) não pode ser público.
ALTER TABLE public.professionals ADD COLUMN IF NOT EXISTS name VARCHAR(150);
ALTER TABLE public.professionals ADD COLUMN IF NOT EXISTS title VARCHAR(150);
ALTER TABLE public.professionals ADD COLUMN IF NOT EXISTS avatar_url TEXT;

UPDATE public.professionals p
   SET name = pr.full_name
  FROM public.profiles pr
 WHERE pr.id = p.profile_id AND p.name IS NULL;

-- 2.3 Anamnese: tipo de pele cabia em 50 caracteres (ex.: "Fototipo III ... zona T" não cabe);
--     um único prontuário por cliente (permite upsert); flag de consentimento.
ALTER TABLE public.anamnesis_records ALTER COLUMN skin_type TYPE TEXT;
ALTER TABLE public.anamnesis_records ADD COLUMN IF NOT EXISTS signature_consent BOOLEAN NOT NULL DEFAULT FALSE;
CREATE UNIQUE INDEX IF NOT EXISTS uq_anamnesis_client ON public.anamnesis_records (client_id);

-- 2.4 Agendamentos: nota transitória usada pelo histórico de status
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS status_note TEXT;

-- 2.5 Configurações da clínica (linha única)
CREATE TABLE IF NOT EXISTS public.clinic_settings (
    id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
    name VARCHAR(150) NOT NULL,
    phone VARCHAR(30) NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    min_cancel_notice_hours INTEGER NOT NULL DEFAULT 24 CHECK (min_cancel_notice_hours >= 0),
    default_buffer_minutes INTEGER NOT NULL DEFAULT 15 CHECK (default_buffer_minutes >= 0),
    auto_assign_strategy VARCHAR(20) NOT NULL DEFAULT 'ROUND_ROBIN' CHECK (auto_assign_strategy IN ('ROUND_ROBIN', 'LEAST_BUSY')),
    working_days INTEGER[] NOT NULL DEFAULT '{1,2,3,4,5,6}',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);
ALTER TABLE public.clinic_settings ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS tr_clinic_settings_updated ON public.clinic_settings;
CREATE TRIGGER tr_clinic_settings_updated BEFORE UPDATE ON public.clinic_settings
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 2.6 Histórico de status dos agendamentos (preenchido por trigger, não pelo app)
CREATE TABLE IF NOT EXISTS public.appointment_status_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    appointment_id UUID NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
    status appointment_status NOT NULL,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    changed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    changed_by_name TEXT, -- cópia do nome no momento da mudança (clientes não leem perfis da equipe)
    note TEXT
);
CREATE INDEX IF NOT EXISTS idx_status_history_apt ON public.appointment_status_history (appointment_id, changed_at);
ALTER TABLE public.appointment_status_history ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.log_appointment_status()
RETURNS TRIGGER AS $$
DECLARE
    v_name TEXT;
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
        RETURN NEW;
    END IF;

    SELECT full_name || ' (' || role::text || ')' INTO v_name FROM public.profiles WHERE id = auth.uid();

    INSERT INTO public.appointment_status_history (appointment_id, status, changed_by, changed_by_name, note)
    VALUES (NEW.id, NEW.status, auth.uid(), COALESCE(v_name, 'Sistema'), NEW.status_note);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS tr_appointments_status_log ON public.appointments;
CREATE TRIGGER tr_appointments_status_log
    AFTER INSERT OR UPDATE OF status ON public.appointments
    FOR EACH ROW EXECUTE FUNCTION public.log_appointment_status();

-- ------------------------------------------------------------------------------
-- 3. POLÍTICAS DE RLS (substitui as frouxas e completa as que faltavam)
-- ------------------------------------------------------------------------------

-- 3.1 Agendamentos: cliente só LÊ. Criar/cancelar/mudar status só via RPC (seção 4),
--     para o cliente não conseguir definir o próprio preço, status ou profissional.
DROP POLICY IF EXISTS "Clientes criam seus próprios agendamentos" ON public.appointments;
DROP POLICY IF EXISTS "Clientes atualizam apenas seus agendamentos ou Staff" ON public.appointments;
DROP POLICY IF EXISTS "Staff atualiza agendamentos" ON public.appointments;
CREATE POLICY "Staff atualiza agendamentos"
    ON public.appointments FOR UPDATE
    USING (public.is_staff());

-- 3.2 Anamnese: só o próprio cliente lê/escreve direto. A equipe lê por RPC,
--     que registra o acesso no log de auditoria (antes dava para ler sem log).
DROP POLICY IF EXISTS "Cliente vê sua própria anamnese" ON public.anamnesis_records;
DROP POLICY IF EXISTS "Cliente preenche sua anamnese" ON public.anamnesis_records;
DROP POLICY IF EXISTS "Cliente ou Staff atualiza anamnese" ON public.anamnesis_records;
DROP POLICY IF EXISTS "Cliente atualiza sua anamnese" ON public.anamnesis_records;
CREATE POLICY "Cliente vê sua própria anamnese"
    ON public.anamnesis_records FOR SELECT USING (client_id = auth.uid());
CREATE POLICY "Cliente preenche sua anamnese"
    ON public.anamnesis_records FOR INSERT WITH CHECK (client_id = auth.uid());
CREATE POLICY "Cliente atualiza sua anamnese"
    ON public.anamnesis_records FOR UPDATE USING (client_id = auth.uid()) WITH CHECK (client_id = auth.uid());

-- Logs de auditoria só nascem dentro das RPCs (antes qualquer usuário podia inserir log falso)
DROP POLICY IF EXISTS "Apenas Staff insere logs de auditoria" ON public.anamnesis_access_logs;

-- 3.3 Leitura pública do que a grade de horários precisa
DROP POLICY IF EXISTS "Vínculos profissional-serviço visíveis" ON public.professional_services;
CREATE POLICY "Vínculos profissional-serviço visíveis"
    ON public.professional_services FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS "Configurações da clínica visíveis" ON public.clinic_settings;
CREATE POLICY "Configurações da clínica visíveis"
    ON public.clinic_settings FOR SELECT USING (TRUE);

-- 3.4 Escrita administrativa
DROP POLICY IF EXISTS "Admin altera configurações" ON public.clinic_settings;
CREATE POLICY "Admin altera configurações"
    ON public.clinic_settings FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admin gerencia categorias" ON public.service_categories;
CREATE POLICY "Admin gerencia categorias"
    ON public.service_categories FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admin gerencia profissionais" ON public.professionals;
CREATE POLICY "Admin gerencia profissionais"
    ON public.professionals FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admin gerencia vínculos profissional-serviço" ON public.professional_services;
CREATE POLICY "Admin gerencia vínculos profissional-serviço"
    ON public.professional_services FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admin gerencia jornadas" ON public.professional_working_hours;
CREATE POLICY "Admin gerencia jornadas"
    ON public.professional_working_hours FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admin gerencia ausências" ON public.professional_leaves;
CREATE POLICY "Admin gerencia ausências"
    ON public.professional_leaves FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- 3.5 Histórico de status: herda a visibilidade do agendamento (a RLS de appointments se aplica)
DROP POLICY IF EXISTS "Histórico visível a quem vê o agendamento" ON public.appointment_status_history;
CREATE POLICY "Histórico visível a quem vê o agendamento"
    ON public.appointment_status_history FOR SELECT
    USING (EXISTS (SELECT 1 FROM public.appointments a WHERE a.id = appointment_id));

-- ------------------------------------------------------------------------------
-- 4. FUNÇÕES (RPC) CHAMADAS PELO APP
-- ------------------------------------------------------------------------------

-- 4.1 Horários ocupados, SEM dados pessoais. O cliente não enxerga agendamentos
--     alheios (RLS), mas precisa saber quais horários já estão tomados.
CREATE OR REPLACE FUNCTION public.get_busy_slots(p_from TIMESTAMPTZ, p_to TIMESTAMPTZ)
RETURNS TABLE (professional_id UUID, start_time TIMESTAMPTZ, buffer_end_time TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT a.professional_id, a.start_time, a.buffer_end_time
      FROM public.appointments a
     WHERE auth.uid() IS NOT NULL
       AND a.status IN ('PENDING', 'CONFIRMED')
       AND a.start_time < p_to
       AND a.buffer_end_time > p_from;
$$;

-- 4.2 Agendar. Preço, duração, buffer e jornada vêm do banco, não do navegador.
--     p_professional_id NULL = "primeiro disponível" (distribuição por menor carga na semana).
--     Se dois clientes disputam o mesmo horário, a EXCLUDE constraint garante que só um
--     passa; o outro recebe o erro 23P01.
CREATE OR REPLACE FUNCTION public.book_appointment(
    p_service_id UUID,
    p_start_time TIMESTAMPTZ,
    p_professional_id UUID DEFAULT NULL,
    p_client_notes TEXT DEFAULT NULL,
    p_client_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    c_tz CONSTANT TEXT := 'America/Sao_Paulo';
    v_uid UUID := auth.uid();
    v_client UUID;
    v_staff BOOLEAN;
    v_service public.services%ROWTYPE;
    v_settings public.clinic_settings%ROWTYPE;
    v_client_profile public.profiles%ROWTYPE;
    v_cand RECORD;
    v_wh public.professional_working_hours%ROWTYPE;
    v_end TIMESTAMPTZ;
    v_buffer_end TIMESTAMPTZ;
    v_local TIMESTAMP;
    v_end_local TIMESTAMP;
    v_dow public.day_of_week;
    v_id UUID;
    v_found BOOLEAN := FALSE;
    v_conflict BOOLEAN := FALSE;
    v_reason TEXT := NULL;
    v_channel public.notification_channel;
    v_addr TEXT;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Faça login para agendar.' USING ERRCODE = '28000';
    END IF;

    v_staff := public.is_staff();
    v_client := COALESCE(p_client_id, v_uid);
    IF v_client <> v_uid AND NOT v_staff THEN
        RAISE EXCEPTION 'Você não pode agendar em nome de outra pessoa.' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_service FROM public.services WHERE id = p_service_id AND is_active;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Procedimento não encontrado ou inativo.';
    END IF;

    SELECT * INTO v_client_profile FROM public.profiles WHERE id = v_client AND is_active;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Cliente não encontrado.';
    END IF;

    SELECT * INTO v_settings FROM public.clinic_settings LIMIT 1;

    IF p_start_time <= now() THEN
        RAISE EXCEPTION 'O horário escolhido já passou.';
    END IF;

    v_end := p_start_time + make_interval(mins => v_service.duration_minutes);
    v_buffer_end := v_end + make_interval(mins => COALESCE(v_settings.default_buffer_minutes, 15));
    v_local := p_start_time AT TIME ZONE c_tz;
    v_end_local := v_end AT TIME ZONE c_tz;
    v_dow := (ARRAY['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY'])
             [extract(dow FROM v_local)::int + 1]::public.day_of_week;

    FOR v_cand IN
        SELECT p.id, p.name
          FROM public.professionals p
          JOIN public.professional_services ps
            ON ps.professional_id = p.id AND ps.service_id = p_service_id
         WHERE (p_professional_id IS NOT NULL AND p.id = p_professional_id)
            OR (p_professional_id IS NULL AND p.is_available_for_auto_assign)
         ORDER BY (
             SELECT count(*) FROM public.appointments a
              WHERE a.professional_id = p.id
                AND a.status IN ('CONFIRMED', 'COMPLETED')
                AND a.start_time >= (date_trunc('week', now() AT TIME ZONE c_tz) AT TIME ZONE c_tz)
         ), p.id
    LOOP
        v_found := TRUE;

        -- Jornada do dia (início/fim, almoço)
        SELECT * INTO v_wh
          FROM public.professional_working_hours w
         WHERE w.professional_id = v_cand.id AND w.day_of_week = v_dow AND w.is_active;

        IF NOT FOUND
           OR v_end_local::date <> v_local::date
           OR v_local::time < v_wh.start_time
           OR v_end_local::time > v_wh.end_time
           OR (v_wh.break_start_time IS NOT NULL
               AND v_local::time < v_wh.break_end_time
               AND v_end_local::time > v_wh.break_start_time) THEN
            v_reason := 'Este horário está fora da jornada de atendimento da profissional.';
            CONTINUE;
        END IF;

        -- Ausências / férias
        IF EXISTS (
            SELECT 1 FROM public.professional_leaves l
             WHERE l.professional_id = v_cand.id
               AND l.start_datetime < v_end AND l.end_datetime > p_start_time
        ) THEN
            v_reason := 'A profissional não atende neste horário (ausência programada).';
            CONTINUE;
        END IF;

        BEGIN
            INSERT INTO public.appointments (
                client_id, professional_id, service_id,
                start_time, end_time, buffer_end_time,
                status, total_price_cents, client_notes, status_note
            ) VALUES (
                v_client, v_cand.id, p_service_id,
                p_start_time, v_end, v_buffer_end,
                'CONFIRMED', v_service.price_cents, NULLIF(trim(p_client_notes), ''),
                CASE WHEN v_client = v_uid THEN 'Agendamento confirmado online via aplicação.'
                     ELSE 'Agendamento criado pela equipe da clínica.' END
            ) RETURNING id INTO v_id;
        EXCEPTION WHEN exclusion_violation THEN
            v_conflict := TRUE;
            CONTINUE;
        END;

        -- Fila de notificações: confirmação imediata + lembrete 24h antes.
        -- (O envio em si é feito por um worker externo; aqui só entra na fila.)
        IF v_client_profile.opt_in_whatsapp AND v_client_profile.phone <> '' THEN
            v_channel := 'WHATSAPP'; v_addr := v_client_profile.phone;
        ELSIF v_client_profile.opt_in_email THEN
            v_channel := 'EMAIL'; v_addr := v_client_profile.email;
        ELSE
            v_channel := NULL;
        END IF;

        IF v_channel IS NOT NULL THEN
            INSERT INTO public.notifications_log
                (appointment_id, recipient_id, channel, status, template_name, recipient_address, payload, scheduled_for)
            VALUES (v_id, v_client, v_channel, 'QUEUED', 'appointment_confirmed_instant', v_addr,
                    jsonb_build_object('procedimento', v_service.name, 'horario', p_start_time, 'profissional', v_cand.name),
                    now());

            IF p_start_time - interval '24 hours' > now() THEN
                INSERT INTO public.notifications_log
                    (appointment_id, recipient_id, channel, status, template_name, recipient_address, payload, scheduled_for)
                VALUES (v_id, v_client, v_channel, 'QUEUED', 'appointment_reminder_24h', v_addr,
                        jsonb_build_object('procedimento', v_service.name, 'horario', p_start_time, 'profissional', v_cand.name),
                        p_start_time - interval '24 hours');
            END IF;
        END IF;

        RETURN v_id;
    END LOOP;

    IF NOT v_found THEN
        RAISE EXCEPTION 'Nenhuma profissional habilitada para este procedimento.';
    END IF;

    IF v_conflict THEN
        RAISE EXCEPTION 'Desculpe, este horário acabou de ser reservado por outro cliente.'
            USING ERRCODE = '23P01';
    END IF;

    RAISE EXCEPTION '%', COALESCE(v_reason, 'Horário indisponível.');
END;
$$;

-- 4.3 Cliente cancela o próprio agendamento, respeitando a antecedência mínima da clínica
CREATE OR REPLACE FUNCTION public.cancel_my_appointment(p_appointment_id UUID, p_reason TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_apt public.appointments%ROWTYPE;
    v_hours INTEGER;
BEGIN
    SELECT * INTO v_apt FROM public.appointments
     WHERE id = p_appointment_id AND client_id = auth.uid()
       FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Agendamento não encontrado.';
    END IF;
    IF v_apt.status NOT IN ('PENDING', 'CONFIRMED') THEN
        RAISE EXCEPTION 'Este agendamento não pode mais ser cancelado.';
    END IF;

    SELECT min_cancel_notice_hours INTO v_hours FROM public.clinic_settings LIMIT 1;
    IF v_apt.start_time - now() < make_interval(hours => COALESCE(v_hours, 24)) THEN
        RAISE EXCEPTION 'O cancelamento online exige antecedência mínima de % horas. Entre em contato com a recepção.', COALESCE(v_hours, 24);
    END IF;

    UPDATE public.appointments
       SET status = 'CANCELLED',
           cancellation_reason = NULLIF(trim(p_reason), ''),
           cancelled_at = now(),
           cancelled_by = auth.uid(),
           status_note = COALESCE(NULLIF(trim(p_reason), ''), 'Cancelado pelo cliente respeitando antecedência mínima.')
     WHERE id = p_appointment_id;

    DELETE FROM public.notifications_log WHERE appointment_id = p_appointment_id AND status = 'QUEUED';
END;
$$;

-- 4.4 Equipe altera o status (com registro automático no histórico via trigger)
CREATE OR REPLACE FUNCTION public.update_appointment_status(
    p_appointment_id UUID,
    p_status public.appointment_status,
    p_note TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF NOT public.is_staff() THEN
        RAISE EXCEPTION 'Apenas a equipe da clínica pode alterar o status.' USING ERRCODE = '42501';
    END IF;

    UPDATE public.appointments
       SET status = p_status,
           status_note = NULLIF(trim(p_note), ''),
           cancellation_reason = CASE WHEN p_status = 'CANCELLED' THEN NULLIF(trim(p_note), '') ELSE cancellation_reason END,
           cancelled_at = CASE WHEN p_status = 'CANCELLED' THEN now() ELSE cancelled_at END,
           cancelled_by = CASE WHEN p_status = 'CANCELLED' THEN auth.uid() ELSE cancelled_by END
     WHERE id = p_appointment_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Agendamento não encontrado.';
    END IF;

    IF p_status IN ('CANCELLED', 'COMPLETED', 'NO_SHOW') THEN
        DELETE FROM public.notifications_log WHERE appointment_id = p_appointment_id AND status = 'QUEUED';
    END IF;
END;
$$;

-- 4.5 Prontuários: lista (sem dados de saúde) e abertura COM registro obrigatório de acesso
CREATE OR REPLACE FUNCTION public.staff_list_anamnesis()
RETURNS TABLE (client_id UUID, client_name TEXT, updated_at TIMESTAMPTZ, access_count BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT r.client_id, p.full_name, r.updated_at,
           (SELECT count(*) FROM public.anamnesis_access_logs l WHERE l.anamnesis_id = r.id)
      FROM public.anamnesis_records r
      JOIN public.profiles p ON p.id = r.client_id
     WHERE public.is_staff()
     ORDER BY r.updated_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.staff_view_anamnesis(p_client_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_rec public.anamnesis_records%ROWTYPE;
BEGIN
    IF NOT public.is_staff() THEN
        RAISE EXCEPTION 'Apenas a equipe da clínica pode abrir prontuários.' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_rec FROM public.anamnesis_records WHERE client_id = p_client_id;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    INSERT INTO public.anamnesis_access_logs (anamnesis_id, accessed_by, action)
    VALUES (v_rec.id, auth.uid(), 'VIEW');

    RETURN (to_jsonb(v_rec) - 'signature_base64') || jsonb_build_object(
        'access_logs', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                       'id', l.id,
                       'accessed_by', l.accessed_by,
                       'accessed_by_name', pr.full_name,
                       'accessed_at', l.accessed_at,
                       'action', l.action
                   ) ORDER BY l.accessed_at DESC)
              FROM public.anamnesis_access_logs l
              JOIN public.profiles pr ON pr.id = l.accessed_by
             WHERE l.anamnesis_id = v_rec.id
        ), '[]'::jsonb)
    );
END;
$$;

-- 4.6 Cadastro de profissionais (rodar no SQL Editor depois de criar o usuário em Authentication).
--     Define o papel, cria a ficha, a jornada padrão (seg-sex 08:30-18:30 c/ almoço, sáb 08:30-14:00)
--     e habilita os procedimentos (todos, se p_service_slugs for NULL).
CREATE OR REPLACE FUNCTION public.promote_to_professional(
    p_email TEXT,
    p_name TEXT,
    p_title TEXT,
    p_registry TEXT,
    p_bio TEXT DEFAULT NULL,
    p_color TEXT DEFAULT '#ec4899',
    p_service_slugs TEXT[] DEFAULT NULL,
    p_avatar_url TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_profile_id UUID;
    v_prof_id UUID;
    d INTEGER;
    c_days TEXT[] := ARRAY['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY'];
BEGIN
    SELECT id INTO v_profile_id FROM public.profiles WHERE lower(email) = lower(p_email);
    IF v_profile_id IS NULL THEN
        RAISE EXCEPTION 'Nenhum usuário com o e-mail %. Crie-o primeiro em Authentication > Users.', p_email;
    END IF;

    UPDATE public.profiles SET role = 'PROFESSIONAL' WHERE id = v_profile_id AND role = 'CLIENT';

    INSERT INTO public.professionals (profile_id, name, title, registry_number, bio, color_hex, avatar_url)
    VALUES (v_profile_id, p_name, p_title, p_registry, p_bio, p_color, p_avatar_url)
    ON CONFLICT (profile_id) DO UPDATE
        SET name = EXCLUDED.name, title = EXCLUDED.title, registry_number = EXCLUDED.registry_number,
            bio = EXCLUDED.bio, color_hex = EXCLUDED.color_hex, avatar_url = EXCLUDED.avatar_url
    RETURNING id INTO v_prof_id;

    FOR d IN 0..6 LOOP
        INSERT INTO public.professional_working_hours
            (professional_id, day_of_week, start_time, end_time, break_start_time, break_end_time, is_active)
        VALUES (
            v_prof_id, c_days[d + 1]::public.day_of_week,
            CASE WHEN d = 0 THEN '09:00' ELSE '08:30' END::time,
            CASE WHEN d = 0 THEN '13:00' WHEN d = 6 THEN '14:00' ELSE '18:30' END::time,
            CASE WHEN d BETWEEN 1 AND 5 THEN '12:30'::time END,
            CASE WHEN d BETWEEN 1 AND 5 THEN '13:30'::time END,
            d BETWEEN 1 AND 6
        )
        ON CONFLICT (professional_id, day_of_week) DO NOTHING;
    END LOOP;

    INSERT INTO public.professional_services (professional_id, service_id)
    SELECT v_prof_id, s.id FROM public.services s
     WHERE p_service_slugs IS NULL OR s.slug = ANY (p_service_slugs)
    ON CONFLICT DO NOTHING;

    RETURN v_prof_id;
END;
$$;

-- 4.7 Permissões de execução: só usuários logados chamam as RPCs do app;
--     promote_to_professional só roda pelo SQL Editor / service_role.
REVOKE ALL ON FUNCTION public.get_busy_slots(TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.book_appointment(UUID, TIMESTAMPTZ, UUID, TEXT, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_my_appointment(UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_appointment_status(UUID, public.appointment_status, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.staff_list_anamnesis() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.staff_view_anamnesis(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.promote_to_professional(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[], TEXT) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_busy_slots(TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.book_appointment(UUID, TIMESTAMPTZ, UUID, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_my_appointment(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_appointment_status(UUID, public.appointment_status, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_list_anamnesis() TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_view_anamnesis(UUID) TO authenticated;

-- ------------------------------------------------------------------------------
-- 5. DADOS-BASE DA CLÍNICA
-- ------------------------------------------------------------------------------

INSERT INTO public.clinic_settings (id, name, phone, address, min_cancel_notice_hours, default_buffer_minutes, auto_assign_strategy, working_days)
VALUES (TRUE, 'Aesthetiq Clínica & Spa', '(11) 3288-9000',
        'Av. Paulista, 1842 - Conj. 91 - Jardins / Bela Vista, São Paulo - SP',
        24, 15, 'ROUND_ROBIN', '{1,2,3,4,5,6}')
ON CONFLICT (id) DO NOTHING;

-- Categorias: ícones e descrições completas
UPDATE public.service_categories SET icon_name = 'Sparkles',
    description = 'Protocolos de limpeza, hidratação profunda e renovação celular da pele.' WHERE slug = 'facial';
UPDATE public.service_categories SET icon_name = 'Syringe',
    description = 'Procedimentos avançados com biomédica: Botox, preenchedores e bioestimuladores.' WHERE slug = 'injetaveis';
UPDATE public.service_categories SET icon_name = 'Activity',
    description = 'Drenagem linfática pós-operatória, remodelagem corporal e alívio de retenção.' WHERE slug = 'corporal';
UPDATE public.service_categories SET icon_name = 'Zap',
    description = 'Depilação a laser definitiva indolor e clareamento de manchas com tecnologia de ponta.' WHERE slug = 'laser';

-- Serviços já semeados: só completa o que estiver vazio (não sobrescreve nome/preço editados)
UPDATE public.services SET
    recovery_info = COALESCE(recovery_info, 'Evitar exposição solar direta nas 48h seguintes e usar protetor FPS 50+. Não aplicar ácidos por 3 dias.'),
    badge = COALESCE(badge, 'Mais Procurado')
 WHERE slug = 'limpeza-de-pele-profunda';
UPDATE public.services SET
    recovery_info = COALESCE(recovery_info, 'Não deitar ou praticar atividades físicas intensas nas primeiras 4 horas após a aplicação.'),
    badge = COALESCE(badge, 'Destaque VIP')
 WHERE slug = 'botox-full-face';
UPDATE public.services SET
    recovery_info = COALESCE(recovery_info, 'Pode haver leve edema nos primeiros 2 dias. Evitar bebidas muito quentes nas primeiras 24 horas.')
 WHERE slug = 'preenchimento-labial';
UPDATE public.services SET
    recovery_info = COALESCE(recovery_info, 'Ingerir bastante água após a sessão para potencializar a eliminação de toxinas.')
 WHERE slug = 'drenagem-facial';
UPDATE public.services SET
    recovery_info = COALESCE(recovery_info, 'Raspar os pelos com lâmina 24h antes. Não arrancar os pelos com cera ou pinça entre as sessões.')
 WHERE slug = 'laser-soprano';

-- Serviços do catálogo que não estavam no seed inicial
INSERT INTO public.services (id, category_id, name, slug, description, duration_minutes, price_cents, recovery_info, requires_anamnesis)
VALUES
    ('a6666666-6666-6666-6666-666666666666', 'c2222222-2222-2222-2222-222222222222',
     'Bioestimulador de Colágeno (Radiesse/Sculptra)', 'bioestimulador-colageno',
     'Tratamento de flacidez dérmica estimulando a neocolagênese natural por até 18 meses com efeito lifting progressivo.',
     60, 240000,
     'Realizar massagem 5-5-5 (5 minutos, 5 vezes ao dia por 5 dias) conforme orientação da biomédica.', TRUE),
    ('a7777777-7777-7777-7777-777777777777', 'c3333333-3333-3333-3333-333333333333',
     'Massagem Modeladora Dreno-Redutora', 'massagem-modeladora',
     'Técnicas manuais vigorosas associadas a cremes termogênicos para contorno da silhueta e redução de retenção hídrica.',
     50, 19000,
     'Mantenha hidratação constante e alimentação equilibrada pós-procedimento.', FALSE)
ON CONFLICT (id) DO NOTHING;
