-- SPEC-036/F36: pacotes normativos, declarações, evidências e revisões mensais.
CREATE TABLE app.tax_monthly_rule_package (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(), tenant_id uuid NOT NULL REFERENCES app.tenant(id), empresa_id uuid NOT NULL,
  kind text NOT NULL CHECK(kind IN ('SIMPLES_NACIONAL_DAS','LUCRO_PRESUMIDO_ICMS_DARE')),
  version text NOT NULL CHECK(length(trim(version)) BETWEEN 1 AND 100), valid_from date NOT NULL, valid_through date,
  consulted_at date NOT NULL, official_basis text NOT NULL CHECK(length(trim(official_basis)) BETWEEN 1 AND 1000),
  source_url text NOT NULL CHECK(length(trim(source_url)) BETWEEN 1 AND 2000), source_storage_key text NOT NULL,
  source_sha256 text NOT NULL CHECK(source_sha256 ~ '^[0-9a-f]{64}$'), content_sha256 text NOT NULL CHECK(content_sha256 ~ '^[0-9a-f]{64}$'),
  canonical_json jsonb NOT NULL CHECK(jsonb_typeof(canonical_json)='object'), requested_by uuid NOT NULL, created_at timestamptz NOT NULL,
  CHECK(valid_through IS NULL OR valid_through>=valid_from),
  FOREIGN KEY(empresa_id,tenant_id) REFERENCES app.empresa(id,tenant_id), FOREIGN KEY(requested_by,tenant_id) REFERENCES app.usuario(id,tenant_id),
  UNIQUE(id,tenant_id,empresa_id), UNIQUE(tenant_id,empresa_id,kind,version,content_sha256)
);
CREATE INDEX tax_monthly_rule_package_scope_idx ON app.tax_monthly_rule_package(tenant_id,empresa_id,kind,valid_from,valid_through);
CREATE INDEX tax_monthly_rule_package_empresa_idx ON app.tax_monthly_rule_package(empresa_id);

CREATE TABLE app.tax_monthly_rule_package_event (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(), tenant_id uuid NOT NULL REFERENCES app.tenant(id), empresa_id uuid NOT NULL, package_id uuid NOT NULL,
  action text NOT NULL CHECK(action IN ('IMPORTED','APPROVED','REJECTED','SUPERSEDED','DOWNLOADED')), actor_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL, correlation_id text NOT NULL, details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(details)='object'),
  FOREIGN KEY(package_id,tenant_id,empresa_id) REFERENCES app.tax_monthly_rule_package(id,tenant_id,empresa_id),
  FOREIGN KEY(actor_id,tenant_id) REFERENCES app.usuario(id,tenant_id), FOREIGN KEY(empresa_id,tenant_id) REFERENCES app.empresa(id,tenant_id)
);
CREATE INDEX tax_monthly_rule_package_event_scope_idx ON app.tax_monthly_rule_package_event(tenant_id,empresa_id,package_id,occurred_at,id);
CREATE INDEX tax_monthly_rule_package_event_empresa_idx ON app.tax_monthly_rule_package_event(empresa_id);
CREATE UNIQUE INDEX tax_monthly_rule_package_decision_idx ON app.tax_monthly_rule_package_event(package_id) WHERE action IN ('APPROVED','REJECTED');

CREATE TABLE app.tax_monthly_declaration (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(), tenant_id uuid NOT NULL REFERENCES app.tenant(id), empresa_id uuid NOT NULL,
  competence date NOT NULL CHECK(extract(day from competence)=1), kind text NOT NULL CHECK(kind IN ('SIMPLES_NACIONAL_DAS','LUCRO_PRESUMIDO_ICMS_DARE')),
  revision integer NOT NULL CHECK(revision>0), supersedes_id uuid, idempotency_sha256 text NOT NULL CHECK(idempotency_sha256 ~ '^[0-9a-f]{64}$'),
  content_sha256 text NOT NULL CHECK(content_sha256 ~ '^[0-9a-f]{64}$'), canonical_json jsonb NOT NULL CHECK(jsonb_typeof(canonical_json)='object'),
  prepared_by uuid NOT NULL, created_at timestamptz NOT NULL, correlation_id text NOT NULL,
  FOREIGN KEY(supersedes_id,tenant_id,empresa_id) REFERENCES app.tax_monthly_declaration(id,tenant_id,empresa_id),
  FOREIGN KEY(empresa_id,tenant_id) REFERENCES app.empresa(id,tenant_id), FOREIGN KEY(prepared_by,tenant_id) REFERENCES app.usuario(id,tenant_id),
  UNIQUE(id,tenant_id,empresa_id), UNIQUE(tenant_id,empresa_id,idempotency_sha256), UNIQUE(tenant_id,empresa_id,competence,kind,revision)
);
CREATE INDEX tax_monthly_declaration_scope_idx ON app.tax_monthly_declaration(tenant_id,empresa_id,competence,kind,revision DESC);
CREATE INDEX tax_monthly_declaration_empresa_idx ON app.tax_monthly_declaration(empresa_id);

