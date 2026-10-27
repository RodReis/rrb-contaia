-- SPEC-038/F38: apuração trimestral IRPJ/CSLL, com pacotes e revisões imutáveis.
CREATE TABLE app.corporate_tax_rule_package (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(), tenant_id uuid NOT NULL REFERENCES app.tenant(id), empresa_id uuid NOT NULL,
  version text NOT NULL CHECK(length(trim(version)) BETWEEN 1 AND 100), valid_from date NOT NULL, valid_through date,
  consulted_at date NOT NULL, official_basis text NOT NULL CHECK(length(trim(official_basis)) BETWEEN 1 AND 1000),
  source_url text NOT NULL CHECK(length(trim(source_url)) BETWEEN 1 AND 2000), source_storage_key text NOT NULL,
  source_sha256 text NOT NULL CHECK(source_sha256 ~ '^[0-9a-f]{64}$'), content_sha256 text NOT NULL CHECK(content_sha256 ~ '^[0-9a-f]{64}$'),
  canonical_json jsonb NOT NULL CHECK(jsonb_typeof(canonical_json)='object'), status text NOT NULL DEFAULT 'PENDING_REVIEW'
    CHECK(status IN ('PENDING_REVIEW','APPROVED','REJECTED','SUPERSEDED')),
  requested_by uuid NOT NULL, created_at timestamptz NOT NULL,
  CHECK(valid_through IS NULL OR valid_through>=valid_from),
  FOREIGN KEY(empresa_id,tenant_id) REFERENCES app.empresa(id,tenant_id), FOREIGN KEY(requested_by,tenant_id) REFERENCES app.usuario(id,tenant_id),
  UNIQUE(id,tenant_id,empresa_id), UNIQUE(tenant_id,empresa_id,version,content_sha256)
);
CREATE INDEX corporate_tax_rule_package_scope_idx ON app.corporate_tax_rule_package(tenant_id,empresa_id,valid_from,valid_through,status);
CREATE INDEX corporate_tax_rule_package_empresa_idx ON app.corporate_tax_rule_package(empresa_id);

CREATE TABLE app.corporate_tax_rule_package_event (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(), tenant_id uuid NOT NULL REFERENCES app.tenant(id), empresa_id uuid NOT NULL, package_id uuid NOT NULL,
  action text NOT NULL CHECK(action IN ('IMPORTED','APPROVED','REJECTED','SUPERSEDED','DOWNLOADED')), actor_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL, correlation_id text NOT NULL, details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(details)='object'),
  FOREIGN KEY(package_id,tenant_id,empresa_id) REFERENCES app.corporate_tax_rule_package(id,tenant_id,empresa_id),
  FOREIGN KEY(actor_id,tenant_id) REFERENCES app.usuario(id,tenant_id), FOREIGN KEY(empresa_id,tenant_id) REFERENCES app.empresa(id,tenant_id)
);
CREATE INDEX corporate_tax_rule_package_event_scope_idx ON app.corporate_tax_rule_package_event(tenant_id,empresa_id,package_id,occurred_at,id);
CREATE INDEX corporate_tax_rule_package_event_empresa_idx ON app.corporate_tax_rule_package_event(empresa_id);
CREATE UNIQUE INDEX corporate_tax_rule_package_decision_idx ON app.corporate_tax_rule_package_event(package_id) WHERE action IN ('APPROVED','REJECTED');

CREATE TABLE app.corporate_tax_declaration (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(), tenant_id uuid NOT NULL REFERENCES app.tenant(id), empresa_id uuid NOT NULL,
  quarter text NOT NULL CHECK(quarter IN ('2026-Q1','2026-Q2','2026-Q3','2026-Q4')),
  recognition text CHECK(recognition IN ('ACCRUAL','CASH')), revision integer NOT NULL CHECK(revision>0),
  supersedes_id uuid, idempotency_sha256 text NOT NULL CHECK(idempotency_sha256 ~ '^[0-9a-f]{64}$'),
  content_sha256 text NOT NULL CHECK(content_sha256 ~ '^[0-9a-f]{64}$'), canonical_json jsonb NOT NULL CHECK(jsonb_typeof(canonical_json)='object'),
  prepared_by uuid NOT NULL, created_at timestamptz NOT NULL, correlation_id text NOT NULL,
  FOREIGN KEY(supersedes_id,tenant_id,empresa_id) REFERENCES app.corporate_tax_declaration(id,tenant_id,empresa_id),
  FOREIGN KEY(empresa_id,tenant_id) REFERENCES app.empresa(id,tenant_id), FOREIGN KEY(prepared_by,tenant_id) REFERENCES app.usuario(id,tenant_id),
  UNIQUE(id,tenant_id,empresa_id), UNIQUE(tenant_id,empresa_id,idempotency_sha256), UNIQUE(tenant_id,empresa_id,quarter,revision)
);
CREATE INDEX corporate_tax_declaration_scope_idx ON app.corporate_tax_declaration(tenant_id,empresa_id,quarter,revision DESC);
CREATE INDEX corporate_tax_declaration_empresa_idx ON app.corporate_tax_declaration(empresa_id);

