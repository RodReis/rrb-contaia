-- FIX #163: a transição de cancelamento permite gravar somente o motivo junto ao estado.
CREATE OR REPLACE FUNCTION app.proteger_lancamento_efetivado() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.estado<>'DRAFT' AND (
    NEW.data_contabil IS DISTINCT FROM OLD.data_contabil OR
    NEW.competencia IS DISTINCT FROM OLD.competencia OR
    NEW.historico IS DISTINCT FROM OLD.historico OR
    NEW.referencia_externa IS DISTINCT FROM OLD.referencia_externa OR
    NEW.exercicio IS DISTINCT FROM OLD.exercicio OR
    NEW.numero IS DISTINCT FROM OLD.numero OR
    NEW.versao IS DISTINCT FROM OLD.versao OR
    NEW.criado_por IS DISTINCT FROM OLD.criado_por OR
    NEW.efetivado_por IS DISTINCT FROM OLD.efetivado_por OR
    NEW.estorno_de_id IS DISTINCT FROM OLD.estorno_de_id OR
    (NEW.cancelamento_motivo IS DISTINCT FROM OLD.cancelamento_motivo AND NOT (OLD.estado='POSTED' AND NEW.estado='CANCELLED'))
  ) THEN
    RAISE EXCEPTION 'ACCOUNTING_ENTRY_IMMUTABLE' USING ERRCODE='restrict_violation';
  END IF;
  IF OLD.estado<>'DRAFT' AND NEW.estado IS DISTINCT FROM OLD.estado AND NOT (OLD.estado='POSTED' AND NEW.estado IN ('CANCELLED','REVERSED')) THEN
    RAISE EXCEPTION 'ACCOUNTING_ENTRY_IMMUTABLE' USING ERRCODE='restrict_violation';
  END IF;
  IF OLD.estado='DRAFT' AND NEW.estado NOT IN ('DRAFT','POSTED','DISCARDED') THEN
    RAISE EXCEPTION 'ACCOUNTING_ENTRY_IMMUTABLE' USING ERRCODE='restrict_violation';
  END IF;
  IF OLD.estado='POSTED' AND NEW.estado='CANCELLED' AND length(btrim(coalesce(NEW.cancelamento_motivo,'')))=0 THEN
    RAISE EXCEPTION 'ACCOUNTING_ENTRY_CANCELLATION_FORBIDDEN' USING ERRCODE='check_violation';
  END IF;
  IF OLD.estado='DRAFT' AND NEW.estado<>'DRAFT' AND current_setting('app.lancamento_contabil_transicao',true) IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'ACCOUNTING_ENTRY_IMMUTABLE' USING ERRCODE='restrict_violation';
  END IF;
  RETURN NEW;
END; $$;
