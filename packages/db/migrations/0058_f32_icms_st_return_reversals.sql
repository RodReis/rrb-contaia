-- SPEC-032/F32: append-only return evidence and proportional reversals.
CREATE TABLE app.tax_st_return_event (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES app.tenant(id),
  empresa_id uuid NOT NULL,
  original_snapshot_id uuid NOT NULL,
  original_line_id uuid NOT NULL,
  origin text NOT NULL CHECK (origin IN ('NORMALIZED_NFE','EFD','MANUAL_DOCUMENT')),
  return_document_id uuid,
  return_document_identity text NOT NULL CHECK (length(trim(return_document_identity)) BETWEEN 1 AND 120),
  return_item_identity text NOT NULL CHECK (length(trim(return_item_identity)) BETWEEN 1 AND 80),
  event_date date NOT NULL,
  normalized_unit text NOT NULL CHECK (length(trim(normalized_unit)) BETWEEN 1 AND 20),
  returned_quantity_scaled numeric(38,0) NOT NULL CHECK (returned_quantity_scaled > 0),
  evidence_sha256 text NOT NULL CHECK (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  evidence_facts jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_id uuid NOT NULL,
  correlation_id text NOT NULL,
  occurred_at timestamptz NOT NULL,
  FOREIGN KEY (original_snapshot_id,tenant_id,empresa_id)
    REFERENCES app.tax_st_settlement_snapshot(id,tenant_id,empresa_id),
  FOREIGN KEY (original_line_id,tenant_id,empresa_id)
    REFERENCES app.tax_st_settlement_line(id,tenant_id,empresa_id),
  FOREIGN KEY (return_document_id,empresa_id,tenant_id)
    REFERENCES app.fiscal_document(id,empresa_id,tenant_id),
  FOREIGN KEY (empresa_id,tenant_id) REFERENCES app.empresa(id,tenant_id),
  UNIQUE (tenant_id,empresa_id,origin,return_document_identity,return_item_identity,event_date)
);
CREATE INDEX tax_st_return_event_scope_idx ON app.tax_st_return_event(tenant_id,empresa_id,event_date DESC);
CREATE INDEX tax_st_return_event_original_idx ON app.tax_st_return_event(tenant_id,empresa_id,original_line_id,event_date);

CREATE TABLE app.tax_st_return_reversal (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES app.tenant(id),
  empresa_id uuid NOT NULL,
  event_id uuid NOT NULL,
  original_snapshot_id uuid NOT NULL,
  original_line_id uuid NOT NULL,
  competence date NOT NULL CHECK (extract(day from competence)=1),
  returned_quantity_scaled numeric(38,0) NOT NULL CHECK (returned_quantity_scaled > 0),
  remaining_quantity_scaled numeric(38,0) NOT NULL CHECK (remaining_quantity_scaled >= 0),
  reversed_restitution_cents bigint NOT NULL CHECK (reversed_restitution_cents >= 0),
  reversed_complement_cents bigint NOT NULL CHECK (reversed_complement_cents >= 0),
  formula_version text NOT NULL,
  source_ids text[] NOT NULL,
  actor_id uuid NOT NULL,
  correlation_id text NOT NULL,
  occurred_at timestamptz NOT NULL,
  FOREIGN KEY (event_id,tenant_id,empresa_id) REFERENCES app.tax_st_return_event(id,tenant_id,empresa_id),
  FOREIGN KEY (original_snapshot_id,tenant_id,empresa_id) REFERENCES app.tax_st_settlement_snapshot(id,tenant_id,empresa_id),
  FOREIGN KEY (original_line_id,tenant_id,empresa_id) REFERENCES app.tax_st_settlement_line(id,tenant_id,empresa_id),
  FOREIGN KEY (empresa_id,tenant_id) REFERENCES app.empresa(id,tenant_id),
  UNIQUE (event_id), UNIQUE (id,tenant_id,empresa_id)
);
CREATE INDEX tax_st_return_reversal_scope_idx ON app.tax_st_return_reversal(tenant_id,empresa_id,competence DESC);
CREATE INDEX tax_st_return_reversal_original_idx ON app.tax_st_return_reversal(tenant_id,empresa_id,original_line_id);

DO $$ DECLARE alvo text; BEGIN
  FOREACH alvo IN ARRAY ARRAY['tax_st_return_event','tax_st_return_reversal'] LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',alvo);
    EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',alvo);
    EXECUTE format('CREATE POLICY %I ON app.%I FOR SELECT USING (tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id))',alvo||'_select',alvo);
    EXECUTE format('CREATE POLICY %I ON app.%I FOR INSERT WITH CHECK (tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id))',alvo||'_insert',alvo);
    EXECUTE format('CREATE TRIGGER escopo_imutavel BEFORE UPDATE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.proteger_escopo_empresa()',alvo);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.rejeitar_escrita_em_historico()',alvo||'_append_only',alvo);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON app.%I FOR EACH STATEMENT EXECUTE FUNCTION app.rejeitar_truncate_tax_resolution()',alvo||'_no_truncate',alvo);
  END LOOP;
END $$;
REVOKE ALL ON app.tax_st_return_event,app.tax_st_return_reversal FROM PUBLIC,contaia_app;
GRANT SELECT,INSERT ON app.tax_st_return_event,app.tax_st_return_reversal TO contaia_app;
