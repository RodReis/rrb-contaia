-- SPEC-034/F34: pacotes legais, atos formais, resultados e eventos append-only.
CREATE TABLE app.tax_st_legal_rule_package (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES app.tenant(id),
  empresa_id uuid NOT NULL,
  version text NOT NULL CHECK (length(trim(version)) BETWEEN 1 AND 100),
  coverage_through date NOT NULL,
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  canonical_json jsonb NOT NULL CHECK (jsonb_typeof(canonical_json)='object'),
  requested_by uuid NOT NULL,
  created_at timestamptz NOT NULL,
  FOREIGN KEY (empresa_id,tenant_id) REFERENCES app.empresa(id,tenant_id),
  FOREIGN KEY (requested_by,tenant_id) REFERENCES app.usuario(id,tenant_id),
  UNIQUE (id,tenant_id,empresa_id),
  UNIQUE (tenant_id,empresa_id,version,content_sha256)
);
CREATE INDEX tax_st_legal_rule_package_scope_idx ON app.tax_st_legal_rule_package(tenant_id,empresa_id,created_at DESC);
CREATE INDEX tax_st_legal_rule_package_empresa_idx ON app.tax_st_legal_rule_package(empresa_id);

CREATE TABLE app.tax_st_legal_rule_package_event (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES app.tenant(id),
  empresa_id uuid NOT NULL,
  package_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('IMPORTED','APPROVED','REJECTED','SUPERSEDED')),
  actor_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL,
  correlation_id text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(details)='object'),
  FOREIGN KEY (package_id,tenant_id,empresa_id) REFERENCES app.tax_st_legal_rule_package(id,tenant_id,empresa_id),
  FOREIGN KEY (actor_id,tenant_id) REFERENCES app.usuario(id,tenant_id),
  FOREIGN KEY (empresa_id,tenant_id) REFERENCES app.empresa(id,tenant_id)
);
CREATE INDEX tax_st_legal_rule_package_event_scope_idx ON app.tax_st_legal_rule_package_event(tenant_id,empresa_id,package_id,occurred_at);
CREATE INDEX tax_st_legal_rule_package_event_empresa_idx ON app.tax_st_legal_rule_package_event(empresa_id);
CREATE UNIQUE INDEX tax_st_legal_rule_package_single_decision_idx ON app.tax_st_legal_rule_package_event(package_id) WHERE action IN ('APPROVED','REJECTED');

CREATE TABLE app.tax_st_legal_formal_act (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES app.tenant(id),
  empresa_id uuid NOT NULL,
  source_package_id uuid NOT NULL,
  issuer text NOT NULL CHECK(length(trim(issuer)) BETWEEN 1 AND 200),
  act_number text NOT NULL CHECK(length(trim(act_number)) BETWEEN 1 AND 120),
  act_type text NOT NULL CHECK(act_type IN ('ASSESSMENT_NOTICE','SUMMONS','DECISION','OTHER')),
  act_date date NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL CHECK(period_end>=period_start),
  official_basis text NOT NULL CHECK(length(trim(official_basis)) BETWEEN 1 AND 1000),
  storage_key text NOT NULL,
  content_sha256 text NOT NULL CHECK(content_sha256 ~ '^[0-9a-f]{64}$'),
  canonical_facts jsonb NOT NULL CHECK(jsonb_typeof(canonical_facts)='object'),
  requested_by uuid NOT NULL,
  created_at timestamptz NOT NULL,
  FOREIGN KEY (source_package_id,tenant_id,empresa_id) REFERENCES app.tax_st_history_package(id,tenant_id,empresa_id),
  FOREIGN KEY (empresa_id,tenant_id) REFERENCES app.empresa(id,tenant_id),
  FOREIGN KEY (requested_by,tenant_id) REFERENCES app.usuario(id,tenant_id),
  UNIQUE (id,tenant_id,empresa_id)
);
CREATE INDEX tax_st_legal_formal_act_scope_idx ON app.tax_st_legal_formal_act(tenant_id,empresa_id,source_package_id,act_date);
CREATE INDEX tax_st_legal_formal_act_empresa_idx ON app.tax_st_legal_formal_act(empresa_id);

CREATE TABLE app.tax_st_legal_formal_act_event (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES app.tenant(id),
  empresa_id uuid NOT NULL,
  act_id uuid NOT NULL,
  action text NOT NULL CHECK(action IN ('IMPORTED','APPROVED','REJECTED')),
  actor_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL,
  correlation_id text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(details)='object'),
  FOREIGN KEY (act_id,tenant_id,empresa_id) REFERENCES app.tax_st_legal_formal_act(id,tenant_id,empresa_id),
  FOREIGN KEY (actor_id,tenant_id) REFERENCES app.usuario(id,tenant_id),
  FOREIGN KEY (empresa_id,tenant_id) REFERENCES app.empresa(id,tenant_id)
);
CREATE INDEX tax_st_legal_formal_act_event_scope_idx ON app.tax_st_legal_formal_act_event(tenant_id,empresa_id,act_id,occurred_at);
CREATE INDEX tax_st_legal_formal_act_event_empresa_idx ON app.tax_st_legal_formal_act_event(empresa_id);
CREATE UNIQUE INDEX tax_st_legal_formal_act_single_decision_idx ON app.tax_st_legal_formal_act_event(act_id) WHERE action IN ('APPROVED','REJECTED');

