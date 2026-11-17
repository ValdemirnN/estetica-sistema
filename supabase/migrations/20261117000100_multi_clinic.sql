-- ==============================================================================
-- MIGRATION 3 — MULTI-CLÍNICA (um sistema, várias clínicas independentes)
-- Rode DEPOIS de 20261104000100_initial_schema.sql e 20261116000100_app_integration.sql.
-- Pode ser reexecutada sem problemas.
--
-- O que muda:
--   1. Nasce o conceito de CLÍNICA (tenant): cada clínica tem slug próprio,
--      marca (nome, logo, cor, textos), regras de negócio e dados isolados.
--   2. O papel do usuário deixa de ser global (profiles.role) e passa a ser POR
--      CLÍNICA (clinic_members). A mesma pessoa pode ser cliente em uma clínica
--      e dona de outra.
--   3. Todas as tabelas de dados ganham clinic_id (com chaves compostas, para o
--      banco impedir cruzar dados de clínicas) e o RLS é refeito por clínica.
--   4. O dono da clínica (ADMIN) gerencia procedimentos, profissionais, jornada,
--      ausências, marca e equipe — direto pelo app, sem SQL.
--   5. O "dono da plataforma" (platform_admins) cria e suspende clínicas.
--   6. Storage público para logos/fotos, gravável só pelo admin da própria clínica.
--
-- A clínica já existente (clinic_settings) vira a clínica de slug 'aesthetiq' e
-- todos os dados atuais são vinculados a ela, preservando papéis e histórico.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. NOVAS TABELAS
-- ------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.clinics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug VARCHAR(63) NOT NULL UNIQUE
        CHECK (slug ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'),
    name VARCHAR(150) NOT NULL,

    -- Personalização visual / textos
    tagline VARCHAR(200) NOT NULL DEFAULT 'Agendamento online',
    hero_badge VARCHAR(80) NOT NULL DEFAULT 'Experiência Clínica Premium',
    hero_title VARCHAR(200) NOT NULL DEFAULT 'Realce sua beleza natural com protocolos exclusivos',
    hero_subtitle TEXT NOT NULL DEFAULT 'Agendamento 100% online com confirmação imediata. Selecione seu procedimento abaixo e encontre os melhores horários.',
    logo_url TEXT,
    primary_color VARCHAR(7) NOT NULL DEFAULT '#e11d48'
        CHECK (primary_color ~ '^#[0-9a-fA-F]{6}$'),

    -- Contato
    phone VARCHAR(30) NOT NULL DEFAULT '',
    whatsapp VARCHAR(30) NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',

    -- Regras de negócio
    min_cancel_notice_hours INTEGER NOT NULL DEFAULT 24 CHECK (min_cancel_notice_hours >= 0),
    default_buffer_minutes INTEGER NOT NULL DEFAULT 15 CHECK (default_buffer_minutes >= 0),
    slot_step_minutes INTEGER NOT NULL DEFAULT 15 CHECK (slot_step_minutes IN (5, 10, 15, 20, 30, 45, 60)),
    auto_assign_strategy VARCHAR(20) NOT NULL DEFAULT 'ROUND_ROBIN'
        CHECK (auto_assign_strategy IN ('ROUND_ROBIN', 'LEAST_BUSY')),
    working_days INTEGER[] NOT NULL DEFAULT '{1,2,3,4,5,6}',

    -- Controle da plataforma (só o dono do SaaS altera): false = clínica suspensa
    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);
ALTER TABLE public.clinics ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS tr_clinics_updated ON public.clinics;
CREATE TRIGGER tr_clinics_updated BEFORE UPDATE ON public.clinics
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Quem pertence a qual clínica, e com qual papel
CREATE TABLE IF NOT EXISTS public.clinic_members (
    clinic_id UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    role public.user_role NOT NULL DEFAULT 'CLIENT',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    PRIMARY KEY (clinic_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_clinic_members_user ON public.clinic_members (user_id);
ALTER TABLE public.clinic_members ENABLE ROW LEVEL SECURITY;

-- Convites para quem ainda não tem conta: ao se cadastrar com este e-mail e entrar
-- na clínica, a pessoa já recebe o papel combinado (ex.: dono = ADMIN).
CREATE TABLE IF NOT EXISTS public.clinic_invites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL CHECK (email = lower(email)),
    role public.user_role NOT NULL DEFAULT 'RECEPTIONIST',
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    UNIQUE (clinic_id, email)
);
ALTER TABLE public.clinic_invites ENABLE ROW LEVEL SECURITY;

-- Operadores da plataforma (quem aluga o sistema para as clínicas)
CREATE TABLE IF NOT EXISTS public.platform_admins (
    user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);
ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------------------------
-- 2. CLÍNICA PADRÃO (a que já existia) + COLUNAS clinic_id
-- ------------------------------------------------------------------------------

DO $$
DECLARE
    v_s public.clinic_settings%ROWTYPE;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.clinics) THEN
        SELECT * INTO v_s FROM public.clinic_settings LIMIT 1;

        INSERT INTO public.clinics (
            slug, name, tagline, hero_title, hero_subtitle, phone, whatsapp, address,
            min_cancel_notice_hours, default_buffer_minutes, auto_assign_strategy, working_days
        ) VALUES (
            'aesthetiq',
            COALESCE(v_s.name, 'Aesthetiq Clínica & Spa'),
            'Agendamento Biomédico & Gestão de Cabines',
            'Realce sua beleza natural com protocolos biomédicos exclusivos',
            'Agendamento 100% online com confirmação imediata via WhatsApp. Selecione seu procedimento abaixo e encontre os melhores horários.',
            COALESCE(v_s.phone, ''),
            COALESCE(v_s.phone, ''),
            COALESCE(v_s.address, ''),
            COALESCE(v_s.min_cancel_notice_hours, 24),
            COALESCE(v_s.default_buffer_minutes, 15),
            COALESCE(v_s.auto_assign_strategy, 'ROUND_ROBIN'),
            COALESCE(v_s.working_days, '{1,2,3,4,5,6}')
        );

        -- Todos os usuários atuais passam a ser membros dela, mantendo o papel que tinham.
        INSERT INTO public.clinic_members (clinic_id, user_id, role, is_active)
        SELECT (SELECT id FROM public.clinics WHERE slug = 'aesthetiq'), p.id, p.role, p.is_active
          FROM public.profiles p
        ON CONFLICT DO NOTHING;
    END IF;
