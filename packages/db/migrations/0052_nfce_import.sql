-- SPEC-030/F30: ingestao manual de NFC-e sem acoplar ao staging de captura DF-e.
ALTER TABLE app.fiscal_document DROP CONSTRAINT fiscal_document_especie_check;
ALTER TABLE app.fiscal_document ADD CONSTRAINT fiscal_document_especie_check CHECK(especie IN ('NFE_55','CTE','NFCE_65'));
ALTER TABLE app.fiscal_document DROP CONSTRAINT fiscal_document_primary_staging;
ALTER TABLE app.fiscal_document ALTER COLUMN primary_staging_id DROP NOT NULL;
ALTER TABLE app.fiscal_document ADD CONSTRAINT fiscal_document_has_source CHECK(primary_staging_id IS NOT NULL OR especie='NFCE_65');
ALTER TABLE app.fiscal_document ADD COLUMN IF NOT EXISTS cancelado_em timestamptz;
ALTER TABLE app.fiscal_document ADD COLUMN IF NOT EXISTS protocolo_cancelamento text;
ALTER TABLE app.fiscal_document_item ADD COLUMN IF NOT EXISTS quantidade text;
ALTER TABLE app.fiscal_document_item ADD COLUMN IF NOT EXISTS unidade text;
ALTER TABLE app.fiscal_document_item ADD COLUMN IF NOT EXISTS valor numeric(30,10);
ALTER TABLE app.fiscal_document_item ADD COLUMN IF NOT EXISTS freight numeric(30,10);
ALTER TABLE app.fiscal_document_item ADD COLUMN IF NOT EXISTS insurance numeric(30,10);
ALTER TABLE app.fiscal_document_item ADD COLUMN IF NOT EXISTS discount numeric(30,10);
ALTER TABLE app.fiscal_document_item ADD COLUMN IF NOT EXISTS other_expenses numeric(30,10);
ALTER TABLE app.fiscal_document_item ADD COLUMN IF NOT EXISTS ibs numeric(30,10);
ALTER TABLE app.fiscal_document_item ADD COLUMN IF NOT EXISTS cbs numeric(30,10);
ALTER TABLE app.fiscal_document ADD COLUMN IF NOT EXISTS consumidor_final boolean;
ALTER TABLE app.fiscal_document_item ADD COLUMN IF NOT EXISTS gtin text;
ALTER TABLE app.fiscal_document_item ADD COLUMN IF NOT EXISTS ncm text;
ALTER TABLE app.fiscal_document_item ADD COLUMN IF NOT EXISTS cest text;
ALTER TABLE app.fiscal_document_item ADD COLUMN IF NOT EXISTS cfop text;
ALTER TABLE app.fiscal_document_item ADD COLUMN IF NOT EXISTS cst_csosn text;
ALTER TABLE app.fiscal_document_item ADD COLUMN IF NOT EXISTS codigo_beneficio text;
CREATE TABLE app.fiscal_document_payment (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(), tenant_id uuid NOT NULL REFERENCES app.tenant(id), empresa_id uuid NOT NULL,
  document_id uuid NOT NULL, parser_version text NOT NULL, numero integer NOT NULL CHECK(numero>0), indicador text,
  meio text, valor numeric(30,10), integracao text, bandeira text, autorizacao text,
  FOREIGN KEY(document_id,empresa_id,tenant_id) REFERENCES app.fiscal_document(id,empresa_id,tenant_id),
  FOREIGN KEY(empresa_id,tenant_id) REFERENCES app.empresa(id,tenant_id), UNIQUE(document_id,parser_version,numero)
);
CREATE INDEX fiscal_document_payment_scope_idx ON app.fiscal_document_payment(tenant_id,empresa_id,document_id);
ALTER TABLE app.fiscal_document_payment ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.fiscal_document_payment FORCE ROW LEVEL SECURITY;
CREATE POLICY fiscal_document_payment_select ON app.fiscal_document_payment FOR SELECT USING(tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id));
CREATE POLICY fiscal_document_payment_insert ON app.fiscal_document_payment FOR INSERT WITH CHECK(tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id));
CREATE TRIGGER fiscal_document_payment_append_only BEFORE UPDATE OR DELETE ON app.fiscal_document_payment FOR EACH ROW EXECUTE FUNCTION app.rejeitar_escrita_em_historico();
CREATE TRIGGER escopo_imutavel BEFORE UPDATE ON app.fiscal_document_payment FOR EACH ROW EXECUTE FUNCTION app.proteger_escopo_empresa();
GRANT SELECT,INSERT ON app.fiscal_document_payment TO contaia_app;
REVOKE UPDATE,DELETE ON app.fiscal_document_payment FROM contaia_app;
CREATE TABLE app.nfce_import_batch (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(), tenant_id uuid NOT NULL REFERENCES app.tenant(id), empresa_id uuid NOT NULL,
  actor_id uuid NOT NULL, correlation_id text NOT NULL, origem text NOT NULL CHECK(origem IN ('PORTAL_GO','ERP','EMISSOR')),
  status text NOT NULL DEFAULT 'QUEUED' CHECK(status IN ('QUEUED','PROCESSING','COMPLETED','COMPLETED_WITH_REJECTIONS','REJECTED','FAILED')),
  total integer NOT NULL CHECK(total BETWEEN 1 AND 10000), criado_em timestamptz NOT NULL DEFAULT now(), atualizado_em timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(empresa_id,tenant_id) REFERENCES app.empresa(id,tenant_id), UNIQUE(id,empresa_id,tenant_id)
);
CREATE TABLE app.nfce_import_item (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(), tenant_id uuid NOT NULL REFERENCES app.tenant(id), empresa_id uuid NOT NULL, batch_id uuid NOT NULL,
  nome_sanitizado text NOT NULL, tamanho_bytes bigint NOT NULL CHECK(tamanho_bytes>0), hash_sha256 text NOT NULL CHECK(hash_sha256 ~ '^[0-9a-f]{64}$'),
  original_key text NOT NULL, status text NOT NULL DEFAULT 'QUEUED' CHECK(status IN ('QUEUED','PROCESSING','IMPORTED','REUSED','PENDING_LINK','REJECTED','CONFLICT','FAILED')),
  codigo text, detalhe_sanitizado text, document_id uuid, modelo text, versao_layout text, ambiente text, chave_acesso text,
  parser_version text NOT NULL, schema_version text NOT NULL, correlation_id text NOT NULL, criado_em timestamptz NOT NULL DEFAULT now(), processado_em timestamptz,
  FOREIGN KEY(batch_id,empresa_id,tenant_id) REFERENCES app.nfce_import_batch(id,empresa_id,tenant_id),
  FOREIGN KEY(document_id,empresa_id,tenant_id) REFERENCES app.fiscal_document(id,empresa_id,tenant_id),
  FOREIGN KEY(empresa_id,tenant_id) REFERENCES app.empresa(id,tenant_id), UNIQUE(id,empresa_id,tenant_id)
);
CREATE INDEX nfce_import_batch_scope_idx ON app.nfce_import_batch(tenant_id,empresa_id,criado_em DESC);
CREATE INDEX nfce_import_item_scope_idx ON app.nfce_import_item(tenant_id,empresa_id,batch_id,status);
CREATE INDEX nfce_import_item_document_idx ON app.nfce_import_item(tenant_id,empresa_id,document_id) WHERE document_id IS NOT NULL;
CREATE TABLE app.nfce_import_source (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(), tenant_id uuid NOT NULL REFERENCES app.tenant(id), empresa_id uuid NOT NULL,
  item_id uuid NOT NULL UNIQUE, cnpj text NOT NULL CHECK(cnpj ~ '^\d{14}$'), origem text NOT NULL CHECK(origem IN ('PORTAL_GO','ERP','EMISSOR')), correlation_id text NOT NULL, criado_em timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(item_id,empresa_id,tenant_id) REFERENCES app.nfce_import_item(id,empresa_id,tenant_id),
  FOREIGN KEY(empresa_id,tenant_id) REFERENCES app.empresa(id,tenant_id), UNIQUE(id,empresa_id,tenant_id)
);
CREATE INDEX nfce_import_source_scope_idx ON app.nfce_import_source(tenant_id,empresa_id,item_id);
ALTER TABLE app.fiscal_document_origin ADD COLUMN nfce_source_id uuid;
ALTER TABLE app.fiscal_document_origin ALTER COLUMN staging_id DROP NOT NULL;
ALTER TABLE app.fiscal_document_origin ALTER COLUMN cnpj DROP NOT NULL;
ALTER TABLE app.fiscal_document_origin ALTER COLUMN nsu DROP NOT NULL;
ALTER TABLE app.fiscal_document_origin ADD CONSTRAINT fiscal_document_origin_source_check CHECK((staging_id IS NOT NULL) <> (nfce_source_id IS NOT NULL));
ALTER TABLE app.fiscal_document_origin ADD CONSTRAINT fiscal_document_origin_nfce_source FOREIGN KEY(nfce_source_id,empresa_id,tenant_id) REFERENCES app.nfce_import_source(id,empresa_id,tenant_id);
ALTER TABLE app.fiscal_document_event ADD COLUMN nfce_source_id uuid;
ALTER TABLE app.fiscal_document_event ALTER COLUMN staging_id DROP NOT NULL;
ALTER TABLE app.fiscal_document_event ADD CONSTRAINT fiscal_document_event_source_check CHECK((staging_id IS NOT NULL) <> (nfce_source_id IS NOT NULL));
ALTER TABLE app.fiscal_document_event ADD CONSTRAINT fiscal_document_event_nfce_source FOREIGN KEY(nfce_source_id,empresa_id,tenant_id) REFERENCES app.nfce_import_source(id,empresa_id,tenant_id);
ALTER TABLE app.tax_st_settlement_event DROP CONSTRAINT tax_st_settlement_event_action_check;
ALTER TABLE app.tax_st_settlement_event ADD CONSTRAINT tax_st_settlement_event_action_check CHECK(action IN ('PROCESSED','BLOCKED','SUBMITTED','APPROVED','REJECTED','DRAFT_EXPORTED','REPROCESSED','DOCUMENT_SET_CHANGED'));
GRANT UPDATE(estado,protocolo,protocolo_recebido_em,atualizado_em,cancelado_em,protocolo_cancelamento) ON app.fiscal_document TO contaia_app;
DO $$ DECLARE alvo text; BEGIN
  FOREACH alvo IN ARRAY ARRAY['nfce_import_batch','nfce_import_item','nfce_import_source'] LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',alvo);
    EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',alvo);
    EXECUTE format('CREATE POLICY %I ON app.%I FOR SELECT USING (tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id))',alvo||'_select',alvo);
    EXECUTE format('CREATE POLICY %I ON app.%I FOR INSERT WITH CHECK (tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id))',alvo||'_insert',alvo);
    EXECUTE format('CREATE POLICY %I ON app.%I FOR UPDATE USING (tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id)) WITH CHECK (tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id))',alvo||'_update',alvo);
    EXECUTE format('CREATE TRIGGER escopo_imutavel BEFORE UPDATE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.proteger_escopo_empresa()',alvo);
  END LOOP;