CREATE TABLE app.tax_monthly_declaration_event (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(), tenant_id uuid NOT NULL REFERENCES app.tenant(id), empresa_id uuid NOT NULL, declaration_id uuid NOT NULL,
  action text NOT NULL CHECK(action IN ('DECLARED','SUPERSEDED','EVIDENCE_ATTACHED','EVIDENCE_DOWNLOADED')),
  actor_id uuid NOT NULL, occurred_at timestamptz NOT NULL, correlation_id text NOT NULL, details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(details)='object'),
  FOREIGN KEY(declaration_id,tenant_id,empresa_id) REFERENCES app.tax_monthly_declaration(id,tenant_id,empresa_id),
  FOREIGN KEY(actor_id,tenant_id) REFERENCES app.usuario(id,tenant_id), FOREIGN KEY(empresa_id,tenant_id) REFERENCES app.empresa(id,tenant_id)
);
CREATE INDEX tax_monthly_declaration_event_scope_idx ON app.tax_monthly_declaration_event(tenant_id,empresa_id,declaration_id,occurred_at,id);
CREATE INDEX tax_monthly_declaration_event_empresa_idx ON app.tax_monthly_declaration_event(empresa_id);

CREATE TABLE app.tax_monthly_evidence (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(), tenant_id uuid NOT NULL REFERENCES app.tenant(id), empresa_id uuid NOT NULL, declaration_id uuid NOT NULL,
  kind text NOT NULL CHECK(length(trim(kind)) BETWEEN 1 AND 100), description text NOT NULL CHECK(length(trim(description)) BETWEEN 1 AND 1000),
  file_name text NOT NULL CHECK(length(trim(file_name)) BETWEEN 1 AND 255), storage_key text NOT NULL,
  content_sha256 text NOT NULL CHECK(content_sha256 ~ '^[0-9a-f]{64}$'), requested_by uuid NOT NULL, created_at timestamptz NOT NULL,
  FOREIGN KEY(declaration_id,tenant_id,empresa_id) REFERENCES app.tax_monthly_declaration(id,tenant_id,empresa_id),
  FOREIGN KEY(empresa_id,tenant_id) REFERENCES app.empresa(id,tenant_id), FOREIGN KEY(requested_by,tenant_id) REFERENCES app.usuario(id,tenant_id),
  UNIQUE(id,tenant_id,empresa_id)
);
CREATE INDEX tax_monthly_evidence_scope_idx ON app.tax_monthly_evidence(tenant_id,empresa_id,declaration_id,created_at,id);
CREATE INDEX tax_monthly_evidence_empresa_idx ON app.tax_monthly_evidence(empresa_id);

