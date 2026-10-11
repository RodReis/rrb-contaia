-- SPEC-015/F15 — Planilhas XLSX/ODS nas importacoes de plano de contas (F13) e empregados (F14).
--
-- As duas tentativas ganham a configuracao da planilha (formato, aba, linha de cabecalho), que
-- entra na identidade idempotente (SPEC-015 §3.8), e o resultado da leitura que o worker registra
-- (linhas ignoradas antes do cabecalho, linhas ocultas, diagnosticos; §3.9, §6.3). A trilha ganha
-- as acoes SELECAO_DE_PLANILHA (API, no envio) e LEITURA_PLANILHA (worker). Tentativas existentes
-- ficam CSV pelos padroes (sem aba, cabecalho na linha 1, leitura zerada). Nenhuma tabela nova:
-- RLS, escopo imutavel, append-only e a ausencia de DELETE continuam os da 0015/0017.
--
-- Plano de rollback (sem migration "down" no runner: aplicar a mao, numa transacao). Perde a
-- configuracao e os diagnosticos das tentativas de planilha (formato, aba, cabecalho, linhas
-- ignoradas/ocultas, diagnosticos); elas continuam no historico, mas passam a parecer CSV. Os
-- eventos SELECAO_DE_PLANILHA/LEITURA_PLANILHA ficam (append-only): o CHECK antigo volta NOT VALID,
-- valendo so para linhas novas. Se duas tentativas vivas (ou com resultado ainda atual) diferem so
-- pela aba/cabecalho/formato, o indice antigo recusa a recriacao (23505): antes, cancelar a viva ou
-- marcar `obsoleta` no resultado terminal. O bloco abaixo e executado pelo teste de banco.
-- ROLLBACK:INICIO
-- ALTER TABLE app.importacao_plano_contas
--   DROP COLUMN formato, DROP COLUMN aba_nome, DROP COLUMN aba_posicao, DROP COLUMN linha_cabecalho,
--   DROP COLUMN linhas_ignoradas_antes_do_cabecalho, DROP COLUMN linhas_ocultas, DROP COLUMN diagnosticos;
-- ALTER TABLE app.importacao_empregados
--   DROP COLUMN formato, DROP COLUMN aba_nome, DROP COLUMN aba_posicao, DROP COLUMN linha_cabecalho,
--   DROP COLUMN linhas_ignoradas_antes_do_cabecalho, DROP COLUMN linhas_ocultas, DROP COLUMN diagnosticos;
-- CREATE UNIQUE INDEX importacao_plano_contas_idempotente
--   ON app.importacao_plano_contas (empresa_id, tenant_id, hash_arquivo, mapeamento)
--   WHERE estado NOT IN ('FALHA', 'CANCELADA') AND NOT obsoleta;
-- CREATE UNIQUE INDEX importacao_empregados_idempotente
--   ON app.importacao_empregados (empresa_id, tenant_id, hash_arquivo, mapeamento)
--   WHERE estado NOT IN ('FALHA', 'CANCELADA') AND NOT obsoleta;
-- CREATE OR REPLACE FUNCTION app.proteger_importacao_plano_contas() RETURNS trigger
-- LANGUAGE plpgsql AS $$
-- BEGIN
--   IF OLD.estado IN ('CONCLUIDA', 'CONCLUIDA_COM_REJEICOES', 'REJEITADA', 'CANCELADA', 'FALHA')
--      AND (to_jsonb(NEW) - 'reutilizada_por_idempotencia' - 'obsoleta')
--          IS DISTINCT FROM (to_jsonb(OLD) - 'reutilizada_por_idempotencia' - 'obsoleta') THEN
--     RAISE EXCEPTION 'tentativa de importacao em estado terminal nao muda'
--       USING ERRCODE = 'restrict_violation';
--   END IF;
--   IF OLD.obsoleta AND NOT NEW.obsoleta THEN
--     RAISE EXCEPTION 'tentativa de importacao obsoleta nao volta a valer'
--       USING ERRCODE = 'restrict_violation';
--   END IF;
--   IF NEW.mapeamento IS DISTINCT FROM OLD.mapeamento AND OLD.estado <> 'RECEBIDA' THEN
--     RAISE EXCEPTION 'o mapeamento da tentativa so muda enquanto RECEBIDA'
--       USING ERRCODE = 'restrict_violation';
--   END IF;
--   RETURN NEW;
-- END;
-- $$;
-- CREATE OR REPLACE FUNCTION app.proteger_tentativa_de_importacao() RETURNS trigger
-- LANGUAGE plpgsql AS $$
-- BEGIN
--   IF OLD.estado IN ('CONCLUIDA', 'CONCLUIDA_COM_REJEICOES', 'REJEITADA', 'CANCELADA', 'FALHA')
--      AND (to_jsonb(NEW) - 'reutilizada_por_idempotencia' - 'obsoleta')
--          IS DISTINCT FROM (to_jsonb(OLD) - 'reutilizada_por_idempotencia' - 'obsoleta') THEN
--     RAISE EXCEPTION 'tentativa de importacao em estado terminal nao muda'
--       USING ERRCODE = 'restrict_violation';
--   END IF;
--   IF OLD.obsoleta AND NOT NEW.obsoleta THEN
--     RAISE EXCEPTION 'tentativa de importacao obsoleta nao volta a valer'
--       USING ERRCODE = 'restrict_violation';
--   END IF;
--   IF NEW.mapeamento IS DISTINCT FROM OLD.mapeamento AND OLD.estado <> 'RECEBIDA' THEN
--     RAISE EXCEPTION 'o mapeamento da tentativa so muda enquanto RECEBIDA'
--       USING ERRCODE = 'restrict_violation';
--   END IF;
--   RETURN NEW;
-- END;
-- $$;
-- ALTER TABLE app.importacao_plano_contas_evento DROP CONSTRAINT importacao_plano_contas_evento_acao_check;
-- ALTER TABLE app.importacao_plano_contas_evento ADD CONSTRAINT importacao_plano_contas_evento_acao_check
--   CHECK (acao IN (
--     'CRIACAO', 'REUTILIZACAO',
--     'INICIAR_VALIDACAO', 'VALIDACAO_SUCESSO', 'VALIDACAO_REJEITADA', 'FALHA_TECNICA',
--     'CONFIRMAR', 'CANCELAR', 'APLICACAO_SUCESSO', 'APLICACAO_SUCESSO_COM_REJEICOES'
--   )) NOT VALID;
-- ALTER TABLE app.importacao_empregados_evento DROP CONSTRAINT importacao_empregados_evento_acao_check;
-- ALTER TABLE app.importacao_empregados_evento ADD CONSTRAINT importacao_empregados_evento_acao_check
--   CHECK (acao IN (
--     'CRIACAO', 'REUTILIZACAO',
--     'INICIAR_VALIDACAO', 'VALIDACAO_SUCESSO', 'VALIDACAO_REJEITADA', 'FALHA_TECNICA',
--     'CONFIRMAR', 'CANCELAR', 'APLICACAO_SUCESSO', 'APLICACAO_SUCESSO_COM_REJEICOES'
--   )) NOT VALID;
-- ROLLBACK:FIM
--
-- (DROP COLUMN leva junto o indice de idempotencia novo, os CHECKs das colunas e os privilegios de
-- coluna; DELETE from public.__migrations where nome = '0018_importacao_planilhas.sql' fecha o rollback.)