END $$;
GRANT SELECT,INSERT,UPDATE ON app.nfce_import_batch,app.nfce_import_item,app.nfce_import_source TO contaia_app;
REVOKE DELETE ON app.nfce_import_batch,app.nfce_import_item,app.nfce_import_source FROM contaia_app;
CREATE FUNCTION app.tax_st_settlement_mark_stale(p_empresa uuid,p_competence date,p_actor uuid,p_correlation text,p_document uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=app,public,pg_temp AS $$
DECLARE tenant uuid:=app.tenant_atual(); affected integer;
BEGIN
  IF tenant IS NULL OR p_actor IS DISTINCT FROM app.usuario_atual() OR NOT app.usuario_ativo_atual() OR
     NOT app.empresa_autorizada(p_empresa) OR
     NOT EXISTS(SELECT 1 FROM app.usuario_papel WHERE usuario_id=p_actor AND tenant_id=tenant AND removido_em IS NULL
       AND papel IN ('admin_escritorio','contador','auxiliar')) THEN RAISE EXCEPTION 'ICMS_ST_SETTLEMENT_ACCESS_DENIED'; END IF;
  INSERT INTO app.tax_st_settlement_event(tenant_id,empresa_id,snapshot_id,action,actor_id,correlation_id,occurred_at,details)
    SELECT s.tenant_id,s.empresa_id,s.id,'DOCUMENT_SET_CHANGED',p_actor,p_correlation,now(),jsonb_build_object('source','NFCE_65','documentId',p_document,'event','IMPORTED')
      FROM app.tax_st_settlement_snapshot s WHERE s.tenant_id=tenant AND s.empresa_id=p_empresa AND s.competence=p_competence
        AND EXISTS(SELECT 1 FROM app.tax_st_settlement_review_event review WHERE review.snapshot_id=s.id AND review.action IN ('SUBMITTED','APPROVED','REJECTED'))
        AND NOT EXISTS(SELECT 1 FROM app.tax_st_settlement_event prior WHERE prior.snapshot_id=s.id AND prior.action='DOCUMENT_SET_CHANGED' AND prior.details->>'documentId'=p_document::text);
  GET DIAGNOSTICS affected=ROW_COUNT; RETURN affected;
END; $$;
REVOKE ALL ON FUNCTION app.tax_st_settlement_mark_stale(uuid,date,uuid,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.tax_st_settlement_mark_stale(uuid,date,uuid,text,uuid) TO contaia_app;