END $$;

-- 2.1 Colunas clinic_id (nulas por enquanto; preenchidas logo abaixo)
ALTER TABLE public.service_categories        ADD COLUMN IF NOT EXISTS clinic_id UUID REFERENCES public.clinics(id) ON DELETE CASCADE;
ALTER TABLE public.services                  ADD COLUMN IF NOT EXISTS clinic_id UUID REFERENCES public.clinics(id) ON DELETE CASCADE;
ALTER TABLE public.professionals             ADD COLUMN IF NOT EXISTS clinic_id UUID REFERENCES public.clinics(id) ON DELETE CASCADE;
ALTER TABLE public.professional_services     ADD COLUMN IF NOT EXISTS clinic_id UUID REFERENCES public.clinics(id) ON DELETE CASCADE;
ALTER TABLE public.professional_working_hours ADD COLUMN IF NOT EXISTS clinic_id UUID REFERENCES public.clinics(id) ON DELETE CASCADE;
ALTER TABLE public.professional_leaves       ADD COLUMN IF NOT EXISTS clinic_id UUID REFERENCES public.clinics(id) ON DELETE CASCADE;
ALTER TABLE public.appointments              ADD COLUMN IF NOT EXISTS clinic_id UUID REFERENCES public.clinics(id) ON DELETE RESTRICT;
ALTER TABLE public.appointment_status_history ADD COLUMN IF NOT EXISTS clinic_id UUID REFERENCES public.clinics(id) ON DELETE CASCADE;
ALTER TABLE public.anamnesis_records         ADD COLUMN IF NOT EXISTS clinic_id UUID REFERENCES public.clinics(id) ON DELETE CASCADE;
ALTER TABLE public.anamnesis_access_logs     ADD COLUMN IF NOT EXISTS clinic_id UUID REFERENCES public.clinics(id) ON DELETE CASCADE;
ALTER TABLE public.notifications_log         ADD COLUMN IF NOT EXISTS clinic_id UUID REFERENCES public.clinics(id) ON DELETE CASCADE;

-- 2.2 Preenchimento: tudo que existe hoje pertence à clínica padrão
DO $$
DECLARE
    v_default UUID := (SELECT id FROM public.clinics ORDER BY created_at LIMIT 1);
BEGIN
    UPDATE public.service_categories SET clinic_id = v_default WHERE clinic_id IS NULL;
    UPDATE public.services           SET clinic_id = v_default WHERE clinic_id IS NULL;
    UPDATE public.professionals      SET clinic_id = v_default WHERE clinic_id IS NULL;

    UPDATE public.professional_services ps SET clinic_id = p.clinic_id
      FROM public.professionals p WHERE p.id = ps.professional_id AND ps.clinic_id IS NULL;
    UPDATE public.professional_working_hours w SET clinic_id = p.clinic_id
      FROM public.professionals p WHERE p.id = w.professional_id AND w.clinic_id IS NULL;
    UPDATE public.professional_leaves l SET clinic_id = p.clinic_id
      FROM public.professionals p WHERE p.id = l.professional_id AND l.clinic_id IS NULL;
    UPDATE public.appointments a SET clinic_id = p.clinic_id
      FROM public.professionals p WHERE p.id = a.professional_id AND a.clinic_id IS NULL;
    UPDATE public.appointment_status_history h SET clinic_id = a.clinic_id
      FROM public.appointments a WHERE a.id = h.appointment_id AND h.clinic_id IS NULL;

    UPDATE public.anamnesis_records SET clinic_id = v_default WHERE clinic_id IS NULL;
    UPDATE public.anamnesis_access_logs l SET clinic_id = r.clinic_id
      FROM public.anamnesis_records r WHERE r.id = l.anamnesis_id AND l.clinic_id IS NULL;

    UPDATE public.notifications_log n SET clinic_id = a.clinic_id
      FROM public.appointments a WHERE a.id = n.appointment_id AND n.clinic_id IS NULL;
    UPDATE public.notifications_log SET clinic_id = v_default WHERE clinic_id IS NULL;
END $$;

ALTER TABLE public.service_categories         ALTER COLUMN clinic_id SET NOT NULL;
ALTER TABLE public.services                   ALTER COLUMN clinic_id SET NOT NULL;
ALTER TABLE public.professionals              ALTER COLUMN clinic_id SET NOT NULL;
ALTER TABLE public.professional_services      ALTER COLUMN clinic_id SET NOT NULL;
ALTER TABLE public.professional_working_hours ALTER COLUMN clinic_id SET NOT NULL;
ALTER TABLE public.professional_leaves        ALTER COLUMN clinic_id SET NOT NULL;
ALTER TABLE public.appointments               ALTER COLUMN clinic_id SET NOT NULL;
ALTER TABLE public.appointment_status_history ALTER COLUMN clinic_id SET NOT NULL;
ALTER TABLE public.anamnesis_records          ALTER COLUMN clinic_id SET NOT NULL;
ALTER TABLE public.anamnesis_access_logs      ALTER COLUMN clinic_id SET NOT NULL;
ALTER TABLE public.notifications_log          ALTER COLUMN clinic_id SET NOT NULL;

-- ------------------------------------------------------------------------------
-- 3. UNICIDADE POR CLÍNICA + CHAVES COMPOSTAS (o banco impede misturar clínicas)
-- ------------------------------------------------------------------------------

-- Helper local (só existe durante esta migration): cria a constraint apenas se ainda não existir
CREATE OR REPLACE FUNCTION pg_temp.add_constraint(p_table TEXT, p_name TEXT, p_definition TEXT)
RETURNS VOID LANGUAGE plpgsql AS $fn$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = p_name AND conrelid = p_table::regclass
    ) THEN
        EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s', p_table, p_name, p_definition);
    END IF;
END;
$fn$;