CREATE TABLE app.tax_monthly_assessment (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(), tenant_id uuid NOT NULL REFERENCES app.tenant(id), empresa_id uuid NOT NULL,
  competence date NOT NULL CHECK(extract(day from competence)=1), kind text NOT NULL CHECK(kind IN ('SIMPLES_NACIONAL_DAS','LUCRO_PRESUMIDO_ICMS_DARE')),
  revision integer NOT NULL CHECK(revision>0), rule_package_id uuid NOT NULL, declaration_id uuid,
  idempotency_sha256 text NOT NULL CHECK(idempotency_sha256 ~ '^[0-9a-f]{64}$'), content_sha256 text NOT NULL CHECK(content_sha256 ~ '^[0-9a-f]{64}$'),
  status text NOT NULL CHECK(status IN ('DRAFT','INCOMPLETE','INDETERMINATE','READY_FOR_REVIEW','APPROVED','REJECTED','POSSIBLY_OUTDATED','SUPERSEDED')),
  canonical_json jsonb NOT NULL CHECK(jsonb_typeof(canonical_json)='object'), prepared_by uuid NOT NULL, revision_created_at timestamptz NOT NULL,
  correlation_id text NOT NULL,
  FOREIGN KEY(rule_package_id,tenant_id,empresa_id) REFERENCES app.tax_monthly_rule_package(id,tenant_id,empresa_id),
  FOREIGN KEY(declaration_id,tenant_id,empresa_id) REFERENCES app.tax_monthly_declaration(id,tenant_id,empresa_id),
  FOREIGN KEY(empresa_id,tenant_id) REFERENCES app.empresa(id,tenant_id), FOREIGN KEY(prepared_by,tenant_id) REFERENCES app.usuario(id,tenant_id),
  UNIQUE(id,tenant_id,empresa_id), UNIQUE(tenant_id,empresa_id,idempotency_sha256), UNIQUE(tenant_id,empresa_id,competence,kind,revision)
);
CREATE INDEX tax_monthly_assessment_scope_idx ON app.tax_monthly_assessment(tenant_id,empresa_id,competence,kind,revision DESC);
CREATE INDEX tax_monthly_assessment_empresa_idx ON app.tax_monthly_assessment(empresa_id);

CREATE TABLE app.tax_monthly_assessment_event (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(), tenant_id uuid NOT NULL REFERENCES app.tenant(id), empresa_id uuid NOT NULL, assessment_id uuid NOT NULL,
  action text NOT NULL CHECK(action IN ('CREATED','REPRODUCED','APPROVED','REJECTED','RETURNED_FOR_EVIDENCE','EXPORTED','DOWNLOADED','INVALIDATED','SUPERSEDED','FAILED')),
  actor_id uuid NOT NULL, occurred_at timestamptz NOT NULL, correlation_id text NOT NULL, details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(details)='object'),
  FOREIGN KEY(assessment_id,tenant_id,empresa_id) REFERENCES app.tax_monthly_assessment(id,tenant_id,empresa_id),
  FOREIGN KEY(actor_id,tenant_id) REFERENCES app.usuario(id,tenant_id), FOREIGN KEY(empresa_id,tenant_id) REFERENCES app.empresa(id,tenant_id)
);
CREATE INDEX tax_monthly_assessment_event_scope_idx ON app.tax_monthly_assessment_event(tenant_id,empresa_id,assessment_id,occurred_at,id);
CREATE INDEX tax_monthly_assessment_event_empresa_idx ON app.tax_monthly_assessment_event(empresa_id);
CREATE UNIQUE INDEX tax_monthly_assessment_decision_idx ON app.tax_monthly_assessment_event(assessment_id) WHERE action IN ('APPROVED','REJECTED','RETURNED_FOR_EVIDENCE');

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['tax_monthly_rule_package','tax_monthly_rule_package_event','tax_monthly_declaration','tax_monthly_declaration_event','tax_monthly_evidence','tax_monthly_assessment','tax_monthly_assessment_event'] LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY %I ON app.%I FOR SELECT USING (tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id))',t||'_select',t);
    EXECUTE format('CREATE POLICY %I ON app.%I FOR INSERT WITH CHECK (tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id))',t||'_insert',t);
    EXECUTE format('CREATE TRIGGER escopo_imutavel BEFORE UPDATE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.proteger_escopo_empresa()',t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.rejeitar_escrita_em_historico()',t||'_append_only',t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON app.%I FOR EACH STATEMENT EXECUTE FUNCTION app.rejeitar_truncate_tax_resolution()',t||'_no_truncate',t);
  END LOOP;
END $$;
REVOKE ALL ON app.tax_monthly_rule_package,app.tax_monthly_rule_package_event,app.tax_monthly_declaration,app.tax_monthly_declaration_event,app.tax_monthly_evidence,
  app.tax_monthly_assessment,app.tax_monthly_assessment_event FROM PUBLIC,contaia_app;
GRANT SELECT,INSERT ON app.tax_monthly_rule_package,app.tax_monthly_rule_package_event,app.tax_monthly_declaration,app.tax_monthly_declaration_event,app.tax_monthly_evidence,
  app.tax_monthly_assessment,app.tax_monthly_assessment_event TO contaia_app;
