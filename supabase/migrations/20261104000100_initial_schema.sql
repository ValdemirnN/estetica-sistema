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
INSERT INTO public.service_categories (id, name, slug, description, display_order)
VALUES 
    ('c1111111-1111-1111-1111-111111111111', 'Facial & Rejuvenescimento', 'facial', 'Limpeza profunda, peelings e hidratações', 1),
    ('c2222222-2222-2222-2222-222222222222', 'Injetáveis & Harmonização', 'injetaveis', 'Botox, bioestimuladores e preenchedores', 2),
    ('c3333333-3333-3333-3333-333333333333', 'Corporal & Modeladora', 'corporal', 'Drenagem linfática e massagens modeladoras', 3),
    ('c4444444-4444-4444-4444-444444444444', 'Tecnologias & Laser', 'laser', 'Depilação a laser e clareamento', 4)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.services (id, category_id, name, slug, description, duration_minutes, price_cents, requires_anamnesis)
VALUES
    ('a1111111-1111-1111-1111-111111111111', 'c1111111-1111-1111-1111-111111111111', 'Limpeza de Pele Profunda com Peeling', 'limpeza-de-pele-profunda', 'Extração profunda com vapor de ozônio e máscara hidroplástica calmante.', 75, 22000, TRUE),
    ('a2222222-2222-2222-2222-222222222222', 'c2222222-2222-2222-2222-222222222222', 'Toxina Botulínica (Botox) Full Face', 'botox-full-face', 'Suavização de rugas dinâmicas na testa, glabela e pés de galinha.', 45, 145000, TRUE),
    ('a3333333-3333-3333-3333-333333333333', 'c2222222-2222-2222-2222-222222222222', 'Preenchimento Labial HidraGloss', 'preenchimento-labial', 'Ácido hialurônico para volume e contorno labial natural.', 60, 125000, TRUE),
    ('a4444444-4444-4444-4444-444444444444', 'c3333333-3333-3333-3333-333333333333', 'Drenagem Linfática Facial Descongestionante', 'drenagem-facial', 'Redução de inchaço e ativação da circulação.', 40, 16000, FALSE),
    ('a5555555-5555-5555-5555-555555555555', 'c4444444-4444-4444-4444-444444444444', 'Depilação a Laser Soprano Titanium (Virilha + Axilas)', 'laser-soprano', 'Depilação indolor com resfriamento térmico de safira.', 30, 28000, TRUE)
ON CONFLICT (id) DO NOTHING;
