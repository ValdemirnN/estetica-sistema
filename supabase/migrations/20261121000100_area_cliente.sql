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