CREATE TABLE app.corporate_tax_declaration_event (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(), tenant_id uuid NOT NULL REFERENCES app.tenant(id), empresa_id uuid NOT NULL, declaration_id uuid NOT NULL,
  action text NOT NULL CHECK(action IN ('DECLARED','JUSTIFIED','SUPERSEDED','EVIDENCE_ATTACHED','EVIDENCE_DOWNLOADED')),
  actor_id uuid NOT NULL, occurred_at timestamptz NOT NULL, correlation_id text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(details)='object'),
  FOREIGN KEY(declaration_id,tenant_id,empresa_id) REFERENCES app.corporate_tax_declaration(id,tenant_id,empresa_id),
  FOREIGN KEY(actor_id,tenant_id) REFERENCES app.usuario(id,tenant_id), FOREIGN KEY(empresa_id,tenant_id) REFERENCES app.empresa(id,tenant_id)
);
CREATE INDEX corporate_tax_declaration_event_scope_idx ON app.corporate_tax_declaration_event(tenant_id,empresa_id,declaration_id,occurred_at,id);
CREATE INDEX corporate_tax_declaration_event_empresa_idx ON app.corporate_tax_declaration_event(empresa_id);

CREATE TABLE app.corporate_tax_evidence (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(), tenant_id uuid NOT NULL REFERENCES app.tenant(id), empresa_id uuid NOT NULL, declaration_id uuid NOT NULL,
  kind text NOT NULL CHECK(length(trim(kind)) BETWEEN 1 AND 100), description text NOT NULL CHECK(length(trim(description)) BETWEEN 1 AND 1000),
  file_name text NOT NULL CHECK(length(trim(file_name)) BETWEEN 1 AND 255), storage_key text NOT NULL,
  content_sha256 text NOT NULL CHECK(content_sha256 ~ '^[0-9a-f]{64}$'), requested_by uuid NOT NULL, created_at timestamptz NOT NULL,
  FOREIGN KEY(declaration_id,tenant_id,empresa_id) REFERENCES app.corporate_tax_declaration(id,tenant_id,empresa_id),
  FOREIGN KEY(empresa_id,tenant_id) REFERENCES app.empresa(id,tenant_id), FOREIGN KEY(requested_by,tenant_id) REFERENCES app.usuario(id,tenant_id),
  UNIQUE(id,tenant_id,empresa_id)
);
CREATE INDEX corporate_tax_evidence_scope_idx ON app.corporate_tax_evidence(tenant_id,empresa_id,declaration_id,created_at,id);
CREATE INDEX corporate_tax_evidence_empresa_idx ON app.corporate_tax_evidence(empresa_id);

CREATE TABLE app.corporate_tax_assessment (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(), tenant_id uuid NOT NULL REFERENCES app.tenant(id), empresa_id uuid NOT NULL,
  quarter text NOT NULL CHECK(quarter IN ('2026-Q1','2026-Q2','2026-Q3','2026-Q4')),
  revision integer NOT NULL CHECK(revision>0), status text NOT NULL CHECK(status IN ('INDETERMINATE','READY_FOR_REVIEW','APPROVED','REJECTED','POSSIBLY_OUTDATED','SUPERSEDED')),
  recognition text NOT NULL CHECK(recognition IN ('ACCRUAL','CASH')), package_id uuid NOT NULL,
  declaration_id uuid NOT NULL, installment_count integer NOT NULL CHECK(installment_count BETWEEN 1 AND 3),
  idempotency_sha256 text NOT NULL CHECK(idempotency_sha256 ~ '^[0-9a-f]{64}$'), content_sha256 text NOT NULL CHECK(content_sha256 ~ '^[0-9a-f]{64}$'),
  canonical_json jsonb NOT NULL CHECK(jsonb_typeof(canonical_json)='object'), prepared_by uuid NOT NULL, created_at timestamptz NOT NULL,
  FOREIGN KEY(package_id,tenant_id,empresa_id) REFERENCES app.corporate_tax_rule_package(id,tenant_id,empresa_id),
  FOREIGN KEY(declaration_id,tenant_id,empresa_id) REFERENCES app.corporate_tax_declaration(id,tenant_id,empresa_id),
  FOREIGN KEY(empresa_id,tenant_id) REFERENCES app.empresa(id,tenant_id), FOREIGN KEY(prepared_by,tenant_id) REFERENCES app.usuario(id,tenant_id),
  UNIQUE(id,tenant_id,empresa_id), UNIQUE(tenant_id,empresa_id,idempotency_sha256), UNIQUE(tenant_id,empresa_id,quarter,revision)
);
CREATE INDEX corporate_tax_assessment_scope_idx ON app.corporate_tax_assessment(tenant_id,empresa_id,quarter,revision DESC);
CREATE INDEX corporate_tax_assessment_empresa_idx ON app.corporate_tax_assessment(empresa_id);

