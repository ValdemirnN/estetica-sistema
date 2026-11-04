export const FULL_SQL_SCHEMA = `-- ==============================================================================
-- SISTEMA DE AGENDAMENTO CLÍNICA DE ESTÉTICA (PRODUÇÃO)
-- MIGRATION: 20261104000100_initial_schema.sql
-- ==============================================================================

-- 1. EXTENSÕES NECESSÁRIAS
-- btree_gist é obrigatória para EXCLUDE constraint combinando UUID + TSRANGE
CREATE EXTENSION IF NOT EXISTS "btree_gist";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. TIPOS CUSTOMIZADOS (ENUMS)
CREATE TYPE user_role AS ENUM ('CLIENT', 'PROFESSIONAL', 'RECEPTIONIST', 'ADMIN');
CREATE TYPE appointment_status AS ENUM ('PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW');
CREATE TYPE day_of_week AS ENUM ('MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY');
CREATE TYPE notification_channel AS ENUM ('WHATSAPP', 'EMAIL');
CREATE TYPE notification_status AS ENUM ('QUEUED', 'SENT', 'FAILED', 'DELIVERED', 'READ');

-- 3. TABELA DE PERFIS DE USUÁRIO (Vinculada ao auth.users do Supabase)
CREATE TABLE public.profiles (
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

-- 4. TABELA DE PROFISSIONAIS (Extensão do perfil com dados técnicos)
CREATE TABLE public.professionals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
    bio TEXT,
    registry_number VARCHAR(50), -- Ex: CRBM, COREN ou Estética
    color_hex VARCHAR(7) NOT NULL DEFAULT '#ec4899',
    interval_buffer_minutes INTEGER NOT NULL DEFAULT 15, -- Intervalo higienização/descanso
    is_available_for_auto_assign BOOLEAN NOT NULL DEFAULT TRUE, -- Participa do "Primeiro Disponível"
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 5. CATEGORIAS DE PROCEDIMENTOS
CREATE TABLE public.service_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL UNIQUE,
    slug VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    display_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 6. CATÁLOGO DE PROCEDIMENTOS / SERVIÇOS
CREATE TABLE public.services (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category_id UUID NOT NULL REFERENCES public.service_categories(id) ON DELETE RESTRICT,
    name VARCHAR(150) NOT NULL,
    slug VARCHAR(150) NOT NULL UNIQUE,
    description TEXT,
    duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
    price_cents INTEGER NOT NULL CHECK (price_cents >= 0), -- Armazenado em centavos
    recovery_info TEXT, -- Cuidados pré/pós procedimento
    requires_anamnesis BOOLEAN NOT NULL DEFAULT TRUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 7. VÍNCULO PROFISSIONAL <-> PROCEDIMENTO (Especialidades e durações customizadas)
CREATE TABLE public.professional_services (
    professional_id UUID NOT NULL REFERENCES public.professionals(id) ON DELETE CASCADE,
    service_id UUID NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
    custom_duration_minutes INTEGER,
    custom_price_cents INTEGER,
    PRIMARY KEY (professional_id, service_id)
);

-- 8. JORNADA DE TRABALHO SEMANAL DO PROFISSIONAL
CREATE TABLE public.professional_working_hours (
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

-- 9. AUSÊNCIAS, FÉRIAS E FOLGAS PONTUAIS
CREATE TABLE public.professional_leaves (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    professional_id UUID NOT NULL REFERENCES public.professionals(id) ON DELETE CASCADE,
    start_datetime TIMESTAMPTZ NOT NULL,
    end_datetime TIMESTAMPTZ NOT NULL,
    reason VARCHAR(255),
    CONSTRAINT check_leave_period CHECK (start_datetime < end_datetime)
);

-- 10. TABELA CENTRAL DE AGENDAMENTOS COM CONSTRAINTS CRÍTICAS
CREATE TABLE public.appointments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    professional_id UUID NOT NULL REFERENCES public.professionals(id) ON DELETE RESTRICT,
    service_id UUID NOT NULL REFERENCES public.services(id) ON DELETE RESTRICT,
    
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    buffer_end_time TIMESTAMPTZ NOT NULL, -- Inclui o intervalo pós-atendimento
    
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
    CONSTRAINT prevent_professional_double_booking EXCLUDE USING gist (
        professional_id WITH =,
        tsrange(start_time, buffer_end_time, '[)') WITH &&
    ) WHERE (status IN ('PENDING', 'CONFIRMED'))
);

-- 11. FICHA DE ANAMNESE E DADOS DE SAÚDE (DADOS SENSÍVEIS - LGPD)
CREATE TABLE public.anamnesis_records (
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

-- 12. LOG DE AUDITORIA DE ACESSO A DADOS DE SAÚDE (EXIGÊNCIA LGPD)
CREATE TABLE public.anamnesis_access_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    anamnesis_id UUID NOT NULL REFERENCES public.anamnesis_records(id) ON DELETE CASCADE,
    accessed_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    accessed_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    action VARCHAR(50) NOT NULL,
    ip_address INET,
    user_agent TEXT
);

-- 13. FILA E HISTÓRICO DE NOTIFICAÇÕES (WhatsApp e E-mail)
CREATE TABLE public.notifications_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    appointment_id UUID REFERENCES public.appointments(id) ON DELETE CASCADE,
    recipient_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    channel notification_channel NOT NULL,
    status notification_status NOT NULL DEFAULT 'QUEUED',
    template_name VARCHAR(100) NOT NULL,
    recipient_address VARCHAR(255) NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    provider_message_id VARCHAR(255),
    error_message TEXT,
    scheduled_for TIMESTAMPTZ NOT NULL,
    sent_at TIMESTAMPTZ,
    retry_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 14. ÍNDICES ESTRATÉGICOS
CREATE INDEX idx_appointments_prof_time ON public.appointments (professional_id, start_time, end_time) 
    WHERE status IN ('PENDING', 'CONFIRMED');
CREATE INDEX idx_appointments_client_date ON public.appointments (client_id, start_time DESC);
CREATE INDEX idx_working_hours_prof ON public.professional_working_hours (professional_id, day_of_week);
CREATE INDEX idx_leaves_prof_interval ON public.professional_leaves USING gist (
    professional_id WITH =,
    tsrange(start_datetime, end_datetime, '[)') WITH &&
);
CREATE INDEX idx_notifications_pending_dispatch ON public.notifications_log (status, scheduled_for) 
    WHERE status = 'QUEUED';

-- 15. TRIGGERS DE updated_at
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER tr_professionals_updated BEFORE UPDATE ON public.professionals FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER tr_services_updated BEFORE UPDATE ON public.services FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER tr_appointments_updated BEFORE UPDATE ON public.appointments FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER tr_anamnesis_updated BEFORE UPDATE ON public.anamnesis_records FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
`;
