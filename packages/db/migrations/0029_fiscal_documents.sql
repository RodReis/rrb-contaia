-- SPEC-018/F18: documentos fiscais normalizados, origens e trilha append-only.
ALTER TABLE app.dfe_capture_staging ADD CONSTRAINT dfe_capture_staging_scope_unique UNIQUE(id,empresa_id,tenant_id);

-- Publicação F17 → F18 é registrada na mesma transação que grava o staging.
-- O scheduler só descobre escopos; o payload permanece sob RLS por empresa.
CREATE TABLE app.fiscal_document_outbox (
  staging_id uuid PRIMARY KEY, tenant_id uuid NOT NULL, empresa_id uuid NOT NULL,
  estado text NOT NULL DEFAULT 'PENDENTE' CHECK (estado IN ('PENDENTE','PUBLICADO','IGNORADO')),
  tentativas integer NOT NULL DEFAULT 0 CHECK (tentativas >= 0),
  criado_em timestamptz NOT NULL DEFAULT now(), publicado_em timestamptz,
  CONSTRAINT fiscal_document_outbox_staging FOREIGN KEY(staging_id,empresa_id,tenant_id)
    REFERENCES app.dfe_capture_staging(id,empresa_id,tenant_id),
  CONSTRAINT fiscal_document_outbox_empresa FOREIGN KEY(empresa_id,tenant_id)
    REFERENCES app.empresa(id,tenant_id)
);
CREATE INDEX fiscal_document_outbox_pending_idx ON app.fiscal_document_outbox(criado_em,staging_id) WHERE estado='PENDENTE';
ALTER TABLE app.fiscal_document_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.fiscal_document_outbox FORCE ROW LEVEL SECURITY;
CREATE POLICY fiscal_document_outbox_select ON app.fiscal_document_outbox FOR SELECT
  USING (tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id));
CREATE POLICY fiscal_document_outbox_insert ON app.fiscal_document_outbox FOR INSERT
  WITH CHECK (tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id));
CREATE POLICY fiscal_document_outbox_update ON app.fiscal_document_outbox FOR UPDATE
  USING (tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id))
  WITH CHECK (tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id));
GRANT SELECT,INSERT ON app.fiscal_document_outbox TO contaia_app;
REVOKE UPDATE,DELETE ON app.fiscal_document_outbox FROM contaia_app;
GRANT UPDATE(estado,tentativas,publicado_em) ON app.fiscal_document_outbox TO contaia_app;
INSERT INTO app.fiscal_document_outbox(staging_id,tenant_id,empresa_id)
  SELECT id,tenant_id,empresa_id FROM app.dfe_capture_staging ON CONFLICT DO NOTHING;