-- 1. Configuracao e leitura da planilha nas duas tentativas --------------------------------------

-- Mesmas colunas e regras nas duas tabelas. `aba_posicao` 0 = nao se aplica (CSV); a aba e
-- identificada pela posicao (o nome e o exibido). `diagnosticos` e a lista do contrato
-- compartilhado (DiagnosticoDeLeituraSchema: codigo, mensagem fixa, quantidade); aqui so o formato.
DO $$
DECLARE
  tabela text;
BEGIN
  FOREACH tabela IN ARRAY ARRAY['importacao_plano_contas', 'importacao_empregados'] LOOP
    EXECUTE format($sql$
      ALTER TABLE app.%1$I
        ADD COLUMN formato text NOT NULL DEFAULT 'CSV',
        ADD COLUMN aba_nome text,
        ADD COLUMN aba_posicao integer NOT NULL DEFAULT 0,
        ADD COLUMN linha_cabecalho integer NOT NULL DEFAULT 1,
        ADD COLUMN linhas_ignoradas_antes_do_cabecalho integer NOT NULL DEFAULT 0,
        ADD COLUMN linhas_ocultas integer NOT NULL DEFAULT 0,
        ADD COLUMN diagnosticos jsonb NOT NULL DEFAULT '[]',
        ADD CONSTRAINT %1$s_formato_check CHECK (formato IN ('CSV', 'XLSX', 'ODS')),
        ADD CONSTRAINT %1$s_aba_posicao_check CHECK (aba_posicao >= 0),
        ADD CONSTRAINT %1$s_linha_cabecalho_check CHECK (linha_cabecalho >= 1),
        ADD CONSTRAINT %1$s_leitura_check CHECK (
          linhas_ignoradas_antes_do_cabecalho >= 0 AND linhas_ocultas >= 0
        ),
        ADD CONSTRAINT %1$s_diagnosticos_check CHECK (jsonb_typeof(diagnosticos) = 'array'),
        -- CSV nao tem aba; planilha sempre tem (uma aba por tentativa, SPEC-015 §3.2/§3.3).
        ADD CONSTRAINT %1$s_aba_condizente CHECK (
          CASE WHEN formato = 'CSV'
            THEN aba_posicao = 0 AND aba_nome IS NULL
            ELSE aba_posicao >= 1 AND aba_nome IS NOT NULL
          END
        )
    $sql$, tabela);
  END LOOP;
