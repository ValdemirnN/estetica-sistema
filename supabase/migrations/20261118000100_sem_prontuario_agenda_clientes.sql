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