CREATE TABLE app.corporate_tax_artifact (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(), tenant_id uuid NOT NULL REFERENCES app.tenant(id), empresa_id uuid NOT NULL,
  assessment_id uuid NOT NULL, format text NOT NULL CHECK(format IN ('PDF','CSV','JSON','IRPJ_DARF_DRAFT','CSLL_DARF_DRAFT')),
  storage_key text NOT NULL, artifact_sha256 text NOT NULL CHECK(artifact_sha256 ~ '^[0-9a-f]{64}$'),
  canonical_sha256 text NOT NULL CHECK(canonical_sha256 ~ '^[0-9a-f]{64}$'), created_by uuid NOT NULL, created_at timestamptz NOT NULL,
  FOREIGN KEY(assessment_id,tenant_id,empresa_id) REFERENCES app.corporate_tax_assessment(id,tenant_id,empresa_id),
  FOREIGN KEY(empresa_id,tenant_id) REFERENCES app.empresa(id,tenant_id), FOREIGN KEY(created_by,tenant_id) REFERENCES app.usuario(id,tenant_id),
  UNIQUE(id,tenant_id,empresa_id)
);
CREATE INDEX corporate_tax_artifact_scope_idx ON app.corporate_tax_artifact(tenant_id,empresa_id,assessment_id,created_at,id);
CREATE INDEX corporate_tax_artifact_empresa_idx ON app.corporate_tax_artifact(empresa_id);

CREATE TABLE app.corporate_tax_assessment_event (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(), tenant_id uuid NOT NULL REFERENCES app.tenant(id), empresa_id uuid NOT NULL, assessment_id uuid NOT NULL,
  action text NOT NULL CHECK(action IN ('PREPARED','REPRODUCED','REVIEWED','APPROVED','REJECTED','RETURNED','EXPORTED','DOWNLOADED','INVALIDATED','SUPERSEDED')),
  actor_id uuid NOT NULL, occurred_at timestamptz NOT NULL, correlation_id text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(details)='object'),
  FOREIGN KEY(assessment_id,tenant_id,empresa_id) REFERENCES app.corporate_tax_assessment(id,tenant_id,empresa_id),
  FOREIGN KEY(actor_id,tenant_id) REFERENCES app.usuario(id,tenant_id), FOREIGN KEY(empresa_id,tenant_id) REFERENCES app.empresa(id,tenant_id)
);
CREATE INDEX corporate_tax_assessment_event_scope_idx ON app.corporate_tax_assessment_event(tenant_id,empresa_id,assessment_id,occurred_at,id);
CREATE INDEX corporate_tax_assessment_event_empresa_idx ON app.corporate_tax_assessment_event(empresa_id);
CREATE UNIQUE INDEX corporate_tax_assessment_decision_idx ON app.corporate_tax_assessment_event(assessment_id)
  WHERE action IN ('APPROVED','REJECTED','RETURNED');

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['corporate_tax_rule_package','corporate_tax_rule_package_event','corporate_tax_declaration','corporate_tax_declaration_event','corporate_tax_evidence','corporate_tax_assessment','corporate_tax_assessment_event','corporate_tax_artifact'] LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY %I ON app.%I FOR SELECT USING (tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id))',t||'_select',t);
    EXECUTE format('CREATE POLICY %I ON app.%I FOR INSERT WITH CHECK (tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id))',t||'_insert',t);
    EXECUTE format('CREATE TRIGGER escopo_imutavel BEFORE UPDATE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.proteger_escopo_empresa()',t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.rejeitar_escrita_em_historico()',t||'_append_only',t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON app.%I FOR EACH STATEMENT EXECUTE FUNCTION app.rejeitar_truncate_tax_resolution()',t||'_no_truncate',t);
  END LOOP;
END $$;
REVOKE ALL ON app.corporate_tax_rule_package,app.corporate_tax_rule_package_event,app.corporate_tax_declaration,app.corporate_tax_declaration_event,app.corporate_tax_evidence,
  app.corporate_tax_assessment,app.corporate_tax_assessment_event,app.corporate_tax_artifact FROM PUBLIC,contaia_app;
GRANT SELECT,INSERT ON app.corporate_tax_rule_package,app.corporate_tax_rule_package_event,app.corporate_tax_declaration,app.corporate_tax_declaration_event,app.corporate_tax_evidence,
  app.corporate_tax_assessment,app.corporate_tax_assessment_event,app.corporate_tax_artifact TO contaia_app;
