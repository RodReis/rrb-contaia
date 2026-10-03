-- SPEC-011/F11 — Cofre local de certificados A1: metadados, historico, tickets e alertas.
--
-- O Vault guarda PKCS#12 e senha; o banco guarda SO metadados e uma referencia
-- opaca (`referencia_segredo`, UUID sem caminho nem conteudo). Nenhuma coluna aqui
-- recebe arquivo, senha, chave privada ou token (SPEC-011 §6.3).
--
-- Quatro tabelas, todas da classe `empresa` (tenant + empresa autorizada pela
-- carteira, SPEC-010), com FK composta em tenant, RLS forcada, trigger de escopo
-- imutavel e sem DELETE (I-7):
--   * empresa_certificado             uma linha por VERSAO; um VIGENTE por empresa;
--   * empresa_certificado_evento      historico append-only (I-6);
--   * empresa_certificado_ingestao    ticket de envio, de uso unico;
--   * empresa_certificado_notificacao alerta individual, uma vez por marco.
-- Reconcilia tambem a Central de Pendencias (origem CERTIFICADO) e faz o backfill.

-- 1. Versao do certificado ---------------------------------------------------

CREATE TABLE app.empresa_certificado (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES app.tenant(id),
  empresa_id uuid NOT NULL,

  -- Contador funcional por empresa: 1, 2, 3...
  versao integer NOT NULL CHECK (versao > 0),
  estado text NOT NULL DEFAULT 'VIGENTE' CHECK (estado IN ('VIGENTE', 'SUBSTITUIDO', 'DESATIVADO')),

  titular text NOT NULL,
  cnpj_titular text NOT NULL,
  autoridade_certificadora text NOT NULL,
  -- Cadeia ICP-Brasil validada, do titular para a raiz (apenas nomes).
  cadeia text[] NOT NULL,
  numero_serie text NOT NULL,
  -- SHA-256 hexadecimal: identifica o certificado sem revelar nada dele.
  impressao_digital text NOT NULL,
  -- Datas civis (I-11): America/Sao_Paulo, derivadas no dominio.
  valido_de date NOT NULL,
  valido_ate date NOT NULL,

  responsavel_id uuid NOT NULL,
  -- UUID opaco da versao do segredo no Vault. Nunca um caminho nem o conteudo.
  referencia_segredo uuid NOT NULL,

  cadastrado_em timestamptz NOT NULL DEFAULT now(),
  cadastrado_por uuid NOT NULL,
  encerrado_em timestamptz,
  encerrado_por uuid,
  motivo_encerramento text CHECK (motivo_encerramento IN ('SUBSTITUICAO', 'DESATIVACAO')),
  -- Motivo livre da desativacao; nulo na substituicao.
  justificativa text,
  substituido_por uuid,

  CONSTRAINT empresa_certificado_escopo UNIQUE (id, empresa_id, tenant_id),
  CONSTRAINT empresa_certificado_versao_unica UNIQUE (empresa_id, versao),
  CONSTRAINT empresa_certificado_validade_condizente CHECK (valido_ate >= valido_de),
  -- O par (estado, campos de encerramento) inconsistente seria um historico que a
  -- interface nao sabe explicar: cada estado carrega exatamente o que lhe cabe.
  CONSTRAINT empresa_certificado_encerramento_condizente CHECK (
    (estado = 'VIGENTE'
       AND encerrado_em IS NULL AND encerrado_por IS NULL AND motivo_encerramento IS NULL
       AND justificativa IS NULL AND substituido_por IS NULL)
    OR (estado = 'SUBSTITUIDO'
       AND encerrado_em IS NOT NULL AND encerrado_por IS NOT NULL
       AND motivo_encerramento = 'SUBSTITUICAO'
       AND justificativa IS NULL AND substituido_por IS NOT NULL)
    OR (estado = 'DESATIVADO'
       AND encerrado_em IS NOT NULL AND encerrado_por IS NOT NULL
       AND motivo_encerramento = 'DESATIVACAO'
       AND justificativa IS NOT NULL AND length(btrim(justificativa)) > 0
       AND substituido_por IS NULL)
  ),
  CONSTRAINT empresa_certificado_empresa_do_tenant
    FOREIGN KEY (empresa_id, tenant_id) REFERENCES app.empresa (id, tenant_id),
  CONSTRAINT empresa_certificado_responsavel_do_tenant
    FOREIGN KEY (responsavel_id, tenant_id) REFERENCES app.usuario (id, tenant_id),
  CONSTRAINT empresa_certificado_autor_do_tenant
    FOREIGN KEY (cadastrado_por, tenant_id) REFERENCES app.usuario (id, tenant_id),
  CONSTRAINT empresa_certificado_encerrador_do_tenant
    FOREIGN KEY (encerrado_por, tenant_id) REFERENCES app.usuario (id, tenant_id),
  -- A versao nova nasce na mesma transacao que encerra a anterior: o encerramento
  -- aponta para uma linha que so existe no fim, por isso a FK e adiada.
  CONSTRAINT empresa_certificado_sucessor_da_empresa
    FOREIGN KEY (substituido_por, empresa_id, tenant_id)
    REFERENCES app.empresa_certificado (id, empresa_id, tenant_id)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX empresa_certificado_tenant_id_idx ON app.empresa_certificado (tenant_id);
CREATE INDEX empresa_certificado_empresa_id_idx ON app.empresa_certificado (empresa_id);
CREATE INDEX empresa_certificado_responsavel_idx ON app.empresa_certificado (responsavel_id);
-- A lista do cofre ordena/filtra pelo fim da validade do vigente.
CREATE INDEX empresa_certificado_vigente_validade_idx
  ON app.empresa_certificado (tenant_id, valido_ate) WHERE estado = 'VIGENTE';

-- No maximo um vigente por empresa (SPEC-011 §3.3): indice parcial, nao CHECK —
-- CHECK so enxerga a propria linha, e a substituicao atomica depende deste indice
-- para que duas ativacoes simultaneas nunca produzam dois vigentes.
CREATE UNIQUE INDEX empresa_certificado_um_vigente_idx
  ON app.empresa_certificado (empresa_id) WHERE estado = 'VIGENTE';

-- Metadados do certificado sao imutaveis. So duas coisas mudam, e so no VIGENTE:
-- o responsavel (a troca nao toca no certificado) e o encerramento (VIGENTE ->
-- SUBSTITUIDO | DESATIVADO). Versao encerrada nao muda mais. Atualizacao sem efeito
-- (`set c = c`) passa. Erro `restrict_violation` (23001), como o escopo imutavel.
CREATE OR REPLACE FUNCTION app.proteger_certificado() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW IS NOT DISTINCT FROM OLD THEN
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.empresa_id IS DISTINCT FROM OLD.empresa_id
     OR NEW.versao IS DISTINCT FROM OLD.versao
     OR NEW.titular IS DISTINCT FROM OLD.titular
     OR NEW.cnpj_titular IS DISTINCT FROM OLD.cnpj_titular
     OR NEW.autoridade_certificadora IS DISTINCT FROM OLD.autoridade_certificadora
     OR NEW.cadeia IS DISTINCT FROM OLD.cadeia
     OR NEW.numero_serie IS DISTINCT FROM OLD.numero_serie
     OR NEW.impressao_digital IS DISTINCT FROM OLD.impressao_digital
     OR NEW.valido_de IS DISTINCT FROM OLD.valido_de
     OR NEW.valido_ate IS DISTINCT FROM OLD.valido_ate
     OR NEW.referencia_segredo IS DISTINCT FROM OLD.referencia_segredo
     OR NEW.cadastrado_em IS DISTINCT FROM OLD.cadastrado_em
     OR NEW.cadastrado_por IS DISTINCT FROM OLD.cadastrado_por THEN
    RAISE EXCEPTION 'metadados do certificado sao imutaveis' USING ERRCODE = 'restrict_violation';
  END IF;

  IF OLD.estado <> 'VIGENTE' THEN
    RAISE EXCEPTION 'versao de certificado encerrada nao se altera' USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER empresa_certificado_protegido
  BEFORE UPDATE ON app.empresa_certificado
  FOR EACH ROW EXECUTE FUNCTION app.proteger_certificado();

-- 2. Evento (historico append-only) -------------------------------------------

CREATE TABLE app.empresa_certificado_evento (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES app.tenant(id),
  empresa_id uuid NOT NULL,
  -- Nulo na recusa (nenhuma versao nasceu).
  certificado_id uuid,

  acao text NOT NULL CHECK (acao IN (
    'CADASTRO', 'SUBSTITUICAO', 'DESATIVACAO', 'RESPONSAVEL_ALTERADO',
    'RESPONSAVEL_PERDIDO', 'ALERTA_EMITIDO', 'RECUSA'
  )),
  resultado text NOT NULL CHECK (resultado IN ('SUCESSO', 'RECUSADO')),
  -- Codigo estavel da recusa ou marco do alerta. Nunca detalhe criptografico.
  codigo text,
  motivo text,

  usuario_id uuid,
  -- `cofre`, `alertas-de-vencimento`...: quem agiu quando nao foi (so) uma pessoa.
  identidade_tecnica text,
  correlation_id text NOT NULL,

  ocorrido_em timestamptz NOT NULL DEFAULT now(),
  -- `ocorrido_em` empata dentro da transacao; a sequencia desempata a ordem.
  sequencia bigint NOT NULL GENERATED ALWAYS AS IDENTITY,

  CONSTRAINT empresa_certificado_evento_autoria CHECK (
    usuario_id IS NOT NULL OR identidade_tecnica IS NOT NULL
  ),
  CONSTRAINT empresa_certificado_evento_resultado_condizente CHECK (
    (acao = 'RECUSA') = (resultado = 'RECUSADO')
  ),
  CONSTRAINT empresa_certificado_evento_empresa_do_tenant
    FOREIGN KEY (empresa_id, tenant_id) REFERENCES app.empresa (id, tenant_id),
  CONSTRAINT empresa_certificado_evento_autor_do_tenant
    FOREIGN KEY (usuario_id, tenant_id) REFERENCES app.usuario (id, tenant_id),
  CONSTRAINT empresa_certificado_evento_certificado_da_empresa
    FOREIGN KEY (certificado_id, empresa_id, tenant_id)
    REFERENCES app.empresa_certificado (id, empresa_id, tenant_id)
);

CREATE INDEX empresa_certificado_evento_tenant_id_idx ON app.empresa_certificado_evento (tenant_id);
CREATE INDEX empresa_certificado_evento_empresa_id_idx ON app.empresa_certificado_evento (empresa_id);
-- Aba Certificados do Historico de Informacoes: mais recentes primeiro.
CREATE INDEX empresa_certificado_evento_ordem_idx
  ON app.empresa_certificado_evento (tenant_id, ocorrido_em DESC, sequencia DESC);

CREATE TRIGGER empresa_certificado_evento_append_only
  BEFORE UPDATE OR DELETE ON app.empresa_certificado_evento
  FOR EACH ROW EXECUTE FUNCTION app.rejeitar_escrita_em_historico();

-- 3. Ticket de ingestao (uso unico) ----------------------------------------------

CREATE TABLE app.empresa_certificado_ingestao (
  -- O `id` e o `jti` do ticket assinado.
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES app.tenant(id),
  empresa_id uuid NOT NULL,
  usuario_id uuid NOT NULL,
  operacao text NOT NULL CHECK (operacao IN ('CADASTRO', 'SUBSTITUICAO')),
  responsavel_id uuid NOT NULL,
  correlation_id text NOT NULL,

  estado text NOT NULL DEFAULT 'EMITIDO' CHECK (estado IN ('EMITIDO', 'CONSUMIDO', 'RECUSADO', 'EXPIRADO')),
  emitido_em timestamptz NOT NULL DEFAULT now(),
  expira_em timestamptz NOT NULL,
  consumido_em timestamptz,

  CONSTRAINT empresa_certificado_ingestao_expiracao_condizente CHECK (expira_em > emitido_em),
  CONSTRAINT empresa_certificado_ingestao_consumo_condizente CHECK (
    (estado = 'EMITIDO' AND consumido_em IS NULL) OR (estado <> 'EMITIDO' AND consumido_em IS NOT NULL)
  ),
  CONSTRAINT empresa_certificado_ingestao_empresa_do_tenant
    FOREIGN KEY (empresa_id, tenant_id) REFERENCES app.empresa (id, tenant_id),
  CONSTRAINT empresa_certificado_ingestao_autor_do_tenant
    FOREIGN KEY (usuario_id, tenant_id) REFERENCES app.usuario (id, tenant_id),
  CONSTRAINT empresa_certificado_ingestao_responsavel_do_tenant
    FOREIGN KEY (responsavel_id, tenant_id) REFERENCES app.usuario (id, tenant_id)
);

CREATE INDEX empresa_certificado_ingestao_tenant_id_idx ON app.empresa_certificado_ingestao (tenant_id);
CREATE INDEX empresa_certificado_ingestao_empresa_id_idx ON app.empresa_certificado_ingestao (empresa_id);

-- O ticket so sai de EMITIDO, uma vez, e nada mais nele muda. O consumo atomico
-- (`update ... where estado = 'EMITIDO'`) e quem serializa tentativas simultaneas.
CREATE OR REPLACE FUNCTION app.proteger_ingestao_de_certificado() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW IS NOT DISTINCT FROM OLD THEN
    RETURN NEW;
  END IF;

  IF OLD.estado <> 'EMITIDO'
     OR NEW.id IS DISTINCT FROM OLD.id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.empresa_id IS DISTINCT FROM OLD.empresa_id
     OR NEW.usuario_id IS DISTINCT FROM OLD.usuario_id
     OR NEW.operacao IS DISTINCT FROM OLD.operacao
     OR NEW.responsavel_id IS DISTINCT FROM OLD.responsavel_id
     OR NEW.correlation_id IS DISTINCT FROM OLD.correlation_id
     OR NEW.emitido_em IS DISTINCT FROM OLD.emitido_em
     OR NEW.expira_em IS DISTINCT FROM OLD.expira_em THEN
    RAISE EXCEPTION 'ticket de ingestao so muda de EMITIDO para um estado final'
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER empresa_certificado_ingestao_protegida
  BEFORE UPDATE ON app.empresa_certificado_ingestao
  FOR EACH ROW EXECUTE FUNCTION app.proteger_ingestao_de_certificado();

-- 4. Alerta individual de vencimento / responsavel inconsistente -----------------

CREATE TABLE app.empresa_certificado_notificacao (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES app.tenant(id),
  empresa_id uuid NOT NULL,
  certificado_id uuid NOT NULL,
  usuario_id uuid NOT NULL,

  marco text NOT NULL CHECK (marco IN ('D30', 'D15', 'D7', 'VENCIDO', 'RESPONSAVEL_INCONSISTENTE')),
  lida boolean NOT NULL DEFAULT false,
  lida_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now(),
  sequencia bigint NOT NULL GENERATED ALWAYS AS IDENTITY,

  -- Uma vez por marco, por certificado e destinatario: reprocessar nao duplica (SPEC-011 §3.6).
  CONSTRAINT empresa_certificado_notificacao_marco_unico UNIQUE (certificado_id, usuario_id, marco),
  CONSTRAINT empresa_certificado_notificacao_lida_condizente CHECK (
    (lida = false AND lida_em IS NULL) OR (lida = true AND lida_em IS NOT NULL)
  ),
  CONSTRAINT empresa_certificado_notificacao_empresa_do_tenant
    FOREIGN KEY (empresa_id, tenant_id) REFERENCES app.empresa (id, tenant_id),
  CONSTRAINT empresa_certificado_notificacao_certificado_da_empresa
    FOREIGN KEY (certificado_id, empresa_id, tenant_id)
    REFERENCES app.empresa_certificado (id, empresa_id, tenant_id),
  CONSTRAINT empresa_certificado_notificacao_destinatario_do_tenant
    FOREIGN KEY (usuario_id, tenant_id) REFERENCES app.usuario (id, tenant_id)
);

CREATE INDEX empresa_certificado_notificacao_tenant_id_idx
  ON app.empresa_certificado_notificacao (tenant_id);
CREATE INDEX empresa_certificado_notificacao_empresa_id_idx
  ON app.empresa_certificado_notificacao (empresa_id);
-- Sino do usuario: painel e contador de nao lidas.
CREATE INDEX empresa_certificado_notificacao_painel_idx
  ON app.empresa_certificado_notificacao (usuario_id, criado_em DESC, sequencia DESC);
CREATE INDEX empresa_certificado_notificacao_nao_lidas_idx
  ON app.empresa_certificado_notificacao (usuario_id) WHERE lida = false;

-- 5. RLS (classe `empresa`, como as demais tabelas por empresa — ver 0012) ----------

ALTER TABLE app.empresa_certificado ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.empresa_certificado_evento ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.empresa_certificado_ingestao ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.empresa_certificado_notificacao ENABLE ROW LEVEL SECURITY;

ALTER TABLE app.empresa_certificado FORCE ROW LEVEL SECURITY;
ALTER TABLE app.empresa_certificado_evento FORCE ROW LEVEL SECURITY;
ALTER TABLE app.empresa_certificado_ingestao FORCE ROW LEVEL SECURITY;
ALTER TABLE app.empresa_certificado_notificacao FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  alvo record;
  comando text;
BEGIN
  FOR alvo IN
    SELECT * FROM (VALUES
      ('empresa_certificado',             ARRAY['SELECT', 'INSERT', 'UPDATE']),
      -- Append-only: sem politica de UPDATE/DELETE, a RLS forcada nega.
      ('empresa_certificado_evento',      ARRAY['SELECT', 'INSERT']),
      ('empresa_certificado_ingestao',    ARRAY['SELECT', 'INSERT', 'UPDATE']),
      ('empresa_certificado_notificacao', ARRAY['SELECT', 'INSERT', 'UPDATE'])
    ) AS t(tabela, comandos)
  LOOP
    FOREACH comando IN ARRAY alvo.comandos LOOP
      IF comando = 'SELECT' THEN
        EXECUTE format(
          'CREATE POLICY %I ON app.%I FOR SELECT USING (tenant_id = app.tenant_atual() AND app.empresa_autorizada(empresa_id))',
          alvo.tabela || '_select', alvo.tabela);
      ELSIF comando = 'INSERT' THEN
        EXECUTE format(
          'CREATE POLICY %I ON app.%I FOR INSERT WITH CHECK (tenant_id = app.tenant_atual() AND app.empresa_autorizada(empresa_id))',
          alvo.tabela || '_insert', alvo.tabela);
      ELSE
        EXECUTE format(
          'CREATE POLICY %I ON app.%I FOR UPDATE USING (tenant_id = app.tenant_atual() AND app.empresa_autorizada(empresa_id)) WITH CHECK (tenant_id = app.tenant_atual() AND app.empresa_autorizada(empresa_id))',
          alvo.tabela || '_update', alvo.tabela);
      END IF;
    END LOOP;
  END LOOP;
END
$$;

-- 6. Escopo imutavel (UPDATE nao move linha entre tenant nem empresa, SPEC-010 §3.4) ----

CREATE TRIGGER escopo_imutavel BEFORE UPDATE ON app.empresa_certificado
  FOR EACH ROW EXECUTE FUNCTION app.proteger_escopo_empresa();
CREATE TRIGGER escopo_imutavel BEFORE UPDATE ON app.empresa_certificado_evento
  FOR EACH ROW EXECUTE FUNCTION app.proteger_escopo_empresa();
CREATE TRIGGER escopo_imutavel BEFORE UPDATE ON app.empresa_certificado_ingestao
  FOR EACH ROW EXECUTE FUNCTION app.proteger_escopo_empresa();
CREATE TRIGGER escopo_imutavel BEFORE UPDATE ON app.empresa_certificado_notificacao
  FOR EACH ROW EXECUTE FUNCTION app.proteger_escopo_empresa();

-- 7. Pendencias: nova origem e novos tipos --------------------------------------------

ALTER TABLE app.empresa_pendencia DROP CONSTRAINT empresa_pendencia_origem_check;
ALTER TABLE app.empresa_pendencia ADD CONSTRAINT empresa_pendencia_origem_check
  CHECK (origem IN ('CADASTRAL', 'DOCUMENTAL', 'CERTIFICADO'));

ALTER TABLE app.empresa_pendencia DROP CONSTRAINT empresa_pendencia_tipo_check;
ALTER TABLE app.empresa_pendencia ADD CONSTRAINT empresa_pendencia_tipo_check
  CHECK (tipo IN (
    'CAMPO_AUSENTE', 'CAMPO_INVALIDO', 'DOCUMENTO_AUSENTE',
    'DOCUMENTO_REJEITADO', 'DOCUMENTO_VENCIDO', 'EXIGENCIA_ESPECIFICA',
    'CERTIFICADO_AUSENTE', 'CERTIFICADO_VENCIDO', 'CERTIFICADO_SEM_RESPONSAVEL'
  ));

-- Backfill (idempotente): toda empresa ATIVA existente nasce sem certificado, logo com a
-- pendencia de certificado ausente. Migration que so funciona em tabela vazia nao e migration.
WITH novas AS (
  INSERT INTO app.empresa_pendencia (tenant_id, empresa_id, origem, tipo, chave)
  SELECT e.tenant_id, e.id, 'CERTIFICADO', 'CERTIFICADO_AUSENTE', 'certificado:ausente'
    FROM app.empresa e
   WHERE e.status = 'ATIVA' AND e.situacao = 'ativo'
     AND NOT EXISTS (
       SELECT 1 FROM app.empresa_certificado c
        WHERE c.empresa_id = e.id AND c.estado = 'VIGENTE')
  ON CONFLICT (empresa_id, chave) WHERE estado = 'ABERTA' DO NOTHING
  RETURNING id, tenant_id, empresa_id
)
INSERT INTO app.empresa_evento_de_pendencia (tenant_id, empresa_id, pendencia_id, acao)
SELECT tenant_id, empresa_id, id, 'CRIACAO' FROM novas;

-- 8. Privilegios ------------------------------------------------------------------------

-- Versao: so mudam o responsavel e o encerramento (a trigger confere o resto).
REVOKE UPDATE ON app.empresa_certificado FROM contaia_app;
GRANT UPDATE (
  estado, responsavel_id, encerrado_em, encerrado_por, motivo_encerramento, justificativa,
  substituido_por
) ON app.empresa_certificado TO contaia_app;

-- Ticket: so o estado e o instante do consumo.
REVOKE UPDATE ON app.empresa_certificado_ingestao FROM contaia_app;
GRANT UPDATE (estado, consumido_em) ON app.empresa_certificado_ingestao TO contaia_app;

-- Alerta: so a leitura.
REVOKE UPDATE ON app.empresa_certificado_notificacao FROM contaia_app;
GRANT UPDATE (lida, lida_em) ON app.empresa_certificado_notificacao TO contaia_app;

REVOKE UPDATE ON app.empresa_certificado_evento FROM contaia_app;

-- O `pg_default_acl` do schema volta a conceder DELETE a cada tabela nova (ver 0004).
ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE DELETE ON TABLES FROM contaia_app;
REVOKE DELETE ON ALL TABLES IN SCHEMA app FROM contaia_app;
