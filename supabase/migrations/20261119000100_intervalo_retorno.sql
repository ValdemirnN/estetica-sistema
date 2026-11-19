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