END
$$;

-- 2. Identidade idempotente com a configuracao (SPEC-015 §3.8) ----------------------------------

-- tenant + empresa + (dominio = tabela) + hash + formato + aba + cabecalho + mapeamento; o
-- predicado do FIX #107 nao muda. A aplicacao usa
-- `ON CONFLICT (empresa_id, tenant_id, hash_arquivo, formato, aba_posicao, linha_cabecalho, mapeamento)
--  WHERE estado NOT IN ('FALHA', 'CANCELADA') AND NOT obsoleta` (a inferencia ignora a ordem).
DROP INDEX app.importacao_plano_contas_idempotente;
CREATE UNIQUE INDEX importacao_plano_contas_idempotente
  ON app.importacao_plano_contas
     (empresa_id, tenant_id, hash_arquivo, formato, aba_posicao, linha_cabecalho, mapeamento)
  WHERE estado NOT IN ('FALHA', 'CANCELADA') AND NOT obsoleta;

DROP INDEX app.importacao_empregados_idempotente;
CREATE UNIQUE INDEX importacao_empregados_idempotente
  ON app.importacao_empregados
     (empresa_id, tenant_id, hash_arquivo, formato, aba_posicao, linha_cabecalho, mapeamento)
  WHERE estado NOT IN ('FALHA', 'CANCELADA') AND NOT obsoleta;

-- 3. Protecao da tentativa ------------------------------------------------------------------------

