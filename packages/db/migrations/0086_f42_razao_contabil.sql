-- SPEC-042/F42: projeção append-only por versão, consolidados e auditoria.
CREATE TABLE app.projecao_razao_versao (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(), tenant_id uuid NOT NULL REFERENCES app.tenant(id), empresa_id uuid NOT NULL,
  numero bigint NOT NULL CHECK(numero > 0), estado text NOT NULL CHECK(estado IN ('BUILDING','ACTIVE','SUPERSEDED','FAILED')),
  criado_por uuid NOT NULL, criado_em timestamptz NOT NULL DEFAULT now(), ativado_em timestamptz,
  correlation_id text NOT NULL,
  FOREIGN KEY(empresa_id,tenant_id) REFERENCES app.empresa(id,tenant_id),
  FOREIGN KEY(criado_por,tenant_id) REFERENCES app.usuario(id,tenant_id),
  UNIQUE(id,tenant_id,empresa_id), UNIQUE(tenant_id,empresa_id,numero)
);
CREATE TABLE app.projecao_razao (
  tenant_id uuid NOT NULL, empresa_id uuid NOT NULL, versao_ativa_id uuid NOT NULL,
  numero_versao bigint NOT NULL CHECK(numero_versao > 0), integridade text NOT NULL DEFAULT 'CONSISTENT' CHECK(integridade IN ('CONSISTENT','INCONSISTENT')),
  reconstrucao_em timestamptz, atualizado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,empresa_id),
  FOREIGN KEY(empresa_id,tenant_id) REFERENCES app.empresa(id,tenant_id),
  FOREIGN KEY(versao_ativa_id,tenant_id,empresa_id) REFERENCES app.projecao_razao_versao(id,tenant_id,empresa_id)
);
CREATE TABLE app.movimento_razao (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(), tenant_id uuid NOT NULL, empresa_id uuid NOT NULL, versao_id uuid NOT NULL,
  lancamento_id uuid NOT NULL, partida_id uuid NOT NULL, ajuste_de_id uuid, evento_origem_id uuid NOT NULL,
  competencia text NOT NULL CHECK(competencia ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'), data_contabil date NOT NULL,
  conta_id uuid NOT NULL, centro_custo_id uuid, codigo_conta text NOT NULL, nome_conta text NOT NULL,
  codigo_centro text, nome_centro text, historico text NOT NULL, referencia_externa text,
  numero_lancamento bigint NOT NULL, posicao integer NOT NULL CHECK(posicao >= 0),
  lado text NOT NULL CHECK(lado IN ('DEBIT','CREDIT')), valor_centavos bigint NOT NULL CHECK(valor_centavos BETWEEN 1 AND 9007199254740991),
  tipo text NOT NULL CHECK(tipo IN ('POSTING','CANCELLATION_ADJUSTMENT')), criado_em timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(empresa_id,tenant_id) REFERENCES app.empresa(id,tenant_id),
  FOREIGN KEY(versao_id,tenant_id,empresa_id) REFERENCES app.projecao_razao_versao(id,tenant_id,empresa_id),
  FOREIGN KEY(lancamento_id,tenant_id,empresa_id) REFERENCES app.lancamento_contabil(id,tenant_id,empresa_id),
  FOREIGN KEY(partida_id,tenant_id,empresa_id) REFERENCES app.lancamento_contabil_partida(id,tenant_id,empresa_id),
  FOREIGN KEY(conta_id,empresa_id,tenant_id) REFERENCES app.conta_contabil(id,empresa_id,tenant_id),
  FOREIGN KEY(centro_custo_id,empresa_id,tenant_id) REFERENCES app.centro_custo(id,empresa_id,tenant_id),
  FOREIGN KEY(ajuste_de_id,tenant_id,empresa_id) REFERENCES app.movimento_razao(id,tenant_id,empresa_id),
  UNIQUE(id,tenant_id,empresa_id), UNIQUE(id,tenant_id,empresa_id,versao_id)
);
CREATE UNIQUE INDEX movimento_razao_idempotencia_idx ON app.movimento_razao(tenant_id,empresa_id,versao_id,partida_id,tipo);
CREATE INDEX movimento_razao_consulta_idx ON app.movimento_razao(tenant_id,empresa_id,versao_id,competencia,data_contabil,numero_lancamento,posicao,id);
CREATE INDEX movimento_razao_conta_idx ON app.movimento_razao(tenant_id,empresa_id,versao_id,conta_id,competencia,centro_custo_id);
CREATE TABLE app.saldo_mensal_razao (
  tenant_id uuid NOT NULL, empresa_id uuid NOT NULL, versao_id uuid NOT NULL, competencia text NOT NULL,
  conta_id uuid NOT NULL, centro_custo_id uuid, debitos_centavos bigint NOT NULL DEFAULT 0 CHECK(debitos_centavos >= 0),
  creditos_centavos bigint NOT NULL DEFAULT 0 CHECK(creditos_centavos >= 0), movimentos bigint NOT NULL DEFAULT 0 CHECK(movimentos >= 0),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(empresa_id,tenant_id) REFERENCES app.empresa(id,tenant_id),
  FOREIGN KEY(versao_id,tenant_id,empresa_id) REFERENCES app.projecao_razao_versao(id,tenant_id,empresa_id),
  FOREIGN KEY(conta_id,empresa_id,tenant_id) REFERENCES app.conta_contabil(id,empresa_id,tenant_id),
  FOREIGN KEY(centro_custo_id,empresa_id,tenant_id) REFERENCES app.centro_custo(id,empresa_id,tenant_id)
);
CREATE UNIQUE INDEX saldo_mensal_razao_scope_idx ON app.saldo_mensal_razao(tenant_id,empresa_id,versao_id,competencia,conta_id,coalesce(centro_custo_id,'00000000-0000-0000-0000-000000000000'::uuid));
CREATE TABLE app.evento_razao (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(), tenant_id uuid NOT NULL, empresa_id uuid NOT NULL,
  versao_id uuid, acao text NOT NULL CHECK(acao IN ('MOVIMENTO_CRIADO','AJUSTE_CRIADO','VERIFICADO','RECONSTRUCAO_INICIADA','RECONSTRUCAO_ATIVADA','RECONSTRUCAO_FALHOU','TENTATIVA_NEGADA')),
  resultado text NOT NULL CHECK(resultado IN ('SUCESSO','RECUSADO','FALHA')), usuario_id uuid NOT NULL,
  correlation_id text NOT NULL, detalhes jsonb NOT NULL DEFAULT '{}'::jsonb,
  ocorrido_em timestamptz NOT NULL DEFAULT now(), sequencia bigint GENERATED ALWAYS AS IDENTITY,
  FOREIGN KEY(empresa_id,tenant_id) REFERENCES app.empresa(id,tenant_id),
  FOREIGN KEY(versao_id,tenant_id,empresa_id) REFERENCES app.projecao_razao_versao(id,tenant_id,empresa_id),
  FOREIGN KEY(usuario_id,tenant_id) REFERENCES app.usuario(id,tenant_id)
);
CREATE INDEX evento_razao_scope_idx ON app.evento_razao(tenant_id,empresa_id,ocorrido_em,sequencia);

CREATE OR REPLACE FUNCTION app.proteger_movimento_razao_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'LEDGER_MOVEMENT_APPEND_ONLY' USING ERRCODE='restrict_violation'; END; $$;
CREATE OR REPLACE FUNCTION app.proteger_evento_razao_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'LEDGER_EVENT_APPEND_ONLY' USING ERRCODE='restrict_violation'; END; $$;
CREATE OR REPLACE FUNCTION app.proteger_versao_razao() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR OLD.tenant_id IS DISTINCT FROM NEW.tenant_id OR OLD.empresa_id IS DISTINCT FROM NEW.empresa_id OR
    OLD.numero IS DISTINCT FROM NEW.numero OR OLD.criado_por IS DISTINCT FROM NEW.criado_por OR OLD.criado_em IS DISTINCT FROM NEW.criado_em OR
    OLD.correlation_id IS DISTINCT FROM NEW.correlation_id OR NOT ((OLD.estado='BUILDING' AND NEW.estado IN ('ACTIVE','FAILED')) OR (OLD.estado='ACTIVE' AND NEW.estado='SUPERSEDED')) THEN
    RAISE EXCEPTION 'LEDGER_VERSION_IMMUTABLE' USING ERRCODE='restrict_violation';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER movimento_razao_append_only BEFORE UPDATE OR DELETE ON app.movimento_razao FOR EACH ROW EXECUTE FUNCTION app.proteger_movimento_razao_append_only();
CREATE TRIGGER movimento_razao_no_truncate BEFORE TRUNCATE ON app.movimento_razao FOR EACH STATEMENT EXECUTE FUNCTION app.rejeitar_truncate_tax_resolution();
CREATE TRIGGER evento_razao_append_only BEFORE UPDATE OR DELETE ON app.evento_razao FOR EACH ROW EXECUTE FUNCTION app.proteger_evento_razao_append_only();
CREATE TRIGGER evento_razao_no_truncate BEFORE TRUNCATE ON app.evento_razao FOR EACH STATEMENT EXECUTE FUNCTION app.rejeitar_truncate_tax_resolution();
CREATE TRIGGER movimento_razao_escopo BEFORE UPDATE ON app.movimento_razao FOR EACH ROW EXECUTE FUNCTION app.proteger_escopo_empresa();
CREATE TRIGGER evento_razao_escopo BEFORE UPDATE ON app.evento_razao FOR EACH ROW EXECUTE FUNCTION app.proteger_escopo_empresa();
CREATE TRIGGER versao_razao_transicao BEFORE UPDATE OR DELETE ON app.projecao_razao_versao FOR EACH ROW EXECUTE FUNCTION app.proteger_versao_razao();
CREATE TRIGGER escopo_imutavel BEFORE UPDATE ON app.projecao_razao_versao FOR EACH ROW EXECUTE FUNCTION app.proteger_escopo_empresa();
CREATE TRIGGER escopo_imutavel BEFORE UPDATE ON app.projecao_razao FOR EACH ROW EXECUTE FUNCTION app.proteger_escopo_empresa();
CREATE TRIGGER escopo_imutavel BEFORE UPDATE ON app.movimento_razao FOR EACH ROW EXECUTE FUNCTION app.proteger_escopo_empresa();
CREATE TRIGGER escopo_imutavel BEFORE UPDATE ON app.saldo_mensal_razao FOR EACH ROW EXECUTE FUNCTION app.proteger_escopo_empresa();
CREATE TRIGGER escopo_imutavel BEFORE UPDATE ON app.evento_razao FOR EACH ROW EXECUTE FUNCTION app.proteger_escopo_empresa();

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['projecao_razao_versao','projecao_razao','movimento_razao','saldo_mensal_razao','evento_razao'] LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY %I ON app.%I FOR SELECT USING (tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id))',t||'_select',t);
    EXECUTE format('CREATE POLICY %I ON app.%I FOR INSERT WITH CHECK (tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id))',t||'_insert',t);
    IF t IN ('projecao_razao','projecao_razao_versao','saldo_mensal_razao') THEN
      EXECUTE format('CREATE POLICY %I ON app.%I FOR UPDATE USING (tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id)) WITH CHECK (tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id))',t||'_update',t);
    END IF;
  END LOOP;
END $$;
REVOKE ALL ON app.projecao_razao_versao,app.projecao_razao,app.movimento_razao,app.saldo_mensal_razao,app.evento_razao FROM PUBLIC,contaia_app;
GRANT SELECT,INSERT,UPDATE ON app.projecao_razao_versao,app.projecao_razao,app.saldo_mensal_razao TO contaia_app;
GRANT SELECT,INSERT ON app.movimento_razao,app.evento_razao TO contaia_app;
GRANT USAGE,SELECT ON SEQUENCE app.evento_razao_sequencia_seq TO contaia_app;
