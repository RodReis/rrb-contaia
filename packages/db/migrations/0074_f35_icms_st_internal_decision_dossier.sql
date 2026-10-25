CREATE TABLE app.tax_st_destination_rule_package (
 id uuid PRIMARY KEY DEFAULT app.uuid_v7(), tenant_id uuid NOT NULL REFERENCES app.tenant(id), empresa_id uuid NOT NULL,
 version text NOT NULL CHECK(length(trim(version)) BETWEEN 1 AND 100), destination text NOT NULL CHECK(destination IN ('APPROPRIATION','COMPENSATION','TRANSFER','REFUND_REQUEST','GUIDE_PAYMENT','RECTIFICATION_BOOKKEEPING','DISPUTE_ANALYSIS')),
 regime text NOT NULL CHECK(regime IN ('SIMPLES_NACIONAL','LUCRO_PRESUMIDO')), valid_from date NOT NULL, valid_through date NOT NULL CHECK(valid_through>=valid_from),
 official_basis text NOT NULL CHECK(length(trim(official_basis)) BETWEEN 1 AND 1000), source_url text NOT NULL CHECK(length(trim(source_url)) BETWEEN 1 AND 2000), consulted_at date NOT NULL,
 source_sha256 text NOT NULL CHECK(source_sha256 ~ '^[0-9a-f]{64}$'), storage_key text NOT NULL, conditions jsonb NOT NULL CHECK(jsonb_typeof(conditions)='array'),
 requested_by uuid NOT NULL, created_at timestamptz NOT NULL, FOREIGN KEY(empresa_id,tenant_id) REFERENCES app.empresa(id,tenant_id), FOREIGN KEY(requested_by,tenant_id) REFERENCES app.usuario(id,tenant_id), UNIQUE(id,tenant_id,empresa_id)
);
CREATE INDEX tax_st_destination_rule_scope_idx ON app.tax_st_destination_rule_package(tenant_id,empresa_id,destination,regime,valid_from,valid_through);
CREATE INDEX tax_st_destination_rule_empresa_idx ON app.tax_st_destination_rule_package(empresa_id);
CREATE TABLE app.tax_st_destination_rule_event (
 id uuid PRIMARY KEY DEFAULT app.uuid_v7(), tenant_id uuid NOT NULL REFERENCES app.tenant(id), empresa_id uuid NOT NULL, package_id uuid NOT NULL,
 action text NOT NULL CHECK(action IN ('IMPORTED','APPROVED','REJECTED','SUPERSEDED')), actor_id uuid NOT NULL, occurred_at timestamptz NOT NULL,
 correlation_id text NOT NULL, details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(details)='object'),
 FOREIGN KEY(package_id,tenant_id,empresa_id) REFERENCES app.tax_st_destination_rule_package(id,tenant_id,empresa_id), FOREIGN KEY(actor_id,tenant_id) REFERENCES app.usuario(id,tenant_id), FOREIGN KEY(empresa_id,tenant_id) REFERENCES app.empresa(id,tenant_id)
);
CREATE INDEX tax_st_destination_rule_event_scope_idx ON app.tax_st_destination_rule_event(tenant_id,empresa_id,package_id,occurred_at,id);
CREATE INDEX tax_st_destination_rule_event_empresa_idx ON app.tax_st_destination_rule_event(empresa_id);
CREATE UNIQUE INDEX tax_st_destination_rule_decision_idx ON app.tax_st_destination_rule_event(package_id) WHERE action IN ('APPROVED','REJECTED');
CREATE TABLE app.tax_st_internal_decision_dossier (
 id uuid PRIMARY KEY DEFAULT app.uuid_v7(), tenant_id uuid NOT NULL REFERENCES app.tenant(id), empresa_id uuid NOT NULL,
 source_package_id uuid NOT NULL, accrual_result_id uuid NOT NULL, revision integer NOT NULL CHECK(revision>0),
 idempotency_sha256 text NOT NULL CHECK(idempotency_sha256 ~ '^[0-9a-f]{64}$'),
 content_sha256 text NOT NULL CHECK(content_sha256 ~ '^[0-9a-f]{64}$'), canonical_json jsonb NOT NULL CHECK(jsonb_typeof(canonical_json)='object'),
 status text NOT NULL CHECK(status IN ('DRAFT','IN_REVIEW','PARTIALLY_DECIDED','DECIDED','BLOCKED_INDETERMINATE','POSSIBLY_OUTDATED','SUPERSEDED')),
 prepared_by uuid NOT NULL, generated_at timestamptz NOT NULL, correlation_id text NOT NULL,
 FOREIGN KEY(source_package_id,tenant_id,empresa_id) REFERENCES app.tax_st_history_package(id,tenant_id,empresa_id),
 FOREIGN KEY(accrual_result_id,tenant_id,empresa_id) REFERENCES app.tax_st_legal_accrual_result(id,tenant_id,empresa_id),
 FOREIGN KEY(empresa_id,tenant_id) REFERENCES app.empresa(id,tenant_id), FOREIGN KEY(prepared_by,tenant_id) REFERENCES app.usuario(id,tenant_id),
 UNIQUE(id,tenant_id,empresa_id), UNIQUE(tenant_id,empresa_id,idempotency_sha256)
);
CREATE INDEX tax_st_internal_dossier_scope_idx ON app.tax_st_internal_decision_dossier(tenant_id,empresa_id,generated_at DESC);
CREATE INDEX tax_st_internal_dossier_empresa_idx ON app.tax_st_internal_decision_dossier(empresa_id);
CREATE TABLE app.tax_st_internal_decision_evidence (
 id uuid PRIMARY KEY DEFAULT app.uuid_v7(), tenant_id uuid NOT NULL REFERENCES app.tenant(id), empresa_id uuid NOT NULL, dossier_id uuid NOT NULL,
 track text NOT NULL CHECK(track IN ('RESTITUTION','COMPLEMENT','DOSSIER')), kind text NOT NULL CHECK(length(trim(kind)) BETWEEN 1 AND 100),
 description text NOT NULL CHECK(length(trim(description)) BETWEEN 1 AND 1000), file_name text NOT NULL CHECK(length(trim(file_name)) BETWEEN 1 AND 255),
 storage_key text NOT NULL, content_sha256 text NOT NULL CHECK(content_sha256 ~ '^[0-9a-f]{64}$'), requested_by uuid NOT NULL, created_at timestamptz NOT NULL,
 FOREIGN KEY(dossier_id,tenant_id,empresa_id) REFERENCES app.tax_st_internal_decision_dossier(id,tenant_id,empresa_id),
 FOREIGN KEY(empresa_id,tenant_id) REFERENCES app.empresa(id,tenant_id), FOREIGN KEY(requested_by,tenant_id) REFERENCES app.usuario(id,tenant_id), UNIQUE(id,tenant_id,empresa_id)
);
CREATE INDEX tax_st_internal_evidence_scope_idx ON app.tax_st_internal_decision_evidence(tenant_id,empresa_id,dossier_id,track,created_at);
CREATE INDEX tax_st_internal_evidence_empresa_idx ON app.tax_st_internal_decision_evidence(empresa_id);
CREATE TABLE app.tax_st_internal_decision_event (
 id uuid PRIMARY KEY DEFAULT app.uuid_v7(), tenant_id uuid NOT NULL REFERENCES app.tenant(id), empresa_id uuid NOT NULL,
 dossier_id uuid NOT NULL, track text NOT NULL CHECK(track IN ('RESTITUTION','COMPLEMENT','DOSSIER')),
 action text NOT NULL CHECK(action IN ('CREATED','SUBMITTED','APPROVED','REJECTED','RETURNED_FOR_EVIDENCE','BLOCKED','EXPORTED','REPRODUCED','SUPERSEDED','FAILED','EVIDENCE_ATTACHED','EVIDENCE_DOWNLOADED')),
 actor_id uuid NOT NULL, occurred_at timestamptz NOT NULL, correlation_id text NOT NULL,
 details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(details)='object'),
 FOREIGN KEY(dossier_id,tenant_id,empresa_id) REFERENCES app.tax_st_internal_decision_dossier(id,tenant_id,empresa_id),
 FOREIGN KEY(actor_id,tenant_id) REFERENCES app.usuario(id,tenant_id), FOREIGN KEY(empresa_id,tenant_id) REFERENCES app.empresa(id,tenant_id)
);
CREATE INDEX tax_st_internal_event_scope_idx ON app.tax_st_internal_decision_event(tenant_id,empresa_id,dossier_id,occurred_at,id);
CREATE INDEX tax_st_internal_event_empresa_idx ON app.tax_st_internal_decision_event(empresa_id);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['tax_st_destination_rule_package','tax_st_destination_rule_event','tax_st_internal_decision_dossier','tax_st_internal_decision_evidence','tax_st_internal_decision_event'] LOOP
  EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t); EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY %I ON app.%I FOR SELECT USING (tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id))',t||'_select',t);
  EXECUTE format('CREATE POLICY %I ON app.%I FOR INSERT WITH CHECK (tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id))',t||'_insert',t);
  EXECUTE format('CREATE TRIGGER escopo_imutavel BEFORE UPDATE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.proteger_escopo_empresa()',t);
  EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.rejeitar_escrita_em_historico()',t||'_append_only',t);
  EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON app.%I FOR EACH STATEMENT EXECUTE FUNCTION app.rejeitar_truncate_tax_resolution()',t||'_no_truncate',t);
 END LOOP;
END $$;
REVOKE ALL ON app.tax_st_destination_rule_package,app.tax_st_destination_rule_event,app.tax_st_internal_decision_dossier,app.tax_st_internal_decision_evidence,app.tax_st_internal_decision_event FROM PUBLIC,contaia_app;
GRANT SELECT,INSERT ON app.tax_st_destination_rule_package,app.tax_st_destination_rule_event,app.tax_st_internal_decision_dossier,app.tax_st_internal_decision_evidence,app.tax_st_internal_decision_event TO contaia_app;