-- Categorias
ALTER TABLE public.service_categories DROP CONSTRAINT IF EXISTS service_categories_name_key;
ALTER TABLE public.service_categories DROP CONSTRAINT IF EXISTS service_categories_slug_key;
SELECT pg_temp.add_constraint('public.service_categories', 'uq_categories_clinic_name', 'UNIQUE (clinic_id, name)');
SELECT pg_temp.add_constraint('public.service_categories', 'uq_categories_clinic_slug', 'UNIQUE (clinic_id, slug)');
SELECT pg_temp.add_constraint('public.service_categories', 'uq_categories_id_clinic', 'UNIQUE (id, clinic_id)');

-- Serviços (slug único só dentro da clínica; categoria precisa ser da mesma clínica)
ALTER TABLE public.services DROP CONSTRAINT IF EXISTS services_slug_key;
SELECT pg_temp.add_constraint('public.services', 'uq_services_clinic_slug', 'UNIQUE (clinic_id, slug)');
SELECT pg_temp.add_constraint('public.services', 'uq_services_id_clinic', 'UNIQUE (id, clinic_id)');
SELECT pg_temp.add_constraint('public.services', 'fk_services_category_clinic',
    'FOREIGN KEY (category_id, clinic_id) REFERENCES public.service_categories (id, clinic_id) ON DELETE RESTRICT');

-- Profissionais: passam a poder existir SEM conta de login (a dona cadastra pelo painel),
-- e podem ser desativados sem apagar o histórico.
ALTER TABLE public.professionals DROP CONSTRAINT IF EXISTS professionals_profile_id_key;
ALTER TABLE public.professionals ALTER COLUMN profile_id DROP NOT NULL;
ALTER TABLE public.professionals ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
UPDATE public.professionals SET name = 'Profissional' WHERE name IS NULL;
ALTER TABLE public.professionals ALTER COLUMN name SET NOT NULL;
SELECT pg_temp.add_constraint('public.professionals', 'uq_professionals_clinic_profile', 'UNIQUE (clinic_id, profile_id)');
SELECT pg_temp.add_constraint('public.professionals', 'uq_professionals_id_clinic', 'UNIQUE (id, clinic_id)');

-- Vínculo profissional <-> procedimento
SELECT pg_temp.add_constraint('public.professional_services', 'fk_pservices_professional_clinic',
    'FOREIGN KEY (professional_id, clinic_id) REFERENCES public.professionals (id, clinic_id) ON DELETE CASCADE');
SELECT pg_temp.add_constraint('public.professional_services', 'fk_pservices_service_clinic',
    'FOREIGN KEY (service_id, clinic_id) REFERENCES public.services (id, clinic_id) ON DELETE CASCADE');

-- Jornada e ausências
SELECT pg_temp.add_constraint('public.professional_working_hours', 'fk_whours_professional_clinic',
    'FOREIGN KEY (professional_id, clinic_id) REFERENCES public.professionals (id, clinic_id) ON DELETE CASCADE');
SELECT pg_temp.add_constraint('public.professional_leaves', 'fk_leaves_professional_clinic',
    'FOREIGN KEY (professional_id, clinic_id) REFERENCES public.professionals (id, clinic_id) ON DELETE CASCADE');

-- Agendamentos: profissional e serviço têm de ser da mesma clínica do agendamento
SELECT pg_temp.add_constraint('public.appointments', 'fk_appointments_professional_clinic',
    'FOREIGN KEY (professional_id, clinic_id) REFERENCES public.professionals (id, clinic_id) ON DELETE RESTRICT');
SELECT pg_temp.add_constraint('public.appointments', 'fk_appointments_service_clinic',
    'FOREIGN KEY (service_id, clinic_id) REFERENCES public.services (id, clinic_id) ON DELETE RESTRICT');

-- Anamnese: um prontuário por cliente POR CLÍNICA
DROP INDEX IF EXISTS public.uq_anamnesis_client;
SELECT pg_temp.add_constraint('public.anamnesis_records', 'uq_anamnesis_clinic_client', 'UNIQUE (clinic_id, client_id)');

