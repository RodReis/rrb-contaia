-- SPEC-033/F33: dossies historicos internos, imutaveis e reproduziveis.
CREATE TABLE app.tax_st_history_package (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES app.tenant(id),
  empresa_id uuid NOT NULL,
  regime text NOT NULL CHECK (regime IN ('SIMPLES_NACIONAL','LUCRO_PRESUMIDO')),
  period_start date NOT NULL CHECK (extract(day from period_start)=1 AND period_start >= DATE '2016-10-01'),
  period_end date NOT NULL CHECK (extract(day from period_end)=1 AND period_end <= DATE '2018-02-01' AND period_end >= period_start),
  contract_version integer NOT NULL CHECK (contract_version > 0),
  selection_sha256 text NOT NULL CHECK (selection_sha256 ~ '^[0-9a-f]{64}$'),
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN ('READY_FOR_INTERNAL_REVIEW','POSSIBLY_OUTDATED','BLOQUEADO_POR_ACRESCIMOS_LEGAIS')),
  source_revision_ids uuid[] NOT NULL,
  excluded_competences jsonb NOT NULL,
  canonical_json jsonb NOT NULL,
  requested_by uuid NOT NULL,
  generated_at timestamptz NOT NULL,
  correlation_id text NOT NULL,
  FOREIGN KEY (empresa_id,tenant_id) REFERENCES app.empresa(id,tenant_id),
  FOREIGN KEY (requested_by,tenant_id) REFERENCES app.usuario(id,tenant_id),
  UNIQUE (id,tenant_id,empresa_id),
  UNIQUE (tenant_id,empresa_id,regime,period_start,period_end,contract_version,selection_sha256),
  CHECK (jsonb_typeof(excluded_competences)='array' AND jsonb_typeof(canonical_json)='object')
);
CREATE INDEX tax_st_history_package_scope_idx ON app.tax_st_history_package(tenant_id,empresa_id,period_start,period_end,generated_at DESC);
CREATE INDEX tax_st_history_package_empresa_idx ON app.tax_st_history_package(empresa_id);

CREATE TABLE app.tax_st_history_package_line (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES app.tenant(id),
  empresa_id uuid NOT NULL,
  package_id uuid NOT NULL,
  source_kind text NOT NULL CHECK (source_kind IN ('APPROVED_SETTLEMENT','APPROVED_RETURN_REVERSAL')),
  source_revision_id uuid NOT NULL,
  source_line_id uuid NOT NULL,
  competence date NOT NULL CHECK (extract(day from competence)=1),
  event_date date,
  document_id uuid,
  item_id text,
  document_model text CHECK (document_model IS NULL OR document_model IN ('55','65')),
  access_key text CHECK (access_key IS NULL OR access_key ~ '^\d{44}$'),
  product_code text,
  source_ids text[] NOT NULL,
  rule_id text NOT NULL,
  formula_version text NOT NULL,
  memory_sha256 text NOT NULL CHECK (memory_sha256 ~ '^[0-9a-f]{64}$'),
  document_sha256 text CHECK (document_sha256 IS NULL OR document_sha256 ~ '^[0-9a-f]{64}$'),
  restitution_principal_cents bigint NOT NULL CHECK (restitution_principal_cents >= 0),
  complement_principal_cents bigint NOT NULL CHECK (complement_principal_cents >= 0),
  efd_record_code text,
  facts jsonb NOT NULL,
  FOREIGN KEY (package_id,tenant_id,empresa_id) REFERENCES app.tax_st_history_package(id,tenant_id,empresa_id),
  FOREIGN KEY (source_revision_id,tenant_id,empresa_id) REFERENCES app.tax_st_settlement_snapshot(id,tenant_id,empresa_id),
  FOREIGN KEY (source_line_id,tenant_id,empresa_id) REFERENCES app.tax_st_settlement_line(id,tenant_id,empresa_id),
  FOREIGN KEY (document_id,empresa_id,tenant_id) REFERENCES app.fiscal_document(id,empresa_id,tenant_id),
  FOREIGN KEY (empresa_id,tenant_id) REFERENCES app.empresa(id,tenant_id)
);
CREATE INDEX tax_st_history_line_scope_idx ON app.tax_st_history_package_line(tenant_id,empresa_id,package_id,competence);
CREATE INDEX tax_st_history_line_empresa_idx ON app.tax_st_history_package_line(empresa_id);

CREATE TABLE app.tax_st_history_package_event (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES app.tenant(id),
  empresa_id uuid NOT NULL,
  package_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('SELECTED','GENERATED','DOWNLOADED','REPRODUCED','SUPERSEDED','FAILED')),
  actor_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL,
  correlation_id text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  FOREIGN KEY (package_id,tenant_id,empresa_id) REFERENCES app.tax_st_history_package(id,tenant_id,empresa_id),
  FOREIGN KEY (actor_id,tenant_id) REFERENCES app.usuario(id,tenant_id),
  FOREIGN KEY (empresa_id,tenant_id) REFERENCES app.empresa(id,tenant_id)
);
CREATE INDEX tax_st_history_event_scope_idx ON app.tax_st_history_package_event(tenant_id,empresa_id,package_id,occurred_at);
CREATE INDEX tax_st_history_event_empresa_idx ON app.tax_st_history_package_event(empresa_id);

DO $$ DECLARE tabela text; BEGIN
  FOREACH tabela IN ARRAY ARRAY['tax_st_history_package','tax_st_history_package_line','tax_st_history_package_event'] LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',tabela);
    EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',tabela);
    EXECUTE format('CREATE POLICY %I ON app.%I FOR SELECT USING (tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id))',tabela||'_select',tabela);
    EXECUTE format('CREATE POLICY %I ON app.%I FOR INSERT WITH CHECK (tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id))',tabela||'_insert',tabela);
    EXECUTE format('CREATE TRIGGER escopo_imutavel BEFORE UPDATE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.proteger_escopo_empresa()',tabela);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.rejeitar_escrita_em_historico()',tabela||'_append_only',tabela);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON app.%I FOR EACH STATEMENT EXECUTE FUNCTION app.rejeitar_truncate_tax_resolution()',tabela||'_no_truncate',tabela);
  END LOOP;
END $$;
REVOKE ALL ON app.tax_st_history_package,app.tax_st_history_package_line,app.tax_st_history_package_event FROM PUBLIC,contaia_app;
GRANT SELECT,INSERT ON app.tax_st_history_package,app.tax_st_history_package_line,app.tax_st_history_package_event TO contaia_app;
