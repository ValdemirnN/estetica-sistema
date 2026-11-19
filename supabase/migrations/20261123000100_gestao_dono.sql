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
