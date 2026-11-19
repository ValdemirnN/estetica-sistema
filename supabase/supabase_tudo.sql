-- ==============================================================================
-- SUPABASE — ARQUIVO ÚNICO (todas as migrations, na ordem)
-- Cole tudo em: Supabase Dashboard → SQL Editor → New query → Run.
-- Pode ser reexecutado sem problemas (banco novo ou já migrado).
-- GERADO por scripts/build-supabase-sql.mjs a partir de supabase/migrations/*.sql — não edite à mão.
-- ==============================================================================

-- ##############################################################################
-- MIGRATION: 20261104000100_initial_schema.sql
-- ##############################################################################

-- ==============================================================================
-- SISTEMA DE AGENDAMENTO CLÍNICA DE ESTÉTICA (PRODUÇÃO)
-- ARQUIVO PRONTO PARA O GITHUB & SUPABASE (CLI OU SQL EDITOR)
-- Caminho recomendado no repo: /supabase/migrations/20261104000100_initial_schema.sql
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. EXTENSÕES NECESSÁRIAS
-- ------------------------------------------------------------------------------
-- btree_gist é OBRIGATÓRIA para a EXCLUDE constraint que impede agendamento
-- duplicado (double booking) combinando UUID (=) com TSRANGE (&&)
CREATE EXTENSION IF NOT EXISTS "btree_gist";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ------------------------------------------------------------------------------
-- 2. TIPOS CUSTOMIZADOS (ENUMS)
-- ------------------------------------------------------------------------------
DO $$ BEGIN
    CREATE TYPE user_role AS ENUM ('CLIENT', 'PROFESSIONAL', 'RECEPTIONIST', 'ADMIN');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE appointment_status AS ENUM ('PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE day_of_week AS ENUM ('MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE notification_channel AS ENUM ('WHATSAPP', 'EMAIL');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE notification_status AS ENUM ('QUEUED', 'SENT', 'FAILED', 'DELIVERED', 'READ');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ------------------------------------------------------------------------------
-- 3. TABELA DE PERFIS DE USUÁRIO (VINCULADA AO auth.users DO SUPABASE)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    role user_role NOT NULL DEFAULT 'CLIENT',
    full_name VARCHAR(150) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    phone VARCHAR(20) NOT NULL,
    cpf VARCHAR(14) UNIQUE,
    birth_date DATE,
    avatar_url TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    opt_in_whatsapp BOOLEAN NOT NULL DEFAULT TRUE,
    opt_in_email BOOLEAN NOT NULL DEFAULT TRUE,
    lgpd_consent_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    lgpd_terms_version VARCHAR(20) NOT NULL DEFAULT 'v1.0',
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- ------------------------------------------------------------------------------
-- 4. TABELA DE PROFISSIONAIS (ESTETICISTAS / BIOMÉDICAS)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.professionals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
    bio TEXT,
    registry_number VARCHAR(50), -- CRBM, COREN, CRF
    color_hex VARCHAR(7) NOT NULL DEFAULT '#ec4899',
    interval_buffer_minutes INTEGER NOT NULL DEFAULT 15, -- Buffer de higienização
    is_available_for_auto_assign BOOLEAN NOT NULL DEFAULT TRUE, -- Participa do "Primeiro Disponível"
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- ------------------------------------------------------------------------------
-- 5. CATEGORIAS DE PROCEDIMENTOS
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.service_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL UNIQUE,
    slug VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    display_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- ------------------------------------------------------------------------------
-- 6. CATÁLOGO DE PROCEDIMENTOS / SERVIÇOS
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.services (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category_id UUID NOT NULL REFERENCES public.service_categories(id) ON DELETE RESTRICT,
    name VARCHAR(150) NOT NULL,
    slug VARCHAR(150) NOT NULL UNIQUE,
    description TEXT,
    duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
    price_cents INTEGER NOT NULL CHECK (price_cents >= 0), -- Valores monetários sempre em centavos
    recovery_info TEXT,
    requires_anamnesis BOOLEAN NOT NULL DEFAULT TRUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- ------------------------------------------------------------------------------
-- 7. VÍNCULO PROFISSIONAL <-> PROCEDIMENTO (ESPECIALIDADES)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.professional_services (
    professional_id UUID NOT NULL REFERENCES public.professionals(id) ON DELETE CASCADE,
    service_id UUID NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
    custom_duration_minutes INTEGER,
    custom_price_cents INTEGER,
    PRIMARY KEY (professional_id, service_id)
);

-- ------------------------------------------------------------------------------
-- 8. JORNADA DE TRABALHO SEMANAL DO PROFISSIONAL
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.professional_working_hours (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    professional_id UUID NOT NULL REFERENCES public.professionals(id) ON DELETE CASCADE,
    day_of_week day_of_week NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    break_start_time TIME,
    break_end_time TIME,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT check_work_period CHECK (start_time < end_time),
    CONSTRAINT check_break_period CHECK (
        (break_start_time IS NULL AND break_end_time IS NULL) OR
        (break_start_time < break_end_time AND break_start_time >= start_time AND break_end_time <= end_time)
    ),
    UNIQUE (professional_id, day_of_week)
);

-- ------------------------------------------------------------------------------
-- 9. AUSÊNCIAS, FÉRIAS E FOLGAS PONTUAIS
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.professional_leaves (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    professional_id UUID NOT NULL REFERENCES public.professionals(id) ON DELETE CASCADE,
    start_datetime TIMESTAMPTZ NOT NULL,
    end_datetime TIMESTAMPTZ NOT NULL,
    reason VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT check_leave_period CHECK (start_datetime < end_datetime)
);

-- ------------------------------------------------------------------------------
-- 10. TABELA CENTRAL DE AGENDAMENTOS (COM TRAVA DE CONCORRÊNCIA ATÔMICA)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.appointments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    professional_id UUID NOT NULL REFERENCES public.professionals(id) ON DELETE RESTRICT,
    service_id UUID NOT NULL REFERENCES public.services(id) ON DELETE RESTRICT,
    
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    buffer_end_time TIMESTAMPTZ NOT NULL, -- Horário de término somado ao buffer de higienização
    
    status appointment_status NOT NULL DEFAULT 'CONFIRMED',
    total_price_cents INTEGER NOT NULL CHECK (total_price_cents >= 0),
    
    client_notes TEXT,
    internal_staff_notes TEXT,
    cancellation_reason TEXT,
    cancelled_at TIMESTAMPTZ,
    cancelled_by UUID REFERENCES public.profiles(id),
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),

    CONSTRAINT check_appointment_times CHECK (start_time < end_time AND end_time <= buffer_end_time),
    
    -- CRÍTICO: Prevenção de Double Booking via EXCLUDE Constraint (btree_gist)
    -- Garante atomicidade no PostgreSQL para status ativos: PENDING e CONFIRMED
    CONSTRAINT prevent_professional_double_booking EXCLUDE USING gist (
        professional_id WITH =,
        tstzrange(start_time, buffer_end_time, '[)') WITH &&
    ) WHERE (status IN ('PENDING', 'CONFIRMED'))
);

-- ------------------------------------------------------------------------------
-- 11. FICHA DE ANAMNESE E DADOS DE SAÚDE (DADOS SENSÍVEIS - ART. 11 LGPD)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.anamnesis_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    professional_id UUID REFERENCES public.professionals(id) ON DELETE SET NULL,
    
    allergies TEXT,
    skin_type VARCHAR(50),
    medical_conditions TEXT,
    current_medications TEXT,
    pregnant_or_lactating BOOLEAN NOT NULL DEFAULT FALSE,
    has_pacemaker_or_implants BOOLEAN NOT NULL DEFAULT FALSE,
    previous_aesthetic_reactions TEXT,
    custom_questionnaire JSONB DEFAULT '{}'::jsonb,
    
    signature_base64 TEXT,
    consent_version VARCHAR(20) NOT NULL DEFAULT 'anamnese_v1.0',
    filled_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- ------------------------------------------------------------------------------
-- 12. LOG DE AUDITORIA DE ACESSO A DADOS DE SAÚDE (EXIGÊNCIA LGPD)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.anamnesis_access_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    anamnesis_id UUID NOT NULL REFERENCES public.anamnesis_records(id) ON DELETE CASCADE,
    accessed_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    accessed_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    action VARCHAR(50) NOT NULL, -- 'VIEW', 'UPDATE', 'EXPORT'
    ip_address INET,
    user_agent TEXT
);

-- ------------------------------------------------------------------------------
-- 13. FILA E HISTÓRICO DE NOTIFICAÇÕES (WhatsApp Meta API & Resend Email)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notifications_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    appointment_id UUID REFERENCES public.appointments(id) ON DELETE CASCADE,
    recipient_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    channel notification_channel NOT NULL,
    status notification_status NOT NULL DEFAULT 'QUEUED',
    template_name VARCHAR(100) NOT NULL,
    recipient_address VARCHAR(255) NOT NULL, -- Telefone E.164 (+5511999999999) ou E-mail
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    provider_message_id VARCHAR(255),
    error_message TEXT,
    scheduled_for TIMESTAMPTZ NOT NULL,
    sent_at TIMESTAMPTZ,
    retry_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- ------------------------------------------------------------------------------
-- 14. ÍNDICES DE ALTA PERFORMANCE PARA BUSCA DE DISPONIBILIDADE
-- ------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_appointments_prof_time 
    ON public.appointments (professional_id, start_time, end_time) 
    WHERE status IN ('PENDING', 'CONFIRMED');

CREATE INDEX IF NOT EXISTS idx_appointments_client_date 
    ON public.appointments (client_id, start_time DESC);

CREATE INDEX IF NOT EXISTS idx_working_hours_prof 
    ON public.professional_working_hours (professional_id, day_of_week);

CREATE INDEX IF NOT EXISTS idx_leaves_prof_interval 
    ON public.professional_leaves USING gist (
        professional_id,
        tstzrange(start_datetime, end_datetime, '[)')
    );

CREATE INDEX IF NOT EXISTS idx_notifications_pending 
    ON public.notifications_log (status, scheduled_for) 
    WHERE status = 'QUEUED';

-- ------------------------------------------------------------------------------
-- 15. FUNÇÕES AUXILIARES E TRIGGERS DE updated_at
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_profiles_updated ON public.profiles;
CREATE TRIGGER tr_profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS tr_professionals_updated ON public.professionals;
CREATE TRIGGER tr_professionals_updated BEFORE UPDATE ON public.professionals FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS tr_services_updated ON public.services;
CREATE TRIGGER tr_services_updated BEFORE UPDATE ON public.services FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS tr_appointments_updated ON public.appointments;
CREATE TRIGGER tr_appointments_updated BEFORE UPDATE ON public.appointments FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS tr_anamnesis_updated ON public.anamnesis_records;
CREATE TRIGGER tr_anamnesis_updated BEFORE UPDATE ON public.anamnesis_records FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ------------------------------------------------------------------------------
-- 16. TRIGGER AUTOMÁTICO PARA SINCRONIZAR NOVOS USUÁRIOS DO Supabase Auth
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (
        id,
        email,
        full_name,
        phone,
        role,
        avatar_url,
        created_at,
        updated_at
    )
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', 'Novo Cliente'),
        COALESCE(NEW.raw_user_meta_data->>'phone', ''),
        COALESCE((NEW.raw_user_meta_data->>'role')::public.user_role, 'CLIENT'),
        COALESCE(NEW.raw_user_meta_data->>'avatar_url', ''),
        timezone('utc'::text, now()),
        timezone('utc'::text, now())
    )
    ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        full_name = EXCLUDED.full_name,
        updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT OR UPDATE ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ------------------------------------------------------------------------------
-- 17. POLÍTICAS DE SEGURANÇA (ROW LEVEL SECURITY - RLS)
-- ------------------------------------------------------------------------------
-- Ativar RLS em 100% das tabelas da aplicação
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.professionals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.professional_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.professional_working_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.professional_leaves ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.anamnesis_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.anamnesis_access_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications_log ENABLE ROW LEVEL SECURITY;

-- Helper functions para checagem rápida de perfil no RLS
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS public.user_role AS $$
    SELECT role FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
    SELECT (public.current_user_role() = 'ADMIN');
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS BOOLEAN AS $$
    SELECT (public.current_user_role() IN ('ADMIN', 'RECEPTIONIST', 'PROFESSIONAL'));
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- --- POLÍTICAS: PROFILES ---
CREATE POLICY "Usuários veem o próprio perfil ou Staff vê todos"
    ON public.profiles FOR SELECT
    USING (id = auth.uid() OR public.is_staff());

CREATE POLICY "Usuários editam o próprio perfil ou Admin"
    ON public.profiles FOR UPDATE
    USING (id = auth.uid() OR public.is_admin());

-- --- POLÍTICAS: CATÁLOGO DE SERVIÇOS & CATEGORIAS (PÚBLICO PARA LEITURA) ---
CREATE POLICY "Catálogo público para visualização"
    ON public.services FOR SELECT
    USING (is_active = TRUE OR public.is_staff());

CREATE POLICY "Categorias públicas para visualização"
    ON public.service_categories FOR SELECT
    USING (is_active = TRUE OR public.is_staff());

CREATE POLICY "Apenas Admin altera serviços e categorias"
    ON public.services FOR ALL
    USING (public.is_admin());

-- --- POLÍTICAS: PROFISSIONAIS & HORÁRIOS (PÚBLICO PARA LEITURA DE SLOTS) ---
CREATE POLICY "Profissionais visíveis para agendamento"
    ON public.professionals FOR SELECT
    USING (TRUE);

CREATE POLICY "Horários de trabalho visíveis para cálculo de slots"
    ON public.professional_working_hours FOR SELECT
    USING (TRUE);

CREATE POLICY "Folgas visíveis para bloqueio de slots"
    ON public.professional_leaves FOR SELECT
    USING (TRUE);

-- --- POLÍTICAS: AGENDAMENTOS (APPOINTMENTS) ---
-- O cliente SÓ vê os próprios agendamentos; Staff vê toda a agenda clínica
CREATE POLICY "Clientes veem apenas seus próprios agendamentos"
    ON public.appointments FOR SELECT
    USING (client_id = auth.uid() OR public.is_staff());

CREATE POLICY "Clientes criam seus próprios agendamentos"
    ON public.appointments FOR INSERT
    WITH CHECK (client_id = auth.uid() OR public.is_staff());

CREATE POLICY "Clientes atualizam apenas seus agendamentos ou Staff"
    ON public.appointments FOR UPDATE
    USING (client_id = auth.uid() OR public.is_staff());

-- --- POLÍTICAS: ANAMNESE (DADOS SENSÍVEIS DE SAÚDE - LGPD) ---
-- Cliente vê a sua própria; Profissional/Admin acessa mediante auditoria
CREATE POLICY "Cliente vê sua própria anamnese"
    ON public.anamnesis_records FOR SELECT
    USING (client_id = auth.uid() OR public.is_staff());

CREATE POLICY "Cliente preenche sua anamnese"
    ON public.anamnesis_records FOR INSERT
    WITH CHECK (client_id = auth.uid() OR public.is_staff());

CREATE POLICY "Cliente ou Staff atualiza anamnese"
    ON public.anamnesis_records FOR UPDATE
    USING (client_id = auth.uid() OR public.is_staff());

-- --- POLÍTICAS: LOGS DE AUDITORIA DE ANAMNESE ---
CREATE POLICY "Apenas Staff insere logs de auditoria"
    ON public.anamnesis_access_logs FOR INSERT
    WITH CHECK (public.is_staff() OR accessed_by = auth.uid());

CREATE POLICY "Cliente vê o log de acesso dos seus dados e Admin"
    ON public.anamnesis_access_logs FOR SELECT
    USING (
        accessed_by = auth.uid() 
        OR public.is_admin()
        OR EXISTS (
            SELECT 1 FROM public.anamnesis_records r 
            WHERE r.id = anamnesis_id AND r.client_id = auth.uid()
        )
    );

-- --- POLÍTICAS: NOTIFICAÇÕES (NOTIFICATIONS_LOG) ---
CREATE POLICY "Cliente vê suas próprias notificações ou Staff"
    ON public.notifications_log FOR SELECT
    USING (recipient_id = auth.uid() OR public.is_staff());

-- ------------------------------------------------------------------------------
-- 18. SEED INICIAL DE PROCEDIMENTOS (DADOS MÍNIMOS PARA TESTE IMEDIATO)
-- ------------------------------------------------------------------------------
DO $seed$ BEGIN IF to_regclass('public.clinics') IS NULL THEN
INSERT INTO public.service_categories (id, name, slug, description, display_order)
VALUES 
    ('c1111111-1111-1111-1111-111111111111', 'Facial & Rejuvenescimento', 'facial', 'Limpeza profunda, peelings e hidratações', 1),
    ('c2222222-2222-2222-2222-222222222222', 'Injetáveis & Harmonização', 'injetaveis', 'Botox, bioestimuladores e preenchedores', 2),
    ('c3333333-3333-3333-3333-333333333333', 'Corporal & Modeladora', 'corporal', 'Drenagem linfática e massagens modeladoras', 3),
    ('c4444444-4444-4444-4444-444444444444', 'Tecnologias & Laser', 'laser', 'Depilação a laser e clareamento', 4)
ON CONFLICT (id) DO NOTHING;
END IF; END $seed$;

DO $seed$ BEGIN IF to_regclass('public.clinics') IS NULL THEN
INSERT INTO public.services (id, category_id, name, slug, description, duration_minutes, price_cents, requires_anamnesis)
VALUES
    ('a1111111-1111-1111-1111-111111111111', 'c1111111-1111-1111-1111-111111111111', 'Limpeza de Pele Profunda com Peeling', 'limpeza-de-pele-profunda', 'Extração profunda com vapor de ozônio e máscara hidroplástica calmante.', 75, 22000, TRUE),
    ('a2222222-2222-2222-2222-222222222222', 'c2222222-2222-2222-2222-222222222222', 'Toxina Botulínica (Botox) Full Face', 'botox-full-face', 'Suavização de rugas dinâmicas na testa, glabela e pés de galinha.', 45, 145000, TRUE),
    ('a3333333-3333-3333-3333-333333333333', 'c2222222-2222-2222-2222-222222222222', 'Preenchimento Labial HidraGloss', 'preenchimento-labial', 'Ácido hialurônico para volume e contorno labial natural.', 60, 125000, TRUE),
    ('a4444444-4444-4444-4444-444444444444', 'c3333333-3333-3333-3333-333333333333', 'Drenagem Linfática Facial Descongestionante', 'drenagem-facial', 'Redução de inchaço e ativação da circulação.', 40, 16000, FALSE),
    ('a5555555-5555-5555-5555-555555555555', 'c4444444-4444-4444-4444-444444444444', 'Depilação a Laser Soprano Titanium (Virilha + Axilas)', 'laser-soprano', 'Depilação indolor com resfriamento térmico de safira.', 30, 28000, TRUE)
ON CONFLICT (id) DO NOTHING;
END IF; END $seed$;

-- ##############################################################################
-- MIGRATION: 20261116000100_app_integration.sql
-- ##############################################################################

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

DO $seed$ BEGIN IF to_regclass('public.clinics') IS NULL THEN
INSERT INTO public.clinic_settings (id, name, phone, address, min_cancel_notice_hours, default_buffer_minutes, auto_assign_strategy, working_days)
VALUES (TRUE, 'Aesthetiq Clínica & Spa', '(11) 3288-9000',
        'Av. Paulista, 1842 - Conj. 91 - Jardins / Bela Vista, São Paulo - SP',
        24, 15, 'ROUND_ROBIN', '{1,2,3,4,5,6}')
ON CONFLICT (id) DO NOTHING;
END IF; END $seed$;

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
DO $seed$ BEGIN IF to_regclass('public.clinics') IS NULL THEN
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
END IF; END $seed$;

-- ##############################################################################
-- MIGRATION: 20261117000100_multi_clinic.sql
-- ##############################################################################

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

-- ##############################################################################
-- MIGRATION: 20261118000100_sem_prontuario_agenda_clientes.sql
-- ##############################################################################

-- ==============================================================================
-- MIGRATION 4 — SEM PRONTUÁRIO + AGENDA DA EQUIPE + CADASTRO DE CLIENTES
-- Rode DEPOIS de 20261117000100_multi_clinic.sql. Pode ser reexecutada sem problemas.
--
-- O que muda:
--   1. REMOVE o prontuário/anamnese (tabelas, funções e a coluna services.requires_anamnesis).
--      ATENÇÃO: apaga as fichas de anamnese já preenchidas. Exporte antes, se precisar delas.
--   2. Observação interna da equipe sobre cada cliente (o cliente não enxerga).
--   3. Listagem de clientes da clínica para a equipe.
--   4. Remarcação de agendamento pela equipe (reschedule_appointment), com as mesmas
--      validações de book_appointment e a mesma trava anti-conflito (EXCLUDE) do banco.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. REMOVER ANAMNESE
-- ------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.staff_list_anamnesis(UUID);
DROP FUNCTION IF EXISTS public.staff_view_anamnesis(UUID, UUID);
DROP TABLE IF EXISTS public.anamnesis_access_logs CASCADE;
DROP TABLE IF EXISTS public.anamnesis_records CASCADE;
ALTER TABLE public.services DROP COLUMN IF EXISTS requires_anamnesis;

-- ------------------------------------------------------------------------------
-- 2. OBSERVAÇÃO INTERNA DA EQUIPE SOBRE O CLIENTE
--    RLS ligado e SEM política: o navegador não lê nem grava direto; só as funções abaixo.
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.clinic_client_notes (
    clinic_id UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
    client_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    notes TEXT NOT NULL DEFAULT '' CHECK (char_length(notes) <= 1000),
    updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    PRIMARY KEY (clinic_id, client_id)
);
ALTER TABLE public.clinic_client_notes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.clinic_client_notes FROM anon, authenticated;

-- ------------------------------------------------------------------------------
-- 3. CLIENTES (equipe)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.staff_list_clients(p_clinic_id UUID)
RETURNS TABLE (
    client_id UUID, full_name TEXT, phone TEXT, email TEXT, cpf TEXT, birth_date DATE,
    is_active BOOLEAN, created_at TIMESTAMPTZ, staff_notes TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT p.id, p.full_name::text, p.phone::text, p.email::text, p.cpf::text, p.birth_date,
           m.is_active, m.created_at, COALESCE(n.notes, '')
      FROM public.clinic_members m
      JOIN public.profiles p ON p.id = m.user_id
      LEFT JOIN public.clinic_client_notes n ON n.clinic_id = m.clinic_id AND n.client_id = m.user_id
     WHERE m.clinic_id = p_clinic_id
       AND m.role = 'CLIENT'
       AND public.is_clinic_staff(p_clinic_id)
     ORDER BY p.full_name;
$$;

CREATE OR REPLACE FUNCTION public.staff_set_client_notes(p_clinic_id UUID, p_client_id UUID, p_notes TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF NOT public.is_clinic_staff(p_clinic_id) THEN
        RAISE EXCEPTION 'Apenas a equipe da clínica pode alterar observações.' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.clinic_members WHERE clinic_id = p_clinic_id AND user_id = p_client_id) THEN
        RAISE EXCEPTION 'Cliente não encontrado nesta clínica.';
    END IF;

    INSERT INTO public.clinic_client_notes (clinic_id, client_id, notes, updated_by, updated_at)
    VALUES (p_clinic_id, p_client_id, COALESCE(left(trim(p_notes), 1000), ''), auth.uid(), now())
    ON CONFLICT (clinic_id, client_id)
    DO UPDATE SET notes = EXCLUDED.notes, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at;
END;
$$;

-- ------------------------------------------------------------------------------
-- 4. REMARCAR (equipe)
--    p_professional_id NULL = mantém a mesma profissional.
--    Preço e procedimento não mudam. Duração/buffer seguem as regras atuais do procedimento e da clínica.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reschedule_appointment(
    p_appointment_id UUID,
    p_start_time TIMESTAMPTZ,
    p_professional_id UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    c_tz CONSTANT TEXT := 'America/Sao_Paulo';
    v_apt public.appointments%ROWTYPE;
    v_service public.services%ROWTYPE;
    v_clinic public.clinics%ROWTYPE;
    v_client public.profiles%ROWTYPE;
    v_prof public.professionals%ROWTYPE;
    v_wh public.professional_working_hours%ROWTYPE;
    v_end TIMESTAMPTZ;
    v_buffer_end TIMESTAMPTZ;
    v_local TIMESTAMP;
    v_end_local TIMESTAMP;
    v_dow public.day_of_week;
    v_channel public.notification_channel;
    v_addr TEXT;
    v_payload JSONB;
BEGIN
    SELECT * INTO v_apt FROM public.appointments WHERE id = p_appointment_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Agendamento não encontrado.';
    END IF;
    IF NOT public.is_clinic_staff(v_apt.clinic_id) THEN
        RAISE EXCEPTION 'Apenas a equipe da clínica pode remarcar.' USING ERRCODE = '42501';
    END IF;
    IF v_apt.status NOT IN ('PENDING', 'CONFIRMED') THEN
        RAISE EXCEPTION 'Só é possível remarcar agendamentos pendentes ou confirmados.';
    END IF;
    IF p_start_time <= now() THEN
        RAISE EXCEPTION 'O horário escolhido já passou.';
    END IF;

    SELECT * INTO v_clinic FROM public.clinics WHERE id = v_apt.clinic_id AND is_active;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Esta clínica está indisponível no momento.';
    END IF;
    SELECT * INTO v_service FROM public.services WHERE id = v_apt.service_id;

    SELECT p.* INTO v_prof
      FROM public.professionals p
      JOIN public.professional_services ps ON ps.professional_id = p.id AND ps.service_id = v_apt.service_id
     WHERE p.id = COALESCE(p_professional_id, v_apt.professional_id)
       AND p.clinic_id = v_apt.clinic_id
       AND p.is_active;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Esta profissional não realiza este procedimento (ou está inativa).';
    END IF;

    v_end := p_start_time + make_interval(mins => v_service.duration_minutes);
    v_buffer_end := v_end + make_interval(mins => v_clinic.default_buffer_minutes);
    v_local := p_start_time AT TIME ZONE c_tz;
    v_end_local := v_end AT TIME ZONE c_tz;
    v_dow := (ARRAY['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY'])
             [extract(dow FROM v_local)::int + 1]::public.day_of_week;

    SELECT * INTO v_wh
      FROM public.professional_working_hours w
     WHERE w.professional_id = v_prof.id AND w.day_of_week = v_dow AND w.is_active;

    IF NOT FOUND
       OR v_end_local::date <> v_local::date
       OR v_local::time < v_wh.start_time
       OR v_end_local::time > v_wh.end_time
       OR (v_wh.break_start_time IS NOT NULL
           AND v_local::time < v_wh.break_end_time
           AND v_end_local::time > v_wh.break_start_time) THEN
        RAISE EXCEPTION 'Este horário está fora da jornada de atendimento da profissional.';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.professional_leaves l
         WHERE l.professional_id = v_prof.id
           AND l.start_datetime < v_end AND l.end_datetime > p_start_time
    ) THEN
        RAISE EXCEPTION 'A profissional não atende neste horário (ausência programada).';
    END IF;

    BEGIN
        UPDATE public.appointments
           SET professional_id = v_prof.id,
               start_time = p_start_time,
               end_time = v_end,
               buffer_end_time = v_buffer_end,
               internal_staff_notes = left(
                   trim(both E'\n' FROM COALESCE(internal_staff_notes, '') || E'\n' ||
                        'Remarcado de ' || to_char(v_apt.start_time AT TIME ZONE c_tz, 'DD/MM HH24:MI') ||
                        ' para ' || to_char(v_local, 'DD/MM HH24:MI') || ' pela equipe.'), 1000)
         WHERE id = p_appointment_id;
    EXCEPTION WHEN exclusion_violation THEN
        RAISE EXCEPTION 'Este horário já está ocupado para a profissional escolhida.' USING ERRCODE = '23P01';
    END;

    -- Avisos antigos saem da fila; entram o aviso de remarcação e o novo lembrete de 24h.
    DELETE FROM public.notifications_log WHERE appointment_id = p_appointment_id AND status = 'QUEUED';

    SELECT * INTO v_client FROM public.profiles WHERE id = v_apt.client_id;
    IF v_client.opt_in_whatsapp AND v_client.phone <> '' THEN
        v_channel := 'WHATSAPP'; v_addr := v_client.phone;
    ELSIF v_client.opt_in_email THEN
        v_channel := 'EMAIL'; v_addr := v_client.email;
    ELSE
        v_channel := NULL;
    END IF;

    IF v_channel IS NOT NULL THEN
        v_payload := jsonb_build_object('clinica', v_clinic.name, 'procedimento', v_service.name,
                                        'horario', p_start_time, 'profissional', v_prof.name);
        INSERT INTO public.notifications_log
            (clinic_id, appointment_id, recipient_id, channel, status, template_name, recipient_address, payload, scheduled_for)
        VALUES (v_apt.clinic_id, p_appointment_id, v_apt.client_id, v_channel, 'QUEUED',
                'appointment_rescheduled', v_addr, v_payload, now());

        IF p_start_time - interval '24 hours' > now() THEN
            INSERT INTO public.notifications_log
                (clinic_id, appointment_id, recipient_id, channel, status, template_name, recipient_address, payload, scheduled_for)
            VALUES (v_apt.clinic_id, p_appointment_id, v_apt.client_id, v_channel, 'QUEUED',
                    'appointment_reminder_24h', v_addr, v_payload, p_start_time - interval '24 hours');
        END IF;
    END IF;
END;
$$;

-- ------------------------------------------------------------------------------
-- 5. PERMISSÕES
-- ------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.staff_list_clients(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.staff_set_client_notes(UUID, UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reschedule_appointment(UUID, TIMESTAMPTZ, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_list_clients(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_set_client_notes(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reschedule_appointment(UUID, TIMESTAMPTZ, UUID) TO authenticated;

-- ##############################################################################
-- MIGRATION: 20261119000100_intervalo_retorno.sql
-- ##############################################################################

-- ==============================================================================
-- MIGRATION 5 — INTERVALO DE RETORNO POR PROCEDIMENTO
-- Rode DEPOIS de 20261118000100_sem_prontuario_agenda_clientes.sql. Pode ser reexecutada.
--
-- O dono define, em cada procedimento, de quantos em quantos dias o cliente deve voltar.
-- O app usa isso (com a data do último atendimento concluído) para montar o cronograma
-- preventivo do cliente. NULL = o procedimento não tem retorno recomendado.
-- As políticas de RLS de public.services já cobrem a coluna nova (leitura: membros da
-- clínica; escrita: ADMIN da clínica).
-- ==============================================================================
ALTER TABLE public.services
    ADD COLUMN IF NOT EXISTS return_interval_days INTEGER;

ALTER TABLE public.services DROP CONSTRAINT IF EXISTS services_return_interval_days_check;
ALTER TABLE public.services
    ADD CONSTRAINT services_return_interval_days_check
    CHECK (return_interval_days IS NULL OR return_interval_days BETWEEN 1 AND 730);

COMMENT ON COLUMN public.services.return_interval_days IS
    'Dias entre um atendimento e o retorno recomendado. NULL = sem retorno recomendado.';

-- ##############################################################################
-- MIGRATION: 20261120000100_onboarding_dono.sql
-- ##############################################################################

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

-- ##############################################################################
-- MIGRATION: 20261121000100_area_cliente.sql
-- ##############################################################################

-- ==============================================================================
-- MIGRATION 7 — FASE 4: ÁREA DO CLIENTE
-- Rode DEPOIS de 20261120000100_onboarding_dono.sql. Pode ser reexecutada.
--
-- O que muda:
--   1. Remarcação pelo próprio cliente (reschedule_my_appointment), com a mesma
--      antecedência mínima do cancelamento VALIDADA NO BANCO (clinics.min_cancel_notice_hours)
--      e as mesmas regras de jornada, ausência e conflito da remarcação da equipe.
--      A lógica comum foi extraída para reschedule_appointment_core (interna);
--      reschedule_appointment (equipe) mantém as mesmas mensagens e permissões.
--   2. Edição do próprio cadastro (update_my_profile): nome, telefone e preferências de
--      notificação, com validação. Os avisos que já estavam na fila são ajustados à nova
--      preferência (canal/endereço) ou removidos, se o cliente desligou todos os canais.
--   3. Pedido de exclusão da conta (LGPD, art. 18): tabela account_deletion_requests e
--      funções request_account_deletion / cancel_account_deletion_request. O pedido fica
--      registrado e visível para a equipe da clínica; o cliente pode desistir enquanto
--      estiver pendente. A anonimização em si é feita pela clínica/plataforma (os
--      agendamentos podem precisar ser mantidos por obrigação legal, art. 16 da LGPD).
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. REMARCAÇÃO: NÚCLEO COMPARTILHADO
--    Recebe o agendamento JÁ travado (FOR UPDATE) e autorizado por quem chama.
--    p_professional_id NULL = mantém a mesma profissional.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reschedule_appointment_core(
    p_appointment_id UUID,
    p_start_time TIMESTAMPTZ,
    p_professional_id UUID,
    p_actor TEXT
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    c_tz CONSTANT TEXT := 'America/Sao_Paulo';
    v_apt public.appointments%ROWTYPE;
    v_service public.services%ROWTYPE;
    v_clinic public.clinics%ROWTYPE;
    v_client public.profiles%ROWTYPE;
    v_prof public.professionals%ROWTYPE;
    v_wh public.professional_working_hours%ROWTYPE;
    v_end TIMESTAMPTZ;
    v_buffer_end TIMESTAMPTZ;
    v_local TIMESTAMP;
    v_end_local TIMESTAMP;
    v_dow public.day_of_week;
    v_channel public.notification_channel;
    v_addr TEXT;
    v_payload JSONB;
BEGIN
    SELECT * INTO v_apt FROM public.appointments WHERE id = p_appointment_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Agendamento não encontrado.';
    END IF;

    IF p_start_time <= now() THEN
        RAISE EXCEPTION 'O horário escolhido já passou.';
    END IF;

    SELECT * INTO v_clinic FROM public.clinics WHERE id = v_apt.clinic_id AND is_active;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Esta clínica está indisponível no momento.';
    END IF;
    SELECT * INTO v_service FROM public.services WHERE id = v_apt.service_id;

    SELECT p.* INTO v_prof
      FROM public.professionals p
      JOIN public.professional_services ps ON ps.professional_id = p.id AND ps.service_id = v_apt.service_id
     WHERE p.id = COALESCE(p_professional_id, v_apt.professional_id)
       AND p.clinic_id = v_apt.clinic_id
       AND p.is_active;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Esta profissional não realiza este procedimento (ou está inativa).';
    END IF;

    v_end := p_start_time + make_interval(mins => v_service.duration_minutes);
    v_buffer_end := v_end + make_interval(mins => v_clinic.default_buffer_minutes);
    v_local := p_start_time AT TIME ZONE c_tz;
    v_end_local := v_end AT TIME ZONE c_tz;
    v_dow := (ARRAY['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY'])
             [extract(dow FROM v_local)::int + 1]::public.day_of_week;

    SELECT * INTO v_wh
      FROM public.professional_working_hours w
     WHERE w.professional_id = v_prof.id AND w.day_of_week = v_dow AND w.is_active;

    IF NOT FOUND
       OR v_end_local::date <> v_local::date
       OR v_local::time < v_wh.start_time
       OR v_end_local::time > v_wh.end_time
       OR (v_wh.break_start_time IS NOT NULL
           AND v_local::time < v_wh.break_end_time
           AND v_end_local::time > v_wh.break_start_time) THEN
        RAISE EXCEPTION 'Este horário está fora da jornada de atendimento da profissional.';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.professional_leaves l
         WHERE l.professional_id = v_prof.id
           AND l.start_datetime < v_end AND l.end_datetime > p_start_time
    ) THEN
        RAISE EXCEPTION 'A profissional não atende neste horário (ausência programada).';
    END IF;

    BEGIN
        UPDATE public.appointments
           SET professional_id = v_prof.id,
               start_time = p_start_time,
               end_time = v_end,
               buffer_end_time = v_buffer_end,
               internal_staff_notes = left(
                   trim(both E'\n' FROM COALESCE(internal_staff_notes, '') || E'\n' ||
                        'Remarcado de ' || to_char(v_apt.start_time AT TIME ZONE c_tz, 'DD/MM HH24:MI') ||
                        ' para ' || to_char(v_local, 'DD/MM HH24:MI') || ' ' || p_actor || '.'), 1000)
         WHERE id = p_appointment_id;
    EXCEPTION WHEN exclusion_violation THEN
        RAISE EXCEPTION 'Este horário já está ocupado para a profissional escolhida.' USING ERRCODE = '23P01';
    END;

    -- Avisos antigos saem da fila; entram o aviso de remarcação e o novo lembrete de 24h.
    DELETE FROM public.notifications_log WHERE appointment_id = p_appointment_id AND status = 'QUEUED';

    SELECT * INTO v_client FROM public.profiles WHERE id = v_apt.client_id;
    IF v_client.opt_in_whatsapp AND v_client.phone <> '' THEN
        v_channel := 'WHATSAPP'; v_addr := v_client.phone;
    ELSIF v_client.opt_in_email THEN
        v_channel := 'EMAIL'; v_addr := v_client.email;
    ELSE
        v_channel := NULL;
    END IF;

    IF v_channel IS NOT NULL THEN
        v_payload := jsonb_build_object('clinica', v_clinic.name, 'procedimento', v_service.name,
                                        'horario', p_start_time, 'profissional', v_prof.name);
        INSERT INTO public.notifications_log
            (clinic_id, appointment_id, recipient_id, channel, status, template_name, recipient_address, payload, scheduled_for)
        VALUES (v_apt.clinic_id, p_appointment_id, v_apt.client_id, v_channel, 'QUEUED',
                'appointment_rescheduled', v_addr, v_payload, now());

        IF p_start_time - interval '24 hours' > now() THEN
            INSERT INTO public.notifications_log
                (clinic_id, appointment_id, recipient_id, channel, status, template_name, recipient_address, payload, scheduled_for)
            VALUES (v_apt.clinic_id, p_appointment_id, v_apt.client_id, v_channel, 'QUEUED',
                    'appointment_reminder_24h', v_addr, v_payload, p_start_time - interval '24 hours');
        END IF;
    END IF;
END;
$$;

-- Equipe remarca: mesmas regras e mensagens de antes, agora via núcleo compartilhado.
CREATE OR REPLACE FUNCTION public.reschedule_appointment(
    p_appointment_id UUID,
    p_start_time TIMESTAMPTZ,
    p_professional_id UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_apt public.appointments%ROWTYPE;
BEGIN
    SELECT * INTO v_apt FROM public.appointments WHERE id = p_appointment_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Agendamento não encontrado.';
    END IF;
    IF NOT public.is_clinic_staff(v_apt.clinic_id) THEN
        RAISE EXCEPTION 'Apenas a equipe da clínica pode remarcar.' USING ERRCODE = '42501';
    END IF;
    IF v_apt.status NOT IN ('PENDING', 'CONFIRMED') THEN
        RAISE EXCEPTION 'Só é possível remarcar agendamentos pendentes ou confirmados.';
    END IF;

    PERFORM public.reschedule_appointment_core(p_appointment_id, p_start_time, p_professional_id, 'pela equipe');
END;
$$;

-- Cliente remarca o PRÓPRIO agendamento, respeitando a antecedência mínima DA CLÍNICA.
-- A antecedência vale para o horário ATUAL do agendamento (a mesma regra do cancelamento).
CREATE OR REPLACE FUNCTION public.reschedule_my_appointment(
    p_appointment_id UUID,
    p_start_time TIMESTAMPTZ,
    p_professional_id UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_apt public.appointments%ROWTYPE;
    v_clinic public.clinics%ROWTYPE;
    v_hours INTEGER;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Faça login para remarcar.' USING ERRCODE = '28000';
    END IF;

    SELECT * INTO v_apt FROM public.appointments
     WHERE id = p_appointment_id AND client_id = auth.uid()
       FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Agendamento não encontrado.';
    END IF;
    IF v_apt.status NOT IN ('PENDING', 'CONFIRMED') THEN
        RAISE EXCEPTION 'Este agendamento não pode mais ser remarcado.';
    END IF;

    SELECT * INTO v_clinic FROM public.clinics WHERE id = v_apt.clinic_id;
    IF NOT FOUND OR NOT v_clinic.is_active THEN
        RAISE EXCEPTION 'Esta clínica está indisponível no momento.';
    END IF;
    IF NOT v_clinic.booking_published THEN
        RAISE EXCEPTION 'O agendamento online desta clínica está pausado. Entre em contato com a recepção.';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.clinic_members
         WHERE clinic_id = v_apt.clinic_id AND user_id = auth.uid() AND is_active
    ) THEN
        RAISE EXCEPTION 'Você não tem acesso a esta clínica.' USING ERRCODE = '42501';
    END IF;

    v_hours := COALESCE(v_clinic.min_cancel_notice_hours, 24);
    IF v_apt.start_time - now() < make_interval(hours => v_hours) THEN
        RAISE EXCEPTION 'A remarcação online exige antecedência mínima de % horas. Entre em contato com a recepção.', v_hours;
    END IF;

    PERFORM public.reschedule_appointment_core(p_appointment_id, p_start_time, p_professional_id, 'pelo cliente');
END;
$$;

-- ------------------------------------------------------------------------------
-- 2. EDITAR O PRÓPRIO CADASTRO (nome, telefone, preferências de notificação)
--    E-mail, papel e status continuam protegidos pelo gatilho guard_profile_update.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_my_profile(
    p_full_name TEXT,
    p_phone TEXT,
    p_opt_in_whatsapp BOOLEAN,
    p_opt_in_email BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_name TEXT := regexp_replace(trim(COALESCE(p_full_name, '')), '\s+', ' ', 'g');
    v_phone TEXT := trim(COALESCE(p_phone, ''));
    v_digits TEXT := regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g');
    v_profile public.profiles%ROWTYPE;
    v_n RECORD;
    v_channel public.notification_channel;
    v_addr TEXT;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Faça login para editar seu cadastro.' USING ERRCODE = '28000';
    END IF;
    IF char_length(v_name) < 3 OR char_length(v_name) > 150 THEN
        RAISE EXCEPTION 'Informe seu nome completo (de 3 a 150 caracteres).';
    END IF;
    IF char_length(v_digits) < 10 OR char_length(v_digits) > 13 THEN
        RAISE EXCEPTION 'Informe um telefone válido com DDD.';
    END IF;
    IF p_opt_in_whatsapp IS NULL OR p_opt_in_email IS NULL THEN
        RAISE EXCEPTION 'Preferências de notificação inválidas.';
    END IF;

    UPDATE public.profiles
       SET full_name = v_name,
           phone = left(v_phone, 20),
           opt_in_whatsapp = p_opt_in_whatsapp,
           opt_in_email = p_opt_in_email
     WHERE id = v_uid AND is_active
    RETURNING * INTO v_profile;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Cadastro não encontrado.';
    END IF;

    -- Avisos que já estavam na fila passam a respeitar a nova preferência/telefone.
    IF v_profile.opt_in_whatsapp AND v_profile.phone <> '' THEN
        v_channel := 'WHATSAPP'; v_addr := v_profile.phone;
    ELSIF v_profile.opt_in_email THEN
        v_channel := 'EMAIL'; v_addr := v_profile.email;
    ELSE
        v_channel := NULL;
    END IF;

    IF v_channel IS NULL THEN
        DELETE FROM public.notifications_log WHERE recipient_id = v_uid AND status = 'QUEUED';
    ELSE
        FOR v_n IN SELECT id FROM public.notifications_log WHERE recipient_id = v_uid AND status = 'QUEUED' LOOP
            UPDATE public.notifications_log
               SET channel = v_channel, recipient_address = v_addr
             WHERE id = v_n.id;
        END LOOP;
    END IF;
END;
$$;

-- ------------------------------------------------------------------------------
-- 3. PEDIDO DE EXCLUSÃO DA CONTA (LGPD, art. 18, VI)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.account_deletion_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'CANCELLED', 'DONE')),
    reason TEXT,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    resolved_at TIMESTAMPTZ
);
-- No máximo um pedido pendente por cliente e clínica
CREATE UNIQUE INDEX IF NOT EXISTS uq_deletion_request_pending
    ON public.account_deletion_requests (clinic_id, user_id) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS idx_deletion_requests_clinic
    ON public.account_deletion_requests (clinic_id, status, requested_at DESC);

ALTER TABLE public.account_deletion_requests ENABLE ROW LEVEL SECURITY;

-- Leitura: o próprio cliente e a equipe da clínica. Escrita: só pelas funções abaixo.
DROP POLICY IF EXISTS "Exclusão: o próprio ou equipe da clínica" ON public.account_deletion_requests;
CREATE POLICY "Exclusão: o próprio ou equipe da clínica"
    ON public.account_deletion_requests FOR SELECT
    USING (user_id = auth.uid() OR public.is_clinic_staff(clinic_id));

CREATE OR REPLACE FUNCTION public.request_account_deletion(p_clinic_id UUID, p_reason TEXT DEFAULT NULL)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_id UUID;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Faça login para continuar.' USING ERRCODE = '28000';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.clinic_members
         WHERE clinic_id = p_clinic_id AND user_id = v_uid AND role = 'CLIENT' AND is_active
    ) THEN
        RAISE EXCEPTION 'Cadastro de cliente não encontrado nesta clínica.';
    END IF;

    SELECT id INTO v_id FROM public.account_deletion_requests
     WHERE clinic_id = p_clinic_id AND user_id = v_uid AND status = 'PENDING';
    IF FOUND THEN
        RETURN v_id; -- já existe um pedido em análise
    END IF;

    INSERT INTO public.account_deletion_requests (clinic_id, user_id, reason)
    VALUES (p_clinic_id, v_uid, left(NULLIF(trim(p_reason), ''), 500))
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_account_deletion_request(p_clinic_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Faça login para continuar.' USING ERRCODE = '28000';
    END IF;
    UPDATE public.account_deletion_requests
       SET status = 'CANCELLED', resolved_at = now()
     WHERE clinic_id = p_clinic_id AND user_id = auth.uid() AND status = 'PENDING';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Não há pedido de exclusão pendente.';
    END IF;
END;
$$;

-- ------------------------------------------------------------------------------
-- 4. PERMISSÕES DE EXECUÇÃO
-- ------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.reschedule_appointment_core(UUID, TIMESTAMPTZ, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reschedule_appointment(UUID, TIMESTAMPTZ, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reschedule_my_appointment(UUID, TIMESTAMPTZ, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_my_profile(TEXT, TEXT, BOOLEAN, BOOLEAN) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.request_account_deletion(UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_account_deletion_request(UUID) FROM PUBLIC, anon;
REVOKE ALL ON public.account_deletion_requests FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON public.account_deletion_requests FROM authenticated;
GRANT SELECT ON public.account_deletion_requests TO authenticated;

GRANT EXECUTE ON FUNCTION public.reschedule_appointment(UUID, TIMESTAMPTZ, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reschedule_my_appointment(UUID, TIMESTAMPTZ, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_my_profile(TEXT, TEXT, BOOLEAN, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_account_deletion(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_account_deletion_request(UUID) TO authenticated;

-- ##############################################################################
-- MIGRATION: 20261122000100_notificacoes.sql
-- ##############################################################################

-- ==============================================================================
-- MIGRATION 8 — FASE 5: NOTIFICAÇÕES (WhatsApp Cloud API + e-mail, retry, idempotência)
-- Rode DEPOIS de 20261121000100_area_cliente.sql. Pode ser reexecutada.
--
-- O que muda em public.notifications_log:
--   * Novo status SKIPPED: aviso descartado de propósito (opt-out, agendamento cancelado/passado).
--   * Controle de tentativas: retry_count (já existia), last_attempt_at, locked_at.
--   * fallback_from: canal original quando o aviso foi desviado (ex.: WhatsApp -> e-mail).
--   * delivered_at / read_at: preenchidos pelo webhook do WhatsApp.
--   * dedupe_key: idempotência. Um gatilho descarta a inserção de um aviso idêntico
--     (mesmo agendamento + modelo + horário) que já exista e não tenha falhado.
--     Confirmação/remarcação só deduplicam cliques repetidos (10 min); lembretes, para sempre.
-- Lembrete de 2h: um gatilho cria o aviso "appointment_reminder_2h" junto com a confirmação
-- ou a remarcação (sem mexer em book_appointment / reschedule). As funções que cancelam ou
-- remarcam já apagam TODOS os avisos QUEUED do agendamento, inclusive o de 2h.
-- Fila para o worker: claim_notifications() reserva lotes com FOR UPDATE SKIP LOCKED
-- (duas execuções simultâneas nunca pegam o mesmo aviso). Só o service_role executa.
-- Equipe: staff_requeue_notification() recoloca um aviso FAILED/SKIPPED na fila.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. STATUS E COLUNAS
-- ------------------------------------------------------------------------------
-- (o valor novo só é USADO dentro de funções, nunca nesta mesma transação)
ALTER TYPE public.notification_status ADD VALUE IF NOT EXISTS 'SKIPPED';

ALTER TABLE public.notifications_log ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ;
ALTER TABLE public.notifications_log ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ;
ALTER TABLE public.notifications_log ADD COLUMN IF NOT EXISTS fallback_from public.notification_channel;
ALTER TABLE public.notifications_log ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;
ALTER TABLE public.notifications_log ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;
ALTER TABLE public.notifications_log ADD COLUMN IF NOT EXISTS dedupe_key TEXT;

CREATE INDEX IF NOT EXISTS idx_notifications_dedupe
    ON public.notifications_log (dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_provider_msg
    ON public.notifications_log (provider_message_id) WHERE provider_message_id IS NOT NULL;

-- ------------------------------------------------------------------------------
-- 2. IDEMPOTÊNCIA (gatilho BEFORE INSERT)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notifications_dedupe()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
    IF NEW.appointment_id IS NULL THEN
        RETURN NEW;
    END IF;
    IF NEW.dedupe_key IS NULL THEN
        NEW.dedupe_key := NEW.appointment_id::text || ':' || NEW.template_name || ':' ||
                          COALESCE(NEW.payload->>'horario', '');
    END IF;
    -- Já existe um aviso igual (na fila, enviado ou descartado)? Não duplica.
    IF EXISTS (
        SELECT 1 FROM public.notifications_log n
         WHERE n.dedupe_key = NEW.dedupe_key
           AND n.status::text <> 'FAILED'
           -- Confirmação e remarcação só deduplicam cliques repetidos (10 min); lembretes, sempre.
           AND (NEW.template_name LIKE 'appointment_reminder%' OR n.created_at > now() - interval '10 minutes')
    ) THEN
        RETURN NULL;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_notifications_dedupe ON public.notifications_log;
CREATE TRIGGER tr_notifications_dedupe
    BEFORE INSERT ON public.notifications_log
    FOR EACH ROW EXECUTE FUNCTION public.notifications_dedupe();

-- ------------------------------------------------------------------------------
-- 3. LEMBRETE DE 2 HORAS (gatilho AFTER INSERT)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notifications_add_reminder_2h()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_start TIMESTAMPTZ;
BEGIN
    IF NEW.template_name NOT IN ('appointment_confirmed_instant', 'appointment_rescheduled')
       OR NEW.appointment_id IS NULL THEN
        RETURN NEW;
    END IF;
    BEGIN
        v_start := (NEW.payload->>'horario')::timestamptz;
    EXCEPTION WHEN others THEN
        RETURN NEW;
    END;
    IF v_start IS NULL OR v_start - interval '2 hours' <= now() THEN
        RETURN NEW;
    END IF;

    INSERT INTO public.notifications_log
        (clinic_id, appointment_id, recipient_id, channel, status, template_name, recipient_address, payload, scheduled_for)
    VALUES (NEW.clinic_id, NEW.appointment_id, NEW.recipient_id, NEW.channel, 'QUEUED',
            'appointment_reminder_2h', NEW.recipient_address, NEW.payload, v_start - interval '2 hours');
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_notifications_reminder_2h ON public.notifications_log;
CREATE TRIGGER tr_notifications_reminder_2h
    AFTER INSERT ON public.notifications_log
    FOR EACH ROW EXECUTE FUNCTION public.notifications_add_reminder_2h();

-- Agendamentos que já existiam: cria o lembrete de 2h que faltar (uma vez; é idempotente).
INSERT INTO public.notifications_log
    (clinic_id, appointment_id, recipient_id, channel, status, template_name, recipient_address, payload, scheduled_for)
SELECT a.clinic_id, a.id, a.client_id,
       CASE WHEN p.opt_in_whatsapp AND p.phone <> '' THEN 'WHATSAPP'::public.notification_channel
            ELSE 'EMAIL'::public.notification_channel END,
       'QUEUED', 'appointment_reminder_2h',
       CASE WHEN p.opt_in_whatsapp AND p.phone <> '' THEN p.phone ELSE p.email END,
       jsonb_build_object('clinica', c.name, 'procedimento', s.name, 'horario', a.start_time, 'profissional', pr.name),
       a.start_time - interval '2 hours'
  FROM public.appointments a
  JOIN public.profiles p ON p.id = a.client_id AND p.is_active
  JOIN public.clinics c ON c.id = a.clinic_id AND c.is_active
  JOIN public.services s ON s.id = a.service_id
  JOIN public.professionals pr ON pr.id = a.professional_id
 WHERE a.status IN ('PENDING', 'CONFIRMED')
   AND a.start_time - interval '2 hours' > now()
   AND (p.opt_in_whatsapp AND p.phone <> '' OR p.opt_in_email)
   AND NOT EXISTS (
       SELECT 1 FROM public.notifications_log n
        WHERE n.appointment_id = a.id AND n.template_name = 'appointment_reminder_2h'
   );

-- ------------------------------------------------------------------------------
-- 4. FILA PARA O WORKER
-- ------------------------------------------------------------------------------
-- Reserva até p_limit avisos vencidos. Reserva sem resposta por 10 min é considerada abandonada
-- (worker que caiu no meio) e volta a poder ser pega.
CREATE OR REPLACE FUNCTION public.claim_notifications(p_limit INTEGER DEFAULT 5)
RETURNS SETOF public.notifications_log
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
    UPDATE public.notifications_log n
       SET locked_at = now(), last_attempt_at = now()
     WHERE n.id IN (
         SELECT id FROM public.notifications_log
          WHERE status = 'QUEUED'
            AND scheduled_for <= now()
            AND (locked_at IS NULL OR locked_at < now() - interval '10 minutes')
          ORDER BY scheduled_for
          LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 5), 50))
            FOR UPDATE SKIP LOCKED
     )
    RETURNING n.*;
$$;

-- ------------------------------------------------------------------------------
-- 5. EQUIPE: REENVIAR UM AVISO
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.staff_requeue_notification(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_n public.notifications_log%ROWTYPE;
    v_status public.appointment_status;
BEGIN
    SELECT * INTO v_n FROM public.notifications_log WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Aviso não encontrado.';
    END IF;
    IF NOT public.is_clinic_staff(v_n.clinic_id) THEN
        RAISE EXCEPTION 'Apenas a equipe da clínica pode reenviar avisos.' USING ERRCODE = '42501';
    END IF;
    IF v_n.status::text NOT IN ('FAILED', 'SKIPPED') THEN
        RAISE EXCEPTION 'Só é possível reenviar avisos que falharam ou foram descartados.';
    END IF;

    SELECT status INTO v_status FROM public.appointments WHERE id = v_n.appointment_id;
    IF NOT FOUND OR v_status NOT IN ('PENDING', 'CONFIRMED') THEN
        RAISE EXCEPTION 'O agendamento deste aviso não está mais ativo.';
    END IF;
    IF (v_n.payload->>'horario')::timestamptz <= now() THEN
        RAISE EXCEPTION 'O horário do atendimento já passou.';
    END IF;

    UPDATE public.notifications_log
       SET status = 'QUEUED', retry_count = 0, scheduled_for = now(), locked_at = NULL,
           error_message = NULL, sent_at = NULL
     WHERE id = p_id;
END;
$$;

-- ------------------------------------------------------------------------------
-- 6. PERMISSÕES
-- ------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.notifications_dedupe() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notifications_add_reminder_2h() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_notifications(INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.staff_requeue_notification(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_requeue_notification(UUID) TO authenticated;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        GRANT EXECUTE ON FUNCTION public.claim_notifications(INTEGER) TO service_role;
    END IF;
END $$;

-- ##############################################################################
-- MIGRATION: 20261123000100_gestao_dono.sql
-- ##############################################################################

-- ==============================================================================
-- MIGRATION 9 — FASE 6: GESTÃO DO DONO (comissão por profissional + lista de espera)
-- Rode DEPOIS de 20261122000100_notificacoes.sql. Pode ser reexecutada.
--
-- Os relatórios (faturamento, no-show, ocupação, ticket médio, clientes novos x
-- recorrentes, top procedimentos), a lista de inativos e os aniversariantes são
-- calculados no app a partir dos agendamentos e do cadastro que a equipe já lê:
-- não precisam de tabela nova. Esta migration cria só o que ainda não existia:
--
--   1. professional_commissions: percentual de comissão de cada profissional.
--      Fica em tabela PRÓPRIA (e não em professionals) porque professionals é lida
--      pelos clientes; o percentual é dado financeiro e só o ADMIN da clínica enxerga.
--      RLS ligado e SEM política: acesso apenas pelas funções admin_*.
--   2. waitlist_entries: lista de espera (cliente que quer um horário que não havia).
--      A equipe cadastra, acompanha (aguardando -> contatado -> agendado/cancelado).
--      Sem dados de saúde: só cliente, procedimento e preferência de data/período.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. COMISSÃO POR PROFISSIONAL (somente ADMIN)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.professional_commissions (
    professional_id UUID PRIMARY KEY REFERENCES public.professionals(id) ON DELETE CASCADE,
    clinic_id UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
    commission_pct NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (commission_pct >= 0 AND commission_pct <= 100),
    updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);
CREATE INDEX IF NOT EXISTS idx_prof_commissions_clinic ON public.professional_commissions (clinic_id);

ALTER TABLE public.professional_commissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.professional_commissions FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_commissions(p_clinic_id UUID)
RETURNS TABLE (professional_id UUID, commission_pct NUMERIC)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF NOT public.is_clinic_admin(p_clinic_id) THEN
        RAISE EXCEPTION 'Apenas o administrador da clínica vê as comissões.' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY
        SELECT c.professional_id, c.commission_pct
          FROM public.professional_commissions c
         WHERE c.clinic_id = p_clinic_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_commission(
    p_clinic_id UUID,
    p_professional_id UUID,
    p_pct NUMERIC
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF NOT public.is_clinic_admin(p_clinic_id) THEN
        RAISE EXCEPTION 'Apenas o administrador da clínica altera as comissões.' USING ERRCODE = '42501';
    END IF;
    IF p_pct IS NULL OR p_pct < 0 OR p_pct > 100 THEN
        RAISE EXCEPTION 'A comissão deve ficar entre 0%% e 100%%.';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.professionals p
         WHERE p.id = p_professional_id AND p.clinic_id = p_clinic_id
    ) THEN
        RAISE EXCEPTION 'Profissional não encontrado nesta clínica.';
    END IF;

    INSERT INTO public.professional_commissions (professional_id, clinic_id, commission_pct, updated_by, updated_at)
    VALUES (p_professional_id, p_clinic_id, round(p_pct, 2), auth.uid(), now())
    ON CONFLICT (professional_id)
    DO UPDATE SET commission_pct = EXCLUDED.commission_pct,
                  updated_by = EXCLUDED.updated_by,
                  updated_at = EXCLUDED.updated_at;
END;
$$;

-- ------------------------------------------------------------------------------
-- 2. LISTA DE ESPERA
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.waitlist_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
    client_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    service_id UUID NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
    professional_id UUID REFERENCES public.professionals(id) ON DELETE SET NULL, -- NULL = qualquer profissional
    desired_from DATE,
    desired_to DATE,
    period TEXT NOT NULL DEFAULT 'ANY' CHECK (period IN ('ANY', 'MORNING', 'AFTERNOON', 'EVENING')),
    notes TEXT NOT NULL DEFAULT '' CHECK (char_length(notes) <= 300),
    status TEXT NOT NULL DEFAULT 'WAITING' CHECK (status IN ('WAITING', 'CONTACTED', 'BOOKED', 'CANCELLED')),
    created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    resolved_at TIMESTAMPTZ,
    CHECK (desired_to IS NULL OR desired_from IS NULL OR desired_to >= desired_from)
);
-- No máximo um pedido em aberto por cliente e procedimento
CREATE UNIQUE INDEX IF NOT EXISTS uq_waitlist_open
    ON public.waitlist_entries (clinic_id, client_id, service_id)
 WHERE status IN ('WAITING', 'CONTACTED');
CREATE INDEX IF NOT EXISTS idx_waitlist_clinic
    ON public.waitlist_entries (clinic_id, status, created_at);

ALTER TABLE public.waitlist_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.waitlist_entries FROM anon, authenticated;

-- Pedidos em aberto (aguardando ou já contatados), do mais antigo ao mais novo.
CREATE OR REPLACE FUNCTION public.staff_list_waitlist(p_clinic_id UUID)
RETURNS TABLE (
    id UUID, client_id UUID, client_name TEXT, client_phone TEXT,
    service_id UUID, service_name TEXT,
    professional_id UUID, professional_name TEXT,
    desired_from DATE, desired_to DATE, period TEXT, notes TEXT,
    status TEXT, created_at TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT w.id, w.client_id, pr.full_name::text, pr.phone::text,
           w.service_id, s.name::text,
           w.professional_id, pro.name::text,
           w.desired_from, w.desired_to, w.period, w.notes,
           w.status, w.created_at
      FROM public.waitlist_entries w
      JOIN public.profiles pr ON pr.id = w.client_id
      JOIN public.services s ON s.id = w.service_id
      LEFT JOIN public.professionals pro ON pro.id = w.professional_id
     WHERE w.clinic_id = p_clinic_id
       AND w.status IN ('WAITING', 'CONTACTED')
       AND public.is_clinic_staff(p_clinic_id)
     ORDER BY w.created_at;
$$;

CREATE OR REPLACE FUNCTION public.staff_add_waitlist(
    p_clinic_id UUID,
    p_client_id UUID,
    p_service_id UUID,
    p_professional_id UUID DEFAULT NULL,
    p_desired_from DATE DEFAULT NULL,
    p_desired_to DATE DEFAULT NULL,
    p_period TEXT DEFAULT 'ANY',
    p_notes TEXT DEFAULT ''
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_id UUID;
BEGIN
    IF NOT public.is_clinic_staff(p_clinic_id) THEN
        RAISE EXCEPTION 'Apenas a equipe da clínica gerencia a lista de espera.' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.clinic_members m
         WHERE m.clinic_id = p_clinic_id AND m.user_id = p_client_id AND m.role = 'CLIENT' AND m.is_active
    ) THEN
        RAISE EXCEPTION 'Cliente não encontrado (ou desativado) nesta clínica.';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.services s
         WHERE s.id = p_service_id AND s.clinic_id = p_clinic_id AND s.is_active
    ) THEN
        RAISE EXCEPTION 'Procedimento não encontrado (ou inativo) nesta clínica.';
    END IF;
    IF p_professional_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.professionals p
         WHERE p.id = p_professional_id AND p.clinic_id = p_clinic_id
    ) THEN
        RAISE EXCEPTION 'Profissional não encontrado nesta clínica.';
    END IF;
    IF p_desired_from IS NOT NULL AND p_desired_to IS NOT NULL AND p_desired_to < p_desired_from THEN
        RAISE EXCEPTION 'A data final não pode ser anterior à inicial.';
    END IF;
    IF COALESCE(p_period, 'ANY') NOT IN ('ANY', 'MORNING', 'AFTERNOON', 'EVENING') THEN
        RAISE EXCEPTION 'Período inválido.';
    END IF;
    IF EXISTS (
        SELECT 1 FROM public.waitlist_entries w
         WHERE w.clinic_id = p_clinic_id AND w.client_id = p_client_id AND w.service_id = p_service_id
           AND w.status IN ('WAITING', 'CONTACTED')
    ) THEN
        RAISE EXCEPTION 'Este cliente já está na lista de espera para esse procedimento.';
    END IF;

    INSERT INTO public.waitlist_entries
        (clinic_id, client_id, service_id, professional_id, desired_from, desired_to, period, notes, created_by)
    VALUES
        (p_clinic_id, p_client_id, p_service_id, p_professional_id, p_desired_from, p_desired_to,
         COALESCE(p_period, 'ANY'), COALESCE(left(trim(p_notes), 300), ''), auth.uid())
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.staff_set_waitlist_status(
    p_clinic_id UUID,
    p_id UUID,
    p_status TEXT
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF NOT public.is_clinic_staff(p_clinic_id) THEN
        RAISE EXCEPTION 'Apenas a equipe da clínica gerencia a lista de espera.' USING ERRCODE = '42501';
    END IF;
    IF p_status NOT IN ('WAITING', 'CONTACTED', 'BOOKED', 'CANCELLED') THEN
        RAISE EXCEPTION 'Situação inválida.';
    END IF;

    UPDATE public.waitlist_entries w
       SET status = p_status,
           resolved_at = CASE WHEN p_status IN ('BOOKED', 'CANCELLED') THEN now() ELSE NULL END
     WHERE w.id = p_id AND w.clinic_id = p_clinic_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pedido não encontrado nesta clínica.';
    END IF;
END;
$$;

-- ------------------------------------------------------------------------------
-- 3. PERMISSÕES
-- ------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.admin_list_commissions(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_set_commission(UUID, UUID, NUMERIC) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.staff_list_waitlist(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.staff_add_waitlist(UUID, UUID, UUID, UUID, DATE, DATE, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.staff_set_waitlist_status(UUID, UUID, TEXT) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_list_commissions(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_commission(UUID, UUID, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_list_waitlist(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_add_waitlist(UUID, UUID, UUID, UUID, DATE, DATE, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_set_waitlist_status(UUID, UUID, TEXT) TO authenticated;