CREATE TABLE app.tax_st_legal_accrual_result (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES app.tenant(id),
  empresa_id uuid NOT NULL,
  source_package_id uuid NOT NULL,
  rule_package_id uuid,
  reference_date date NOT NULL,
  contract_version integer NOT NULL CHECK(contract_version>0),
  idempotency_sha256 text NOT NULL CHECK(idempotency_sha256 ~ '^[0-9a-f]{64}$'),
  canonical_json jsonb NOT NULL CHECK(jsonb_typeof(canonical_json)='object'),
  content_sha256 text NOT NULL CHECK(content_sha256 ~ '^[0-9a-f]{64}$'),
  status text NOT NULL CHECK(status IN ('READY_FOR_INTERNAL_REVIEW','INDETERMINATE')),
  requested_by uuid NOT NULL,
  generated_at timestamptz NOT NULL,
  correlation_id text NOT NULL,
  FOREIGN KEY (source_package_id,tenant_id,empresa_id) REFERENCES app.tax_st_history_package(id,tenant_id,empresa_id),
  FOREIGN KEY (rule_package_id,tenant_id,empresa_id) REFERENCES app.tax_st_legal_rule_package(id,tenant_id,empresa_id),
  FOREIGN KEY (empresa_id,tenant_id) REFERENCES app.empresa(id,tenant_id),
  FOREIGN KEY (requested_by,tenant_id) REFERENCES app.usuario(id,tenant_id),
  UNIQUE (id,tenant_id,empresa_id),
  UNIQUE (tenant_id,empresa_id,idempotency_sha256)
);
CREATE INDEX tax_st_legal_accrual_result_scope_idx ON app.tax_st_legal_accrual_result(tenant_id,empresa_id,source_package_id,reference_date,generated_at DESC);
CREATE INDEX tax_st_legal_accrual_result_empresa_idx ON app.tax_st_legal_accrual_result(empresa_id);

CREATE TABLE app.tax_st_legal_accrual_event (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES app.tenant(id),
  empresa_id uuid NOT NULL,
  result_id uuid NOT NULL,
  action text NOT NULL CHECK(action IN ('SELECTED','CALCULATED','REVIEWED','EXPORTED','REPRODUCED','SUPERSEDED','FAILED')),
  actor_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL,
  correlation_id text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(details)='object'),
  FOREIGN KEY (result_id,tenant_id,empresa_id) REFERENCES app.tax_st_legal_accrual_result(id,tenant_id,empresa_id),
  FOREIGN KEY (actor_id,tenant_id) REFERENCES app.usuario(id,tenant_id),
  FOREIGN KEY (empresa_id,tenant_id) REFERENCES app.empresa(id,tenant_id)
);
CREATE INDEX tax_st_legal_accrual_event_scope_idx ON app.tax_st_legal_accrual_event(tenant_id,empresa_id,result_id,occurred_at);
CREATE INDEX tax_st_legal_accrual_event_empresa_idx ON app.tax_st_legal_accrual_event(empresa_id);

DO $$ DECLARE tabela text; BEGIN
  FOREACH tabela IN ARRAY ARRAY['tax_st_legal_rule_package','tax_st_legal_rule_package_event','tax_st_legal_formal_act',
    'tax_st_legal_formal_act_event','tax_st_legal_accrual_result','tax_st_legal_accrual_event'] LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',tabela);
    EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',tabela);
    EXECUTE format('CREATE POLICY %I ON app.%I FOR SELECT USING (tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id))',tabela||'_select',tabela);
    EXECUTE format('CREATE POLICY %I ON app.%I FOR INSERT WITH CHECK (tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id))',tabela||'_insert',tabela);
    EXECUTE format('CREATE TRIGGER escopo_imutavel BEFORE UPDATE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.proteger_escopo_empresa()',tabela);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.rejeitar_escrita_em_historico()',tabela||'_append_only',tabela);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON app.%I FOR EACH STATEMENT EXECUTE FUNCTION app.rejeitar_truncate_tax_resolution()',tabela||'_no_truncate',tabela);
  END LOOP;
END $$;
REVOKE ALL ON app.tax_st_legal_rule_package,app.tax_st_legal_rule_package_event,app.tax_st_legal_formal_act,
  app.tax_st_legal_formal_act_event,app.tax_st_legal_accrual_result,app.tax_st_legal_accrual_event FROM PUBLIC,contaia_app;
GRANT SELECT,INSERT ON app.tax_st_legal_rule_package,app.tax_st_legal_rule_package_event,app.tax_st_legal_formal_act,
  app.tax_st_legal_formal_act_event,app.tax_st_legal_accrual_result,app.tax_st_legal_accrual_event TO contaia_app;
REVOKE UPDATE,DELETE,TRUNCATE ON app.tax_st_history_package_event FROM contaia_app;
GRANT SELECT,INSERT ON app.tax_st_history_package_event TO contaia_app;
