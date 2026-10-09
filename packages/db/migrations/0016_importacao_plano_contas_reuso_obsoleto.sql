-- FIX #107 (SPEC-013 §3.7) — o reenvio idêntico só reaproveita o resultado terminal
-- (CONCLUIDA, CONCLUIDA_COM_REJEICOES, REJEITADA) se o plano de contas não mudou desde que ele
-- terminou. Se mudou, o resultado fica "obsoleto": sai da identidade idempotente e o reenvio abre
-- tentativa nova, que valida de novo contra o plano atual. A tentativa antiga continua no histórico,
-- intacta; só a marca `obsoleta` sobe, uma vez, na mesma instrução que decidiria o reuso
-- (`criarTentativa`, ON CONFLICT ... DO UPDATE, com a linha travada).
--
-- A versão do plano em que o resultado terminou não precisa de coluna: REJEITADA termina na versão
-- da validação (`plano_versao_na_validacao`); CONCLUIDA* termina nessa versão + 1, porque a
-- confirmação exige versão igual à da validação e a aplicação sobe a versão exatamente uma vez na
-- mesma transação. Assim as tentativas já gravadas pela 0015 também são cobertas, sem backfill.

ALTER TABLE app.importacao_plano_contas
  ADD COLUMN obsoleta boolean NOT NULL DEFAULT false;

-- Só um resultado reutilizável fica obsoleto: tentativa viva nunca sai da identidade (I-9), e
-- FALHA/CANCELADA já estão fora dela.
ALTER TABLE app.importacao_plano_contas
  ADD CONSTRAINT importacao_plano_contas_obsoleta_so_com_resultado CHECK (
    NOT obsoleta OR estado IN ('CONCLUIDA', 'CONCLUIDA_COM_REJEICOES', 'REJEITADA')
  );

-- Identidade idempotente: viva ou com resultado reutilizável AINDA ATUAL. A aplicação usa
-- `ON CONFLICT (...) WHERE estado NOT IN ('FALHA', 'CANCELADA') AND NOT obsoleta`.
DROP INDEX app.importacao_plano_contas_idempotente;
CREATE UNIQUE INDEX importacao_plano_contas_idempotente
  ON app.importacao_plano_contas (empresa_id, tenant_id, hash_arquivo, mapeamento)
  WHERE estado NOT IN ('FALHA', 'CANCELADA') AND NOT obsoleta;

-- Estado terminal continua congelado. Depois do fim só sobem as marcas do histórico: o reuso
-- idempotente e, agora, a obsolescência — que nunca volta atrás (o resultado obsoleto não reassume
-- a identidade de quem já o substituiu).
CREATE OR REPLACE FUNCTION app.proteger_importacao_plano_contas() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.estado IN ('CONCLUIDA', 'CONCLUIDA_COM_REJEICOES', 'REJEITADA', 'CANCELADA', 'FALHA')
     AND (to_jsonb(NEW) - 'reutilizada_por_idempotencia' - 'obsoleta')
         IS DISTINCT FROM (to_jsonb(OLD) - 'reutilizada_por_idempotencia' - 'obsoleta') THEN
    RAISE EXCEPTION 'tentativa de importacao em estado terminal nao muda'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF OLD.obsoleta AND NOT NEW.obsoleta THEN
    RAISE EXCEPTION 'tentativa de importacao obsoleta nao volta a valer'
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- O mapeamento faz parte da identidade idempotente e e o "mapeamento utilizado" da previa
  -- (SPEC-013 §3.9, §6.3): so muda antes da validacao comecar.
  IF NEW.mapeamento IS DISTINCT FROM OLD.mapeamento AND OLD.estado <> 'RECEBIDA' THEN
    RAISE EXCEPTION 'o mapeamento da tentativa so muda enquanto RECEBIDA'
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$;

GRANT UPDATE (obsoleta) ON app.importacao_plano_contas TO contaia_app;
