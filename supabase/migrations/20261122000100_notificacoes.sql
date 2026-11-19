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