GRANT SELECT ON app.fiscal_document_outbox,app.dfe_capture_staging TO contaia_dfe_scheduler_owner;
CREATE FUNCTION app.fiscal_document_empresas_pendentes(p_limite integer DEFAULT 100)
RETURNS TABLE(tenant_id uuid,empresa_id uuid,cnpj text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,app,pg_temp AS $$
  SELECT DISTINCT o.tenant_id,o.empresa_id,s.cnpj
    FROM app.fiscal_document_outbox o JOIN app.dfe_capture_staging s ON s.id=o.staging_id
   WHERE o.estado='PENDENTE'
   ORDER BY o.tenant_id,o.empresa_id,s.cnpj
   LIMIT least(greatest(p_limite,1),100)
$$;
ALTER FUNCTION app.fiscal_document_empresas_pendentes(integer) OWNER TO contaia_dfe_scheduler_owner;
REVOKE ALL ON FUNCTION app.fiscal_document_empresas_pendentes(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.fiscal_document_empresas_pendentes(integer) TO contaia_dfe_scheduler;

CREATE TABLE app.fiscal_document (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES app.tenant(id), empresa_id uuid NOT NULL,
  primary_staging_id uuid NOT NULL,
  especie text NOT NULL CHECK (especie IN ('NFE_55','CTE')),
  chave_acesso text CHECK (chave_acesso IS NULL OR chave_acesso ~ '^\d{44}$'),
  hash_sha256 text NOT NULL CHECK (hash_sha256 ~ '^[0-9a-f]{64}$'),
  original_key text NOT NULL, tamanho_bytes bigint NOT NULL CHECK (tamanho_bytes > 0),
  media_type text NOT NULL DEFAULT 'application/xml', modelo text NOT NULL,
  versao_layout text NOT NULL, emitido_em date, emitente text, destinatario text,
  total numeric(30,10), estado text NOT NULL CHECK (estado IN ('PROCESSADO','PENDENTE_LAYOUT','PENDENTE_IBS_CBS','XML_INVALIDO','CONFLITO','FALHA')),
  parser_version text NOT NULL, criado_em timestamptz NOT NULL DEFAULT now(), atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fiscal_document_empresa_tenant FOREIGN KEY (empresa_id,tenant_id) REFERENCES app.empresa(id,tenant_id),
  CONSTRAINT fiscal_document_primary_staging FOREIGN KEY(primary_staging_id,empresa_id,tenant_id) REFERENCES app.dfe_capture_staging(id,empresa_id,tenant_id),
  CONSTRAINT fiscal_document_key_hash UNIQUE (tenant_id,empresa_id,especie,chave_acesso,hash_sha256),
  CONSTRAINT fiscal_document_primary_staging_unique UNIQUE(primary_staging_id),
  CONSTRAINT fiscal_document_scope_unique UNIQUE(id,empresa_id,tenant_id)
);
CREATE UNIQUE INDEX fiscal_document_identity_idx ON app.fiscal_document(tenant_id,empresa_id,especie,chave_acesso) WHERE chave_acesso IS NOT NULL AND estado <> 'CONFLITO';
CREATE INDEX fiscal_document_company_date_idx ON app.fiscal_document(empresa_id,emitido_em DESC,criado_em DESC,id);

CREATE TABLE app.fiscal_document_origin (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(), tenant_id uuid NOT NULL REFERENCES app.tenant(id), empresa_id uuid NOT NULL,
  document_id uuid NOT NULL, staging_id uuid NOT NULL, cnpj text NOT NULL CHECK (cnpj ~ '^\d{14}$'),
  nsu text NOT NULL CHECK (nsu ~ '^\d{1,15}$'), correlation_id text NOT NULL, capturado_em timestamptz NOT NULL,
  CONSTRAINT fiscal_document_origin_document FOREIGN KEY(document_id,empresa_id,tenant_id) REFERENCES app.fiscal_document(id,empresa_id,tenant_id),
  CONSTRAINT fiscal_document_origin_staging FOREIGN KEY(staging_id,empresa_id,tenant_id) REFERENCES app.dfe_capture_staging(id,empresa_id,tenant_id),
  CONSTRAINT fiscal_document_origin_company FOREIGN KEY(empresa_id,tenant_id) REFERENCES app.empresa(id,tenant_id),
  CONSTRAINT fiscal_document_origin_unique UNIQUE(staging_id)
);
CREATE INDEX fiscal_document_origin_doc_idx ON app.fiscal_document_origin(document_id);

CREATE TABLE app.fiscal_document_item (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(), tenant_id uuid NOT NULL REFERENCES app.tenant(id), empresa_id uuid NOT NULL,
  document_id uuid NOT NULL, numero integer NOT NULL CHECK(numero > 0), codigo text, descricao text,
  quantidade numeric(30,10), unidade text, valor numeric(30,10), ibs numeric(30,10), cbs numeric(30,10),
  CONSTRAINT fiscal_document_item_document FOREIGN KEY(document_id,empresa_id,tenant_id) REFERENCES app.fiscal_document(id,empresa_id,tenant_id),
  CONSTRAINT fiscal_document_item_company FOREIGN KEY(empresa_id,tenant_id) REFERENCES app.empresa(id,tenant_id),
  CONSTRAINT fiscal_document_item_unique UNIQUE(document_id,numero)
);
CREATE INDEX fiscal_document_item_document_idx ON app.fiscal_document_item(document_id);

CREATE TABLE app.fiscal_document_event (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(), tenant_id uuid NOT NULL REFERENCES app.tenant(id), empresa_id uuid NOT NULL,
  document_id uuid, staging_id uuid NOT NULL, tipo text NOT NULL, codigo text, detalhe_sanitizado text,
  parser_version text NOT NULL, hash_sha256 text, ator_id uuid, correlation_id text NOT NULL,
  ocorrido_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fiscal_document_event_document FOREIGN KEY(document_id,empresa_id,tenant_id) REFERENCES app.fiscal_document(id,empresa_id,tenant_id),
  CONSTRAINT fiscal_document_event_staging FOREIGN KEY(staging_id,empresa_id,tenant_id) REFERENCES app.dfe_capture_staging(id,empresa_id,tenant_id),
  CONSTRAINT fiscal_document_event_company FOREIGN KEY(empresa_id,tenant_id) REFERENCES app.empresa(id,tenant_id)
);
CREATE INDEX fiscal_document_event_history_idx ON app.fiscal_document_event(empresa_id,ocorrido_em DESC,id);
CREATE TRIGGER fiscal_document_event_append_only BEFORE UPDATE OR DELETE ON app.fiscal_document_event FOR EACH ROW EXECUTE FUNCTION app.rejeitar_escrita_em_historico();
CREATE TRIGGER fiscal_document_origin_append_only BEFORE UPDATE OR DELETE ON app.fiscal_document_origin FOR EACH ROW EXECUTE FUNCTION app.rejeitar_escrita_em_historico();
CREATE TRIGGER fiscal_document_item_append_only BEFORE UPDATE OR DELETE ON app.fiscal_document_item FOR EACH ROW EXECUTE FUNCTION app.rejeitar_escrita_em_historico();

DO $$ DECLARE alvo text; BEGIN
  FOREACH alvo IN ARRAY ARRAY['fiscal_document','fiscal_document_origin','fiscal_document_item','fiscal_document_event'] LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',alvo);
    EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',alvo);
    EXECUTE format('CREATE POLICY %I ON app.%I FOR SELECT USING (tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id))',alvo||'_select',alvo);
    EXECUTE format('CREATE POLICY %I ON app.%I FOR INSERT WITH CHECK (tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id))',alvo||'_insert',alvo);
    IF alvo = 'fiscal_document' THEN
      EXECUTE format('CREATE POLICY %I ON app.%I FOR UPDATE USING (tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id)) WITH CHECK (tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id))',alvo||'_update',alvo);
    END IF;
  END LOOP;
END $$;
GRANT SELECT,INSERT ON app.fiscal_document,app.fiscal_document_origin,app.fiscal_document_item,app.fiscal_document_event TO contaia_app;
REVOKE UPDATE,DELETE ON app.fiscal_document,app.fiscal_document_origin,app.fiscal_document_item,app.fiscal_document_event FROM contaia_app;
GRANT UPDATE(estado,modelo,versao_layout,emitido_em,emitente,destinatario,total,atualizado_em) ON app.fiscal_document TO contaia_app;