-- Índices por clínica
CREATE INDEX IF NOT EXISTS idx_categories_clinic     ON public.service_categories (clinic_id);
CREATE INDEX IF NOT EXISTS idx_services_clinic       ON public.services (clinic_id);
CREATE INDEX IF NOT EXISTS idx_professionals_clinic  ON public.professionals (clinic_id);
CREATE INDEX IF NOT EXISTS idx_appointments_clinic   ON public.appointments (clinic_id, start_time DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_clinic  ON public.notifications_log (clinic_id, scheduled_for DESC);
CREATE INDEX IF NOT EXISTS idx_anamnesis_clinic      ON public.anamnesis_records (clinic_id);
CREATE INDEX IF NOT EXISTS idx_status_history_clinic ON public.appointment_status_history (clinic_id);

-- ------------------------------------------------------------------------------
-- 4. POLÍTICAS ANTIGAS FORA (todas) — serão recriadas por clínica na seção 6
-- ------------------------------------------------------------------------------

DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT policyname, tablename FROM pg_policies
         WHERE schemaname = 'public'
           AND tablename IN (
               'profiles', 'professionals', 'service_categories', 'services', 'professional_services',
               'professional_working_hours', 'professional_leaves', 'appointments', 'anamnesis_records',
               'anamnesis_access_logs', 'notifications_log', 'appointment_status_history', 'clinic_settings',
               'clinics', 'clinic_members', 'clinic_invites', 'platform_admins'
           )
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
    END LOOP;
END $$;

-- Funções globais de papel (is_admin etc.) não fazem mais sentido: o papel é por clínica.
DROP FUNCTION IF EXISTS public.is_admin();
DROP FUNCTION IF EXISTS public.is_staff();
DROP FUNCTION IF EXISTS public.current_user_role();
-- Assinaturas antigas, substituídas por versões com clinic_id
DROP FUNCTION IF EXISTS public.get_busy_slots(TIMESTAMPTZ, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS public.staff_list_anamnesis();
DROP FUNCTION IF EXISTS public.staff_view_anamnesis(UUID);
DROP FUNCTION IF EXISTS public.promote_to_professional(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[], TEXT);

-- ------------------------------------------------------------------------------
-- 5. FUNÇÕES AUXILIARES DE PERMISSÃO (por clínica)
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = auth.uid());
$$;

-- Papel do usuário logado na clínica (NULL = não é membro, ou clínica suspensa)
CREATE OR REPLACE FUNCTION public.clinic_role(p_clinic UUID)
RETURNS public.user_role
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT m.role
      FROM public.clinic_members m
      JOIN public.clinics c ON c.id = m.clinic_id AND c.is_active
     WHERE m.clinic_id = p_clinic AND m.user_id = auth.uid() AND m.is_active;
$$;

CREATE OR REPLACE FUNCTION public.is_clinic_member(p_clinic UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT public.clinic_role(p_clinic) IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.is_clinic_staff(p_clinic UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT COALESCE(public.clinic_role(p_clinic) IN ('ADMIN', 'RECEPTIONIST', 'PROFESSIONAL'), FALSE);
$$;

CREATE OR REPLACE FUNCTION public.is_clinic_admin(p_clinic UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT COALESCE(public.clinic_role(p_clinic) = 'ADMIN', FALSE);
$$;

-- A equipe de uma clínica enxerga o perfil (nome, telefone...) dos membros DA PRÓPRIA clínica
CREATE OR REPLACE FUNCTION public.staff_can_see_profile(p_profile UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT EXISTS (
        SELECT 1
          FROM public.clinic_members me
          JOIN public.clinics c ON c.id = me.clinic_id AND c.is_active
          JOIN public.clinic_members them ON them.clinic_id = me.clinic_id
         WHERE me.user_id = auth.uid() AND me.is_active
           AND me.role IN ('ADMIN', 'RECEPTIONIST', 'PROFESSIONAL')
           AND them.user_id = p_profile
    );
$$;

CREATE OR REPLACE FUNCTION public.try_uuid(p_text TEXT)
RETURNS UUID
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
    RETURN p_text::uuid;
EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
END;
$$;

-- ------------------------------------------------------------------------------
-- 6. GATILHOS DE PROTEÇÃO
-- ------------------------------------------------------------------------------

-- 6.1 Perfil: ninguém altera id/papel/status/e-mail pelo app (o papel agora é por clínica,
--     em clinic_members, que só muda por função). SQL Editor / service_role seguem livres.
CREATE OR REPLACE FUNCTION public.guard_profile_update()
RETURNS TRIGGER AS $$
BEGIN
    IF auth.uid() IS NOT NULL THEN
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

-- 6.2 Clínica: o dono da clínica edita marca e regras, mas NÃO o slug nem a suspensão
--     (isso é do dono da plataforma).
CREATE OR REPLACE FUNCTION public.guard_clinic_update()
RETURNS TRIGGER AS $$
BEGIN
    IF auth.uid() IS NOT NULL AND NOT public.is_platform_admin() THEN
        IF NEW.slug IS DISTINCT FROM OLD.slug OR NEW.is_active IS DISTINCT FROM OLD.is_active THEN
            RAISE EXCEPTION 'Endereço (slug) e status da clínica só podem ser alterados pelo administrador da plataforma.'
                USING ERRCODE = '42501';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS tr_clinics_guard ON public.clinics;
CREATE TRIGGER tr_clinics_guard BEFORE UPDATE ON public.clinics
    FOR EACH ROW EXECUTE FUNCTION public.guard_clinic_update();

-- 6.3 Histórico de status passa a carregar a clínica
CREATE OR REPLACE FUNCTION public.log_appointment_status()
RETURNS TRIGGER AS $$
DECLARE
    v_name TEXT;
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
        RETURN NEW;
    END IF;

    SELECT full_name || ' (' || COALESCE(public.clinic_role(NEW.clinic_id)::text, 'CLIENT') || ')'
      INTO v_name FROM public.profiles WHERE id = auth.uid();

    INSERT INTO public.appointment_status_history (appointment_id, clinic_id, status, changed_by, changed_by_name, note)
    VALUES (NEW.id, NEW.clinic_id, NEW.status, auth.uid(), COALESCE(v_name, 'Sistema'), NEW.status_note);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- ------------------------------------------------------------------------------
-- 7. POLÍTICAS DE RLS (todas por clínica)
-- ------------------------------------------------------------------------------

-- 7.1 Perfis
CREATE POLICY "Perfil: o próprio ou equipe da mesma clínica"
    ON public.profiles FOR SELECT
    USING (id = auth.uid() OR public.staff_can_see_profile(id));
CREATE POLICY "Perfil: edita o próprio"
    ON public.profiles FOR UPDATE
    USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- 7.2 Clínicas (inserir/apagar só por função / SQL)
CREATE POLICY "Clínica: membros e plataforma leem"
    ON public.clinics FOR SELECT
    USING (public.is_clinic_member(id) OR public.is_platform_admin());
CREATE POLICY "Clínica: admin da clínica ou plataforma edita"
    ON public.clinics FOR UPDATE
    USING (public.is_clinic_admin(id) OR public.is_platform_admin())
    WITH CHECK (public.is_clinic_admin(id) OR public.is_platform_admin());

-- 7.3 Membros e convites (alterações só por função)
CREATE POLICY "Membros: o próprio vínculo ou equipe da clínica"
    ON public.clinic_members FOR SELECT
    USING (user_id = auth.uid() OR public.is_clinic_staff(clinic_id));
CREATE POLICY "Convites: admin da clínica lê"
    ON public.clinic_invites FOR SELECT USING (public.is_clinic_admin(clinic_id));
CREATE POLICY "Convites: admin da clínica revoga"
    ON public.clinic_invites FOR DELETE USING (public.is_clinic_admin(clinic_id));

-- 7.4 Catálogo: membros leem (o app esconde inativos; o histórico precisa dos nomes), admin gerencia
CREATE POLICY "Categorias: membros leem"
    ON public.service_categories FOR SELECT USING (public.is_clinic_member(clinic_id));
CREATE POLICY "Categorias: admin gerencia"
    ON public.service_categories FOR ALL
    USING (public.is_clinic_admin(clinic_id)) WITH CHECK (public.is_clinic_admin(clinic_id));

CREATE POLICY "Serviços: membros leem"
    ON public.services FOR SELECT USING (public.is_clinic_member(clinic_id));
CREATE POLICY "Serviços: admin gerencia"
    ON public.services FOR ALL
    USING (public.is_clinic_admin(clinic_id)) WITH CHECK (public.is_clinic_admin(clinic_id));

-- 7.5 Profissionais, vínculos, jornada e ausências
CREATE POLICY "Profissionais: membros leem"
    ON public.professionals FOR SELECT USING (public.is_clinic_member(clinic_id));
CREATE POLICY "Profissionais: admin gerencia"
    ON public.professionals FOR ALL
    USING (public.is_clinic_admin(clinic_id)) WITH CHECK (public.is_clinic_admin(clinic_id));

CREATE POLICY "Vínculos: membros leem"
    ON public.professional_services FOR SELECT USING (public.is_clinic_member(clinic_id));
CREATE POLICY "Vínculos: admin gerencia"
    ON public.professional_services FOR ALL
    USING (public.is_clinic_admin(clinic_id)) WITH CHECK (public.is_clinic_admin(clinic_id));

CREATE POLICY "Jornadas: membros leem"
    ON public.professional_working_hours FOR SELECT USING (public.is_clinic_member(clinic_id));
CREATE POLICY "Jornadas: admin gerencia"
    ON public.professional_working_hours FOR ALL
    USING (public.is_clinic_admin(clinic_id)) WITH CHECK (public.is_clinic_admin(clinic_id));

CREATE POLICY "Ausências: membros leem"
    ON public.professional_leaves FOR SELECT USING (public.is_clinic_member(clinic_id));
CREATE POLICY "Ausências: admin gerencia"
    ON public.professional_leaves FOR ALL
    USING (public.is_clinic_admin(clinic_id)) WITH CHECK (public.is_clinic_admin(clinic_id));

-- 7.6 Agendamentos: cliente só LÊ os seus; criar/cancelar é por função
CREATE POLICY "Agendamentos: cliente vê os seus, equipe vê os da clínica"
    ON public.appointments FOR SELECT
    USING (client_id = auth.uid() OR public.is_clinic_staff(clinic_id));
CREATE POLICY "Agendamentos: equipe atualiza"
    ON public.appointments FOR UPDATE
    USING (public.is_clinic_staff(clinic_id)) WITH CHECK (public.is_clinic_staff(clinic_id));

CREATE POLICY "Histórico: visível a quem vê o agendamento"
    ON public.appointment_status_history FOR SELECT
    USING (EXISTS (SELECT 1 FROM public.appointments a WHERE a.id = appointment_id));

-- 7.7 Anamnese: só o próprio cliente lê/escreve direto; a equipe lê por função (com auditoria)
CREATE POLICY "Anamnese: cliente lê a sua"
    ON public.anamnesis_records FOR SELECT
    USING (client_id = auth.uid() AND public.is_clinic_member(clinic_id));
CREATE POLICY "Anamnese: cliente preenche a sua"
    ON public.anamnesis_records FOR INSERT
    WITH CHECK (client_id = auth.uid() AND public.is_clinic_member(clinic_id));
CREATE POLICY "Anamnese: cliente atualiza a sua"
    ON public.anamnesis_records FOR UPDATE
    USING (client_id = auth.uid() AND public.is_clinic_member(clinic_id))
    WITH CHECK (client_id = auth.uid() AND public.is_clinic_member(clinic_id));

CREATE POLICY "Log de acesso: quem acessou, dono do prontuário ou admin da clínica"
    ON public.anamnesis_access_logs FOR SELECT
    USING (
        accessed_by = auth.uid()
        OR public.is_clinic_admin(clinic_id)
        OR EXISTS (SELECT 1 FROM public.anamnesis_records r WHERE r.id = anamnesis_id AND r.client_id = auth.uid())
    );

-- 7.8 Notificações
CREATE POLICY "Notificações: destinatário ou equipe da clínica"
    ON public.notifications_log FOR SELECT
    USING (recipient_id = auth.uid() OR public.is_clinic_staff(clinic_id));

-- ------------------------------------------------------------------------------
-- 8. FUNÇÕES (RPC) CHAMADAS PELO APP
-- ------------------------------------------------------------------------------

-- 8.1 Dados PÚBLICOS da clínica (marca) — usados na tela de login, antes de qualquer sessão.
CREATE OR REPLACE FUNCTION public.get_clinic_public(p_slug TEXT)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT jsonb_build_object(
        'id', c.id, 'slug', c.slug, 'name', c.name, 'tagline', c.tagline,
        'hero_badge', c.hero_badge, 'hero_title', c.hero_title, 'hero_subtitle', c.hero_subtitle,
        'logo_url', c.logo_url, 'primary_color', c.primary_color,
        'phone', c.phone, 'whatsapp', c.whatsapp, 'address', c.address,
        'is_active', c.is_active
    )
      FROM public.clinics c
     WHERE c.slug = lower(trim(p_slug));
$$;

-- 8.2 Entrar na clínica: cria o vínculo (como CLIENT, ou com o papel do convite) e devolve o papel.
CREATE OR REPLACE FUNCTION public.join_clinic(p_clinic_id UUID)
RETURNS public.user_role
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_member public.clinic_members%ROWTYPE;
    v_email TEXT;
    v_confirmed BOOLEAN;
    v_inv public.clinic_invites%ROWTYPE;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Faça login para continuar.' USING ERRCODE = '28000';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.clinics WHERE id = p_clinic_id AND is_active) THEN
        RAISE EXCEPTION 'Esta clínica está indisponível no momento.';
    END IF;

    SELECT * INTO v_member FROM public.clinic_members WHERE clinic_id = p_clinic_id AND user_id = v_uid;
    IF FOUND AND NOT v_member.is_active THEN
        RAISE EXCEPTION 'Seu acesso a esta clínica está desativado. Fale com a recepção.' USING ERRCODE = '42501';
    END IF;

    -- Convite pendente para o e-mail desta conta. Só vale com e-mail CONFIRMADO
    -- (mantenha "Confirm email" ligado no Supabase em produção).
    SELECT lower(u.email), (u.email_confirmed_at IS NOT NULL) INTO v_email, v_confirmed
      FROM auth.users u WHERE u.id = v_uid;

    SELECT * INTO v_inv FROM public.clinic_invites WHERE clinic_id = p_clinic_id AND email = v_email;
    IF FOUND AND v_confirmed THEN
        INSERT INTO public.clinic_members (clinic_id, user_id, role)
        VALUES (p_clinic_id, v_uid, v_inv.role)
        ON CONFLICT (clinic_id, user_id) DO UPDATE SET role = EXCLUDED.role;
        DELETE FROM public.clinic_invites WHERE id = v_inv.id;
        RETURN v_inv.role;
    END IF;

    IF v_member.user_id IS NOT NULL THEN
        RETURN v_member.role;
    END IF;

    INSERT INTO public.clinic_members (clinic_id, user_id, role) VALUES (p_clinic_id, v_uid, 'CLIENT')
    ON CONFLICT (clinic_id, user_id) DO NOTHING;
    RETURN 'CLIENT';
END;
$$;

-- 8.3 Horários ocupados da clínica, SEM dados pessoais
CREATE OR REPLACE FUNCTION public.get_busy_slots(p_clinic_id UUID, p_from TIMESTAMPTZ, p_to TIMESTAMPTZ)
RETURNS TABLE (professional_id UUID, start_time TIMESTAMPTZ, buffer_end_time TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT a.professional_id, a.start_time, a.buffer_end_time
      FROM public.appointments a
     WHERE public.is_clinic_member(p_clinic_id)
       AND a.clinic_id = p_clinic_id
       AND a.status IN ('PENDING', 'CONFIRMED')
       AND a.start_time < p_to
       AND a.buffer_end_time > p_from;
$$;

-- 8.4 Agendar. A clínica vem do próprio procedimento; preço, duração, buffer e jornada vêm do banco.
--     p_professional_id NULL = "primeiro disponível" (menor carga na semana).
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
    v_clinic public.clinics%ROWTYPE;
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

    SELECT * INTO v_service FROM public.services WHERE id = p_service_id AND is_active;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Procedimento não encontrado ou inativo.';
    END IF;

    SELECT * INTO v_clinic FROM public.clinics WHERE id = v_service.clinic_id AND is_active;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Esta clínica está indisponível no momento.';
    END IF;
    IF NOT public.is_clinic_member(v_clinic.id) THEN
        RAISE EXCEPTION 'Você não tem acesso a esta clínica.' USING ERRCODE = '42501';
    END IF;

    v_staff := public.is_clinic_staff(v_clinic.id);
    v_client := COALESCE(p_client_id, v_uid);
    IF v_client <> v_uid AND NOT v_staff THEN
        RAISE EXCEPTION 'Você não pode agendar em nome de outra pessoa.' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.clinic_members WHERE clinic_id = v_clinic.id AND user_id = v_client AND is_active
    ) THEN
        RAISE EXCEPTION 'Cliente não encontrado nesta clínica.';
    END IF;

    SELECT * INTO v_client_profile FROM public.profiles WHERE id = v_client AND is_active;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Cliente não encontrado.';
    END IF;

    IF p_start_time <= now() THEN
        RAISE EXCEPTION 'O horário escolhido já passou.';
    END IF;

    v_end := p_start_time + make_interval(mins => v_service.duration_minutes);
    v_buffer_end := v_end + make_interval(mins => v_clinic.default_buffer_minutes);
    v_local := p_start_time AT TIME ZONE c_tz;
    v_end_local := v_end AT TIME ZONE c_tz;
    v_dow := (ARRAY['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY'])
             [extract(dow FROM v_local)::int + 1]::public.day_of_week;

    FOR v_cand IN
        SELECT p.id, p.name
          FROM public.professionals p
          JOIN public.professional_services ps
            ON ps.professional_id = p.id AND ps.service_id = p_service_id
         WHERE p.clinic_id = v_clinic.id
           AND p.is_active
           AND ((p_professional_id IS NOT NULL AND p.id = p_professional_id)
             OR (p_professional_id IS NULL AND p.is_available_for_auto_assign))
         ORDER BY (
             SELECT count(*) FROM public.appointments a
              WHERE a.professional_id = p.id
                AND a.status IN ('CONFIRMED', 'COMPLETED')
                AND a.start_time >= (date_trunc('week', now() AT TIME ZONE c_tz) AT TIME ZONE c_tz)
         ), p.id
    LOOP
        v_found := TRUE;

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
                clinic_id, client_id, professional_id, service_id,
                start_time, end_time, buffer_end_time,
                status, total_price_cents, client_notes, status_note
            ) VALUES (
                v_clinic.id, v_client, v_cand.id, p_service_id,
                p_start_time, v_end, v_buffer_end,
                'CONFIRMED', v_service.price_cents, NULLIF(trim(p_client_notes), ''),
                CASE WHEN v_client = v_uid THEN 'Agendamento confirmado online via aplicação.'
                     ELSE 'Agendamento criado pela equipe da clínica.' END
            ) RETURNING id INTO v_id;
        EXCEPTION WHEN exclusion_violation THEN
            v_conflict := TRUE;
            CONTINUE;
        END;

        -- Fila de notificações: confirmação imediata + lembrete 24h antes
        IF v_client_profile.opt_in_whatsapp AND v_client_profile.phone <> '' THEN
            v_channel := 'WHATSAPP'; v_addr := v_client_profile.phone;
        ELSIF v_client_profile.opt_in_email THEN
            v_channel := 'EMAIL'; v_addr := v_client_profile.email;
        ELSE
            v_channel := NULL;
        END IF;

        IF v_channel IS NOT NULL THEN
            INSERT INTO public.notifications_log
                (clinic_id, appointment_id, recipient_id, channel, status, template_name, recipient_address, payload, scheduled_for)
            VALUES (v_clinic.id, v_id, v_client, v_channel, 'QUEUED', 'appointment_confirmed_instant', v_addr,
                    jsonb_build_object('clinica', v_clinic.name, 'procedimento', v_service.name,
                                       'horario', p_start_time, 'profissional', v_cand.name),
                    now());

            IF p_start_time - interval '24 hours' > now() THEN
                INSERT INTO public.notifications_log
                    (clinic_id, appointment_id, recipient_id, channel, status, template_name, recipient_address, payload, scheduled_for)
                VALUES (v_clinic.id, v_id, v_client, v_channel, 'QUEUED', 'appointment_reminder_24h', v_addr,
                        jsonb_build_object('clinica', v_clinic.name, 'procedimento', v_service.name,
                                           'horario', p_start_time, 'profissional', v_cand.name),
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

-- 8.5 Cliente cancela o próprio agendamento, respeitando a antecedência mínima DA CLÍNICA
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

    SELECT min_cancel_notice_hours INTO v_hours FROM public.clinics WHERE id = v_apt.clinic_id;
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

-- 8.6 Equipe altera o status (histórico automático via trigger)
CREATE OR REPLACE FUNCTION public.update_appointment_status(
    p_appointment_id UUID,
    p_status public.appointment_status,
    p_note TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_clinic UUID;
BEGIN
    SELECT clinic_id INTO v_clinic FROM public.appointments WHERE id = p_appointment_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Agendamento não encontrado.';
    END IF;
    IF NOT public.is_clinic_staff(v_clinic) THEN
        RAISE EXCEPTION 'Apenas a equipe da clínica pode alterar o status.' USING ERRCODE = '42501';
    END IF;

    UPDATE public.appointments
       SET status = p_status,
           status_note = NULLIF(trim(p_note), ''),
           cancellation_reason = CASE WHEN p_status = 'CANCELLED' THEN NULLIF(trim(p_note), '') ELSE cancellation_reason END,
           cancelled_at = CASE WHEN p_status = 'CANCELLED' THEN now() ELSE cancelled_at END,
           cancelled_by = CASE WHEN p_status = 'CANCELLED' THEN auth.uid() ELSE cancelled_by END
     WHERE id = p_appointment_id;

    IF p_status IN ('CANCELLED', 'COMPLETED', 'NO_SHOW') THEN
        DELETE FROM public.notifications_log WHERE appointment_id = p_appointment_id AND status = 'QUEUED';
    END IF;
END;
$$;

-- 8.7 Prontuários (por clínica): lista sem dados de saúde, e abertura COM registro de acesso
CREATE OR REPLACE FUNCTION public.staff_list_anamnesis(p_clinic_id UUID)
RETURNS TABLE (client_id UUID, client_name TEXT, updated_at TIMESTAMPTZ, access_count BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT r.client_id, p.full_name::text, r.updated_at,
           (SELECT count(*) FROM public.anamnesis_access_logs l WHERE l.anamnesis_id = r.id)
      FROM public.anamnesis_records r
      JOIN public.profiles p ON p.id = r.client_id
     WHERE r.clinic_id = p_clinic_id
       AND public.is_clinic_staff(p_clinic_id)
     ORDER BY r.updated_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.staff_view_anamnesis(p_clinic_id UUID, p_client_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_rec public.anamnesis_records%ROWTYPE;
BEGIN
    IF NOT public.is_clinic_staff(p_clinic_id) THEN
        RAISE EXCEPTION 'Apenas a equipe da clínica pode abrir prontuários.' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_rec FROM public.anamnesis_records WHERE clinic_id = p_clinic_id AND client_id = p_client_id;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    INSERT INTO public.anamnesis_access_logs (clinic_id, anamnesis_id, accessed_by, action)
    VALUES (p_clinic_id, v_rec.id, auth.uid(), 'VIEW');

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

-- 8.8 Equipe e acessos (admin da clínica)
--     Se a pessoa já tem conta, o papel vale na hora; se não, fica como convite pendente
--     e é aplicado quando ela se cadastrar com este e-mail e entrar na clínica.
CREATE OR REPLACE FUNCTION public.invite_member(p_clinic_id UUID, p_email TEXT, p_role public.user_role)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_email TEXT := lower(trim(p_email));
    v_user UUID;
    v_old public.user_role;
BEGIN
    IF NOT public.is_clinic_admin(p_clinic_id) THEN
        RAISE EXCEPTION 'Apenas o administrador da clínica pode gerenciar a equipe.' USING ERRCODE = '42501';
    END IF;
    IF p_role = 'CLIENT' THEN
        RAISE EXCEPTION 'Para remover o acesso de equipe, use a opção "Remover acesso".';
    END IF;
    IF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
        RAISE EXCEPTION 'E-mail inválido.';
    END IF;

    SELECT id INTO v_user FROM public.profiles WHERE lower(email) = v_email;
    IF v_user IS NOT NULL THEN
        SELECT role INTO v_old FROM public.clinic_members WHERE clinic_id = p_clinic_id AND user_id = v_user;
        IF v_old = 'ADMIN' AND p_role <> 'ADMIN' AND NOT EXISTS (
            SELECT 1 FROM public.clinic_members
             WHERE clinic_id = p_clinic_id AND role = 'ADMIN' AND is_active AND user_id <> v_user
        ) THEN
            RAISE EXCEPTION 'A clínica precisa ter pelo menos um administrador.';
        END IF;

        INSERT INTO public.clinic_members (clinic_id, user_id, role, is_active)
        VALUES (p_clinic_id, v_user, p_role, TRUE)
        ON CONFLICT (clinic_id, user_id) DO UPDATE SET role = EXCLUDED.role, is_active = TRUE;
        RETURN 'MEMBER';
    END IF;

    INSERT INTO public.clinic_invites (clinic_id, email, role) VALUES (p_clinic_id, v_email, p_role)
    ON CONFLICT (clinic_id, email) DO UPDATE SET role = EXCLUDED.role;
    RETURN 'INVITED';
END;
$$;

-- Remove o acesso de equipe (volta a ser cliente) ou bloqueia a pessoa na clínica
CREATE OR REPLACE FUNCTION public.set_member_access(p_clinic_id UUID, p_user_id UUID, p_role public.user_role, p_active BOOLEAN DEFAULT TRUE)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF NOT public.is_clinic_admin(p_clinic_id) THEN
        RAISE EXCEPTION 'Apenas o administrador da clínica pode gerenciar a equipe.' USING ERRCODE = '42501';
    END IF;

    IF (p_role <> 'ADMIN' OR NOT p_active) AND EXISTS (
        SELECT 1 FROM public.clinic_members WHERE clinic_id = p_clinic_id AND user_id = p_user_id AND role = 'ADMIN'
    ) AND NOT EXISTS (
        SELECT 1 FROM public.clinic_members
         WHERE clinic_id = p_clinic_id AND role = 'ADMIN' AND is_active AND user_id <> p_user_id
    ) THEN
        RAISE EXCEPTION 'A clínica precisa ter pelo menos um administrador.';
    END IF;

    UPDATE public.clinic_members SET role = p_role, is_active = p_active
     WHERE clinic_id = p_clinic_id AND user_id = p_user_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pessoa não encontrada nesta clínica.';
    END IF;
END;
$$;

-- 8.9 PLATAFORMA — criar clínica (só o dono da plataforma, ou SQL Editor / service_role)
CREATE OR REPLACE FUNCTION public.create_clinic(
    p_slug TEXT,
    p_name TEXT,
    p_owner_email TEXT,
    p_primary_color TEXT DEFAULT '#e11d48',
    p_phone TEXT DEFAULT ''
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

    INSERT INTO public.clinics (slug, name, primary_color, phone, whatsapp)
    VALUES (v_slug, trim(p_name), COALESCE(p_primary_color, '#e11d48'), COALESCE(p_phone, ''), COALESCE(p_phone, ''))
    RETURNING id INTO v_id;

    -- Categorias iniciais (o dono edita, apaga ou cria outras)
    INSERT INTO public.service_categories (clinic_id, name, slug, description, display_order, icon_name) VALUES
        (v_id, 'Facial', 'facial', 'Limpeza, hidratação e renovação da pele.', 1, 'Sparkles'),
        (v_id, 'Corporal', 'corporal', 'Drenagem, massagens e remodelagem corporal.', 2, 'Activity'),
        (v_id, 'Injetáveis & Harmonização', 'injetaveis', 'Procedimentos injetáveis com profissional habilitado.', 3, 'Syringe'),
        (v_id, 'Tecnologias & Laser', 'laser', 'Depilação a laser e tratamentos com tecnologia.', 4, 'Zap');

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

-- Painel da plataforma: clínicas com donos e números gerais
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
            'is_active', c.is_active, 'created_at', c.created_at,
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
-- 9. PERMISSÕES DE EXECUÇÃO
-- ------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.get_clinic_public(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.join_clinic(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_busy_slots(UUID, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.book_appointment(UUID, TIMESTAMPTZ, UUID, TEXT, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_my_appointment(UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_appointment_status(UUID, public.appointment_status, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.staff_list_anamnesis(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.staff_view_anamnesis(UUID, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.invite_member(UUID, TEXT, public.user_role) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_member_access(UUID, UUID, public.user_role, BOOLEAN) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.platform_list_clinics() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_platform_admin() FROM PUBLIC, anon;
-- create_clinic: só pelo SQL Editor/service_role ou pelo painel da plataforma (a função confere o papel)
REVOKE ALL ON FUNCTION public.create_clinic(TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_clinic_public(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.join_clinic(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_busy_slots(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.book_appointment(UUID, TIMESTAMPTZ, UUID, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_my_appointment(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_appointment_status(UUID, public.appointment_status, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_list_anamnesis(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_view_anamnesis(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.invite_member(UUID, TEXT, public.user_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_member_access(UUID, UUID, public.user_role, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_list_clinics() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_clinic(TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- As funções auxiliares de RLS são chamadas pelas políticas; usuários anônimos não precisam delas.
REVOKE ALL ON FUNCTION public.clinic_role(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_clinic_member(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_clinic_staff(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_clinic_admin(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.staff_can_see_profile(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clinic_role(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_clinic_member(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_clinic_staff(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_clinic_admin(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_can_see_profile(UUID) TO authenticated;

-- Tabelas sem política de escrita para o app: nada de INSERT/UPDATE/DELETE direto do navegador
REVOKE INSERT, UPDATE, DELETE ON public.clinic_members FROM anon, authenticated;
REVOKE INSERT, UPDATE ON public.clinic_invites FROM anon, authenticated;
REVOKE ALL ON public.platform_admins FROM anon, authenticated;
REVOKE INSERT, DELETE ON public.clinics FROM anon, authenticated;
REVOKE ALL ON public.clinics, public.clinic_members, public.clinic_invites, public.platform_admins FROM anon;
GRANT SELECT ON public.clinics, public.clinic_members, public.clinic_invites TO authenticated;
GRANT UPDATE ON public.clinics TO authenticated;
GRANT DELETE ON public.clinic_invites TO authenticated;

-- ------------------------------------------------------------------------------
-- 10. STORAGE: logos e fotos (bucket público para leitura; só o admin da clínica grava,
--     e só dentro da pasta com o id da própria clínica: <clinic_id>/arquivo.png)
-- ------------------------------------------------------------------------------
DO $$
BEGIN
    IF to_regclass('storage.objects') IS NOT NULL AND to_regclass('storage.buckets') IS NOT NULL THEN
        INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
        VALUES ('clinic-assets', 'clinic-assets', TRUE, 2097152, ARRAY['image/png', 'image/jpeg', 'image/webp'])
        ON CONFLICT (id) DO UPDATE
            SET public = TRUE, file_size_limit = 2097152, allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp'];

        DROP POLICY IF EXISTS "clinic_assets_admin_insert" ON storage.objects;
        DROP POLICY IF EXISTS "clinic_assets_admin_update" ON storage.objects;
        DROP POLICY IF EXISTS "clinic_assets_admin_delete" ON storage.objects;

        CREATE POLICY "clinic_assets_admin_insert" ON storage.objects FOR INSERT TO authenticated
            WITH CHECK (bucket_id = 'clinic-assets'
                        AND public.is_clinic_admin(public.try_uuid((storage.foldername(name))[1])));
        CREATE POLICY "clinic_assets_admin_update" ON storage.objects FOR UPDATE TO authenticated
            USING (bucket_id = 'clinic-assets'
                   AND public.is_clinic_admin(public.try_uuid((storage.foldername(name))[1])));
        CREATE POLICY "clinic_assets_admin_delete" ON storage.objects FOR DELETE TO authenticated
            USING (bucket_id = 'clinic-assets'
                   AND public.is_clinic_admin(public.try_uuid((storage.foldername(name))[1])));
    END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 11. LEGADO
-- ------------------------------------------------------------------------------
-- clinic_settings (linha única) foi substituída por public.clinics e não é mais usada.
-- profiles.role também não manda mais: o papel é por clínica (clinic_members.role).
-- Ambos ficam no banco apenas por segurança do histórico.
COMMENT ON TABLE public.clinic_settings IS 'DEPRECADA: substituída por public.clinics (migration 3).';
COMMENT ON COLUMN public.profiles.role IS 'DEPRECADA: o papel é por clínica, em public.clinic_members.role.';