-- Regras da 0016/0017 (terminal congelado salvo as marcas; obsoleta nao volta; mapeamento so em
-- RECEBIDA) e mais: a configuracao da planilha e identidade, como o mapeamento, e so muda enquanto
-- RECEBIDA; a leitura e do worker e so muda enquanto RECEBIDA ou VALIDANDO (a repeticao do job
-- sobrescreve). As duas funcoes ficam iguais; cada tabela mantem a sua trigger.
CREATE OR REPLACE FUNCTION app.proteger_tentativa_de_importacao() RETURNS trigger
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

  IF (NEW.mapeamento, NEW.formato, NEW.aba_nome, NEW.aba_posicao, NEW.linha_cabecalho)
       IS DISTINCT FROM (OLD.mapeamento, OLD.formato, OLD.aba_nome, OLD.aba_posicao, OLD.linha_cabecalho)
     AND OLD.estado <> 'RECEBIDA' THEN
    RAISE EXCEPTION 'o mapeamento e a configuracao da planilha so mudam enquanto RECEBIDA'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF (NEW.linhas_ignoradas_antes_do_cabecalho, NEW.linhas_ocultas, NEW.diagnosticos)
       IS DISTINCT FROM (OLD.linhas_ignoradas_antes_do_cabecalho, OLD.linhas_ocultas, OLD.diagnosticos)
     AND OLD.estado NOT IN ('RECEBIDA', 'VALIDANDO') THEN
    RAISE EXCEPTION 'a leitura da planilha so muda enquanto RECEBIDA ou VALIDANDO'
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$;

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

  IF (NEW.mapeamento, NEW.formato, NEW.aba_nome, NEW.aba_posicao, NEW.linha_cabecalho)
       IS DISTINCT FROM (OLD.mapeamento, OLD.formato, OLD.aba_nome, OLD.aba_posicao, OLD.linha_cabecalho)
     AND OLD.estado <> 'RECEBIDA' THEN
    RAISE EXCEPTION 'o mapeamento e a configuracao da planilha so mudam enquanto RECEBIDA'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF (NEW.linhas_ignoradas_antes_do_cabecalho, NEW.linhas_ocultas, NEW.diagnosticos)
       IS DISTINCT FROM (OLD.linhas_ignoradas_antes_do_cabecalho, OLD.linhas_ocultas, OLD.diagnosticos)
     AND OLD.estado NOT IN ('RECEBIDA', 'VALIDANDO') THEN
    RAISE EXCEPTION 'a leitura da planilha so muda enquanto RECEBIDA ou VALIDANDO'
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$;

-- 4. Trilha: selecao e leitura da planilha (I-6) ------------------------------------------------

ALTER TABLE app.importacao_plano_contas_evento DROP CONSTRAINT importacao_plano_contas_evento_acao_check;
ALTER TABLE app.importacao_plano_contas_evento ADD CONSTRAINT importacao_plano_contas_evento_acao_check
  CHECK (acao IN (
    'CRIACAO', 'REUTILIZACAO', 'SELECAO_DE_PLANILHA', 'LEITURA_PLANILHA',
    'INICIAR_VALIDACAO', 'VALIDACAO_SUCESSO', 'VALIDACAO_REJEITADA', 'FALHA_TECNICA',
    'CONFIRMAR', 'CANCELAR', 'APLICACAO_SUCESSO', 'APLICACAO_SUCESSO_COM_REJEICOES'
  ));

ALTER TABLE app.importacao_empregados_evento DROP CONSTRAINT importacao_empregados_evento_acao_check;
ALTER TABLE app.importacao_empregados_evento ADD CONSTRAINT importacao_empregados_evento_acao_check
  CHECK (acao IN (
    'CRIACAO', 'REUTILIZACAO', 'SELECAO_DE_PLANILHA', 'LEITURA_PLANILHA',
    'INICIAR_VALIDACAO', 'VALIDACAO_SUCESSO', 'VALIDACAO_REJEITADA', 'FALHA_TECNICA',
    'CONFIRMAR', 'CANCELAR', 'APLICACAO_SUCESSO', 'APLICACAO_SUCESSO_COM_REJEICOES'
  ));

-- 5. Privilegios ----------------------------------------------------------------------------------

-- So a leitura e gravada depois da criacao (worker). A configuracao nasce no INSERT e a aplicacao
-- nao tem UPDATE nela (a trigger vale tambem para o superusuario).
GRANT UPDATE (linhas_ignoradas_antes_do_cabecalho, linhas_ocultas, diagnosticos)
  ON app.importacao_plano_contas TO contaia_app;
GRANT UPDATE (linhas_ignoradas_antes_do_cabecalho, linhas_ocultas, diagnosticos)
  ON app.importacao_empregados TO contaia_app;
