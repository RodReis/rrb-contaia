-- SPEC-021/F21: decisão humana, payload selado, outbox e histórico de transmissão conclusiva.
CREATE TABLE app.fiscal_manifestation (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(), tenant_id uuid NOT NULL REFERENCES app.tenant(id), empresa_id uuid NOT NULL,
  document_id uuid NOT NULL, analysis_id uuid NOT NULL, chave_acesso text NOT NULL CHECK(chave_acesso ~ '^\d{44}$'),
  tipo text NOT NULL CHECK(tipo IN ('210200','210220','210240')), sequencia smallint NOT NULL DEFAULT 1 CHECK(sequencia BETWEEN 1 AND 99),
  estado text NOT NULL CHECK(estado IN ('APROVADA','ENFILEIRADA','ASSINADA','TRANSMITIDA','ACEITA','REJEITADA_PELO_HUMANO','REJEITADA_SEFAZ','RESULTADO_INCERTO','FALHA_RETRY','DLQ','JA_MANIFESTADA','INELEGIVEL')),
  justificativa text, motivo_troca text, decisao_original text NOT NULL, aprovador_id uuid NOT NULL,
  payload jsonb NOT NULL, payload_sha256 text NOT NULL CHECK(payload_sha256 ~ '^[0-9a-f]{64}$'), chave_idempotente text NOT NULL,
  correlation_id text NOT NULL, ambiente text NOT NULL DEFAULT 'HOMOLOGACAO' CHECK(ambiente='HOMOLOGACAO'),
  criado_em timestamptz NOT NULL DEFAULT now(), atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fiscal_manifestation_document FOREIGN KEY(document_id,empresa_id,tenant_id) REFERENCES app.fiscal_document(id,empresa_id,tenant_id),
  CONSTRAINT fiscal_manifestation_scope FOREIGN KEY(empresa_id,tenant_id) REFERENCES app.empresa(id,tenant_id),
  CONSTRAINT fiscal_manifestation_analysis FOREIGN KEY(analysis_id,empresa_id,tenant_id) REFERENCES app.fiscal_risk_analysis(id,empresa_id,tenant_id),
  CONSTRAINT fiscal_manifestation_scope UNIQUE(id,empresa_id,tenant_id),
  CONSTRAINT fiscal_manifestation_justification CHECK(estado='REJEITADA_PELO_HUMANO' OR (tipo='210240' AND length(btrim(justificativa)) BETWEEN 15 AND 255) OR (tipo<>'210240' AND justificativa IS NULL))
);
CREATE UNIQUE INDEX fiscal_manifestation_identity_idx ON app.fiscal_manifestation(tenant_id,empresa_id,chave_acesso,tipo,sequencia) WHERE estado NOT IN ('REJEITADA_PELO_HUMANO','REJEITADA_SEFAZ');
CREATE TABLE app.fiscal_manifestation_outbox (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(), tenant_id uuid NOT NULL, empresa_id uuid NOT NULL, manifestation_id uuid NOT NULL UNIQUE,
  estado text NOT NULL DEFAULT 'PENDENTE' CHECK(estado IN ('PENDENTE','PUBLICADO','PROCESSANDO','CONCLUIDO','DLQ')),
  tentativas integer NOT NULL DEFAULT 0 CHECK(tentativas>=0), criado_em timestamptz NOT NULL DEFAULT now(), publicado_em timestamptz, claim_ate timestamptz,
  FOREIGN KEY(manifestation_id,empresa_id,tenant_id) REFERENCES app.fiscal_manifestation(id,empresa_id,tenant_id),
  FOREIGN KEY(empresa_id,tenant_id) REFERENCES app.empresa(id,tenant_id)
);
CREATE TABLE app.fiscal_manifestation_event (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(), tenant_id uuid NOT NULL, empresa_id uuid NOT NULL, manifestation_id uuid NOT NULL,
  estado text NOT NULL, codigo text, detalhe_sanitizado text, protocolo text, correlation_id text NOT NULL, ocorrido_em timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(manifestation_id,empresa_id,tenant_id) REFERENCES app.fiscal_manifestation(id,empresa_id,tenant_id),
  FOREIGN KEY(empresa_id,tenant_id) REFERENCES app.empresa(id,tenant_id)
);
CREATE INDEX fiscal_manifestation_inbox_idx ON app.fiscal_manifestation(tenant_id,empresa_id,estado,criado_em DESC);
CREATE INDEX fiscal_manifestation_outbox_pending_idx ON app.fiscal_manifestation_outbox(criado_em) WHERE estado='PENDENTE';
CREATE INDEX fiscal_manifestation_outbox_expired_claim_idx ON app.fiscal_manifestation_outbox(claim_ate) WHERE estado='PROCESSANDO';
CREATE OR REPLACE FUNCTION app.proteger_fiscal_manifestation_payload() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (to_jsonb(NEW)-'estado'-'atualizado_em') IS DISTINCT FROM (to_jsonb(OLD)-'estado'-'atualizado_em') THEN
  RAISE EXCEPTION 'payload da manifestacao e decisao sao imutaveis' USING ERRCODE='restrict_violation';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER fiscal_manifestation_payload_imutavel BEFORE UPDATE ON app.fiscal_manifestation FOR EACH ROW EXECUTE FUNCTION app.proteger_fiscal_manifestation_payload();
CREATE TRIGGER fiscal_manifestation_append_only BEFORE DELETE ON app.fiscal_manifestation FOR EACH ROW EXECUTE FUNCTION app.rejeitar_escrita_em_historico();
CREATE TRIGGER fiscal_manifestation_event_append_only BEFORE UPDATE OR DELETE ON app.fiscal_manifestation_event FOR EACH ROW EXECUTE FUNCTION app.rejeitar_escrita_em_historico();
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['fiscal_manifestation','fiscal_manifestation_outbox','fiscal_manifestation_event'] LOOP
  EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t); EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY %I ON app.%I FOR SELECT USING(tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id))',t||'_select',t);
  EXECUTE format('CREATE POLICY %I ON app.%I FOR INSERT WITH CHECK(tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id))',t||'_insert',t);
  EXECUTE format('CREATE TRIGGER escopo_imutavel BEFORE UPDATE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.proteger_escopo_empresa()',t);
 END LOOP;
END $$;
CREATE POLICY fiscal_manifestation_update ON app.fiscal_manifestation FOR UPDATE USING(tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id)) WITH CHECK(tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id));
CREATE POLICY fiscal_manifestation_outbox_update ON app.fiscal_manifestation_outbox FOR UPDATE USING(tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id)) WITH CHECK(tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id));
GRANT SELECT,INSERT ON app.fiscal_manifestation,app.fiscal_manifestation_outbox,app.fiscal_manifestation_event TO contaia_app;
GRANT UPDATE(estado,atualizado_em) ON app.fiscal_manifestation TO contaia_app;
GRANT UPDATE(estado,tentativas,publicado_em,claim_ate) ON app.fiscal_manifestation_outbox TO contaia_app;
REVOKE UPDATE,DELETE ON app.fiscal_manifestation_event FROM contaia_app;
