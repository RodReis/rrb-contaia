-- SPEC-030/F30: preserva eventos verificados mesmo quando o documento ainda não chegou.
ALTER TABLE app.fiscal_document DROP CONSTRAINT IF EXISTS fiscal_document_estado_check;
ALTER TABLE app.fiscal_document ADD CONSTRAINT fiscal_document_estado_check
  CHECK (estado IN ('PROCESSADO','PENDENTE_LAYOUT','PENDENTE_IBS_CBS','XML_INVALIDO','CONFLITO','FALHA','CANCELLED'));

CREATE TABLE app.nfce_import_event (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(), tenant_id uuid NOT NULL REFERENCES app.tenant(id), empresa_id uuid NOT NULL,
  item_id uuid NOT NULL, source_id uuid NOT NULL, chave_acesso text NOT NULL CHECK(chave_acesso ~ '^\d{44}$'),
  cnpj text NOT NULL CHECK(cnpj ~ '^\d{14}$'), ambiente text NOT NULL CHECK(ambiente IN ('PRODUCAO','HOMOLOGACAO')),
  tipo text NOT NULL CHECK(tipo='110111'), sequencia text NOT NULL CHECK(sequencia ~ '^\d{1,2}$'), protocolo text NOT NULL,
  hash_sha256 text NOT NULL CHECK(hash_sha256 ~ '^[0-9a-f]{64}$'), original_key text NOT NULL,
  tamanho_bytes bigint NOT NULL CHECK(tamanho_bytes>0), correlation_id text NOT NULL, criado_em timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(item_id,empresa_id,tenant_id) REFERENCES app.nfce_import_item(id,empresa_id,tenant_id),
  FOREIGN KEY(source_id,empresa_id,tenant_id) REFERENCES app.nfce_import_source(id,empresa_id,tenant_id),
  FOREIGN KEY(empresa_id,tenant_id) REFERENCES app.empresa(id,tenant_id), UNIQUE(id,empresa_id,tenant_id),
  UNIQUE(tenant_id,empresa_id,chave_acesso,tipo,sequencia,protocolo)
);
CREATE INDEX nfce_import_event_pending_idx ON app.nfce_import_event(tenant_id,empresa_id,chave_acesso,ambiente,criado_em);
ALTER TABLE app.nfce_import_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.nfce_import_event FORCE ROW LEVEL SECURITY;
CREATE POLICY nfce_import_event_select ON app.nfce_import_event FOR SELECT USING(tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id));
CREATE POLICY nfce_import_event_insert ON app.nfce_import_event FOR INSERT WITH CHECK(tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id));
CREATE TRIGGER nfce_import_event_append_only BEFORE UPDATE OR DELETE ON app.nfce_import_event FOR EACH ROW EXECUTE FUNCTION app.rejeitar_escrita_em_historico();
GRANT SELECT,INSERT ON app.nfce_import_event TO contaia_app;
REVOKE UPDATE,DELETE ON app.nfce_import_event FROM contaia_app;
