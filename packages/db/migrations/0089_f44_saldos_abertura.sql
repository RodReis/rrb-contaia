-- SPEC-044/F44: saldos de abertura em versões aprovadas, CSV atômico e movimento próprio OPENING.
CREATE TABLE app.opening_balance_version (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(), tenant_id uuid NOT NULL, empresa_id uuid NOT NULL,
  version bigint NOT NULL CHECK(version > 0), status text NOT NULL CHECK(status IN ('DRAFT','APPROVED','SUPERSEDED')),
  base_date date NOT NULL CHECK(base_date >= DATE '0001-01-01'), source text NOT NULL CHECK(source IN ('MANUAL','CSV')),
  debit_cents bigint NOT NULL DEFAULT 0 CHECK(debit_cents BETWEEN 0 AND 9007199254740991),
  credit_cents bigint NOT NULL DEFAULT 0 CHECK(credit_cents BETWEEN 0 AND 9007199254740991),
  content_hash char(64) CHECK(content_hash IS NULL OR content_hash ~ '^[0-9a-f]{64}$'),
  revision integer NOT NULL DEFAULT 1 CHECK(revision > 0), supersedes_id uuid,
  replacement_reason text, created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  approved_by uuid, approved_at timestamptz, correlation_id text NOT NULL,
  UNIQUE(tenant_id,empresa_id,version), UNIQUE(id,tenant_id,empresa_id), UNIQUE(tenant_id,empresa_id,id),
  FOREIGN KEY(empresa_id,tenant_id) REFERENCES app.empresa(id,tenant_id),
  FOREIGN KEY(created_by,tenant_id) REFERENCES app.usuario(id,tenant_id),
  FOREIGN KEY(approved_by,tenant_id) REFERENCES app.usuario(id,tenant_id),
  FOREIGN KEY(supersedes_id,tenant_id,empresa_id) REFERENCES app.opening_balance_version(id,tenant_id,empresa_id),
  CHECK((status='DRAFT' AND approved_by IS NULL AND approved_at IS NULL AND content_hash IS NULL) OR
        (status IN ('APPROVED','SUPERSEDED') AND approved_by IS NOT NULL AND approved_at IS NOT NULL AND content_hash IS NOT NULL)),
  CHECK((supersedes_id IS NULL AND replacement_reason IS NULL) OR (supersedes_id IS NOT NULL AND length(trim(replacement_reason)) > 0))
);
CREATE UNIQUE INDEX opening_balance_one_approved_idx ON app.opening_balance_version(tenant_id,empresa_id) WHERE status='APPROVED';
CREATE INDEX opening_balance_version_company_idx ON app.opening_balance_version(empresa_id);
CREATE INDEX opening_balance_version_tenant_company_idx ON app.opening_balance_version(tenant_id,empresa_id,status,version DESC);
CREATE UNIQUE INDEX opening_balance_version_active_scope_idx ON app.opening_balance_version(id,tenant_id,empresa_id) WHERE status='APPROVED';

CREATE TABLE app.opening_balance_line (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(), tenant_id uuid NOT NULL, empresa_id uuid NOT NULL, version_id uuid NOT NULL,
  line_number integer NOT NULL CHECK(line_number > 0), account_id uuid NOT NULL, cost_center_id uuid,
  account_code text NOT NULL, account_name text NOT NULL, cost_center_code text, cost_center_name text,
  debit_cents bigint NOT NULL CHECK(debit_cents BETWEEN 0 AND 9007199254740991),
  credit_cents bigint NOT NULL CHECK(credit_cents BETWEEN 0 AND 9007199254740991), note text,
  source_line integer CHECK(source_line IS NULL OR source_line > 0), created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(tenant_id,empresa_id,version_id) REFERENCES app.opening_balance_version(tenant_id,empresa_id,id),
  FOREIGN KEY(account_id,empresa_id,tenant_id) REFERENCES app.conta_contabil(id,empresa_id,tenant_id),
  FOREIGN KEY(cost_center_id,empresa_id,tenant_id) REFERENCES app.centro_custo(id,empresa_id,tenant_id),
  UNIQUE(id,tenant_id,empresa_id,version_id), UNIQUE(tenant_id,empresa_id,id,version_id)
);
CREATE UNIQUE INDEX opening_balance_account_scope_idx
  ON app.conta_contabil(id,empresa_id,tenant_id);
CREATE UNIQUE INDEX opening_balance_cost_center_scope_idx
  ON app.centro_custo(id,empresa_id,tenant_id);
CREATE UNIQUE INDEX opening_balance_line_position_idx ON app.opening_balance_line(tenant_id,empresa_id,version_id,line_number);
CREATE UNIQUE INDEX opening_balance_line_account_center_idx ON app.opening_balance_line(tenant_id,empresa_id,version_id,account_id,coalesce(cost_center_id,'00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX opening_balance_line_company_idx ON app.opening_balance_line(empresa_id);
CREATE INDEX opening_balance_line_tenant_company_idx ON app.opening_balance_line(tenant_id,empresa_id,version_id,account_id);

CREATE TABLE app.opening_balance_preview (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(), tenant_id uuid NOT NULL, empresa_id uuid NOT NULL, version_id uuid NOT NULL,
  expected_revision integer NOT NULL CHECK(expected_revision > 0), file_hash char(64) NOT NULL CHECK(file_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL CHECK(status IN ('VALID','INVALID')), rows jsonb NOT NULL, errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  idempotency_key text NOT NULL, created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), correlation_id text NOT NULL,
  FOREIGN KEY(tenant_id,empresa_id,version_id) REFERENCES app.opening_balance_version(tenant_id,empresa_id,id),
  FOREIGN KEY(created_by,tenant_id) REFERENCES app.usuario(id,tenant_id),
  UNIQUE(tenant_id,empresa_id,version_id,idempotency_key), UNIQUE(id,tenant_id,empresa_id,version_id)
);
CREATE INDEX opening_balance_preview_company_idx ON app.opening_balance_preview(empresa_id);
CREATE INDEX opening_balance_preview_tenant_company_idx ON app.opening_balance_preview(tenant_id,empresa_id,version_id,created_at DESC);

CREATE TABLE app.opening_balance_idempotency (
  id uuid NOT NULL DEFAULT app.uuid_v7(), tenant_id uuid NOT NULL, empresa_id uuid NOT NULL, operation text NOT NULL CHECK(operation IN ('DRAFT','UPDATE_DRAFT','CSV_PREVIEW','CSV_CONFIRM','APPROVE','REPLACE')),
  idempotency_key text NOT NULL, request_hash char(64) NOT NULL CHECK(request_hash ~ '^[0-9a-f]{64}$'),
  response jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(id), UNIQUE(tenant_id,empresa_id,operation,idempotency_key),
  UNIQUE(id,tenant_id,empresa_id),
  FOREIGN KEY(empresa_id,tenant_id) REFERENCES app.empresa(id,tenant_id)
);
CREATE INDEX opening_balance_idempotency_company_idx ON app.opening_balance_idempotency(empresa_id);
CREATE INDEX opening_balance_idempotency_tenant_company_idx ON app.opening_balance_idempotency(tenant_id,empresa_id,operation);

CREATE TABLE app.opening_balance_event (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(), tenant_id uuid NOT NULL, empresa_id uuid NOT NULL, version_id uuid NOT NULL,
  preview_id uuid, idempotency_id uuid, action text NOT NULL CHECK(action IN ('DRAFT_CREATED','DRAFT_UPDATED','CSV_PREVIEWED','CSV_CONFIRMED','APPROVED','REPLACED','CONFLICT','REJECTED')),
  result text NOT NULL CHECK(result IN ('SUCESSO','RECUSADO','FALHA')), actor_id uuid NOT NULL,
  base_date date, source text CHECK(source IS NULL OR source IN ('MANUAL','CSV')), reason text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb, correlation_id text NOT NULL, occurred_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(empresa_id,tenant_id) REFERENCES app.empresa(id,tenant_id),
  FOREIGN KEY(version_id,tenant_id,empresa_id) REFERENCES app.opening_balance_version(id,tenant_id,empresa_id),
  FOREIGN KEY(preview_id,tenant_id,empresa_id,version_id) REFERENCES app.opening_balance_preview(id,tenant_id,empresa_id,version_id),
  FOREIGN KEY(idempotency_id,tenant_id,empresa_id) REFERENCES app.opening_balance_idempotency(id,tenant_id,empresa_id),
  FOREIGN KEY(actor_id,tenant_id) REFERENCES app.usuario(id,tenant_id)
);
CREATE INDEX opening_balance_event_company_idx ON app.opening_balance_event(empresa_id);
CREATE INDEX opening_balance_event_history_idx ON app.opening_balance_event(tenant_id,empresa_id,occurred_at,id);

-- F42 ganha uma fonte própria de movimento; lançamentos manuais permanecem distinguíveis e numerados.
ALTER TABLE app.movimento_razao ALTER COLUMN lancamento_id DROP NOT NULL;
ALTER TABLE app.movimento_razao ALTER COLUMN partida_id DROP NOT NULL;
ALTER TABLE app.movimento_razao ALTER COLUMN numero_lancamento DROP NOT NULL;
ALTER TABLE app.movimento_razao ALTER COLUMN evento_origem_id DROP NOT NULL;
ALTER TABLE app.movimento_razao ADD COLUMN opening_version_id uuid;
ALTER TABLE app.movimento_razao ADD COLUMN opening_line_id uuid;
ALTER TABLE app.movimento_razao DROP CONSTRAINT movimento_razao_tipo_check;
ALTER TABLE app.movimento_razao ADD CONSTRAINT movimento_razao_tipo_check CHECK(tipo IN ('POSTING','CANCELLATION_ADJUSTMENT','OPENING'));
ALTER TABLE app.movimento_razao ADD CONSTRAINT movimento_razao_source_check CHECK(
  (tipo IN ('POSTING','CANCELLATION_ADJUSTMENT') AND lancamento_id IS NOT NULL AND partida_id IS NOT NULL AND opening_version_id IS NULL AND opening_line_id IS NULL AND numero_lancamento IS NOT NULL) OR
  (tipo='OPENING' AND lancamento_id IS NULL AND partida_id IS NULL AND evento_origem_id IS NOT NULL AND opening_version_id IS NOT NULL AND opening_line_id IS NOT NULL AND numero_lancamento IS NULL)
);
ALTER TABLE app.movimento_razao ADD CONSTRAINT movimento_razao_opening_version_fk
  FOREIGN KEY(opening_version_id,tenant_id,empresa_id) REFERENCES app.opening_balance_version(id,tenant_id,empresa_id);
ALTER TABLE app.movimento_razao ADD CONSTRAINT movimento_razao_opening_line_fk
  FOREIGN KEY(opening_line_id,tenant_id,empresa_id,opening_version_id) REFERENCES app.opening_balance_line(id,tenant_id,empresa_id,version_id);
CREATE UNIQUE INDEX movimento_razao_opening_idempotencia_idx
  ON app.movimento_razao(tenant_id,empresa_id,versao_id,opening_line_id) WHERE tipo='OPENING';
CREATE INDEX movimento_razao_opening_company_idx ON app.movimento_razao(tenant_id,empresa_id,opening_version_id,opening_line_id) WHERE tipo='OPENING';

CREATE OR REPLACE FUNCTION app.opening_balance_version_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
   IF OLD.status='DRAFT' THEN RETURN OLD; END IF;
   RAISE EXCEPTION 'OPENING_BALANCE_VERSION_IMMUTABLE' USING ERRCODE='restrict_violation';
 END IF;
 IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.empresa_id IS DISTINCT FROM OLD.empresa_id OR
    NEW.version IS DISTINCT FROM OLD.version OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at OR
    NEW.correlation_id IS DISTINCT FROM OLD.correlation_id OR NEW.supersedes_id IS DISTINCT FROM OLD.supersedes_id OR
    NEW.replacement_reason IS DISTINCT FROM OLD.replacement_reason THEN
   RAISE EXCEPTION 'OPENING_BALANCE_SCOPE_IMMUTABLE' USING ERRCODE='restrict_violation';
 END IF;
 IF OLD.status='DRAFT' AND NEW.status='DRAFT' AND NEW.revision=OLD.revision+1 THEN RETURN NEW; END IF;
 IF OLD.status='DRAFT' AND NEW.status='APPROVED' AND NEW.revision=OLD.revision AND NEW.approved_by IS NOT NULL AND NEW.approved_at IS NOT NULL AND NEW.content_hash IS NOT NULL THEN RETURN NEW; END IF;
 IF OLD.status='APPROVED' AND NEW.status='SUPERSEDED' AND
    (to_jsonb(NEW)-'status')=(to_jsonb(OLD)-'status') THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'OPENING_BALANCE_TRANSITION_INVALID' USING ERRCODE='check_violation';
END; $$;

CREATE OR REPLACE FUNCTION app.opening_balance_line_draft_only() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE version_status text; version_id_value uuid;
BEGIN
 IF TG_OP='INSERT' THEN version_id_value:=NEW.version_id; ELSE version_id_value:=OLD.version_id; END IF;
 SELECT status INTO version_status FROM app.opening_balance_version WHERE id=version_id_value AND tenant_id=CASE WHEN TG_OP='DELETE' THEN OLD.tenant_id ELSE NEW.tenant_id END AND empresa_id=CASE WHEN TG_OP='DELETE' THEN OLD.empresa_id ELSE NEW.empresa_id END;
 IF version_status IS DISTINCT FROM 'DRAFT' THEN RAISE EXCEPTION 'OPENING_BALANCE_LINE_IMMUTABLE' USING ERRCODE='restrict_violation'; END IF;
 IF TG_OP='INSERT' THEN RETURN NEW; ELSIF TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.empresa_id IS DISTINCT FROM OLD.empresa_id OR NEW.version_id IS DISTINCT FROM OLD.version_id THEN
   RAISE EXCEPTION 'OPENING_BALANCE_SCOPE_IMMUTABLE' USING ERRCODE='restrict_violation';
 END IF;
 RETURN NEW;
END; $$;CREATE OR REPLACE FUNCTION app.opening_balance_append_only() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'OPENING_BALANCE_APPEND_ONLY' USING ERRCODE='restrict_violation'; END; $$;
CREATE TRIGGER opening_balance_version_transition BEFORE UPDATE OR DELETE ON app.opening_balance_version FOR EACH ROW EXECUTE FUNCTION app.opening_balance_version_transition();
CREATE TRIGGER opening_balance_line_draft_only BEFORE INSERT OR UPDATE OR DELETE ON app.opening_balance_line FOR EACH ROW EXECUTE FUNCTION app.opening_balance_line_draft_only();
CREATE TRIGGER opening_balance_preview_immutable BEFORE UPDATE OR DELETE ON app.opening_balance_preview FOR EACH ROW EXECUTE FUNCTION app.opening_balance_append_only();
CREATE TRIGGER opening_balance_event_immutable BEFORE UPDATE OR DELETE ON app.opening_balance_event FOR EACH ROW EXECUTE FUNCTION app.opening_balance_append_only();
CREATE TRIGGER opening_balance_idempotency_immutable BEFORE UPDATE OR DELETE ON app.opening_balance_idempotency FOR EACH ROW EXECUTE FUNCTION app.opening_balance_append_only();
CREATE TRIGGER opening_balance_preview_no_truncate BEFORE TRUNCATE ON app.opening_balance_preview FOR EACH STATEMENT EXECUTE FUNCTION app.rejeitar_truncate_tax_resolution();
CREATE TRIGGER opening_balance_event_no_truncate BEFORE TRUNCATE ON app.opening_balance_event FOR EACH STATEMENT EXECUTE FUNCTION app.rejeitar_truncate_tax_resolution();
CREATE TRIGGER opening_balance_idempotency_no_truncate BEFORE TRUNCATE ON app.opening_balance_idempotency FOR EACH STATEMENT EXECUTE FUNCTION app.rejeitar_truncate_tax_resolution();

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['opening_balance_version','opening_balance_line','opening_balance_preview','opening_balance_idempotency','opening_balance_event'] LOOP
  EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t); EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY %I ON app.%I FOR SELECT USING (tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id))',t||'_select',t);
  EXECUTE format('CREATE POLICY %I ON app.%I FOR INSERT WITH CHECK (tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id))',t||'_insert',t);
  IF t IN ('opening_balance_version','opening_balance_line') THEN
   EXECUTE format('CREATE POLICY %I ON app.%I FOR UPDATE USING (tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id)) WITH CHECK (tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id))',t||'_update',t);
   -- Sem policy de DELETE: rascunho é revisado por UPDATE; histórico permanece.
  END IF;
 END LOOP;
END $$;
REVOKE ALL ON app.opening_balance_version,app.opening_balance_line,app.opening_balance_preview,app.opening_balance_idempotency,app.opening_balance_event FROM PUBLIC,contaia_app;
GRANT SELECT,INSERT,UPDATE ON app.opening_balance_version TO contaia_app;
GRANT SELECT,INSERT,UPDATE ON app.opening_balance_line TO contaia_app;
GRANT SELECT,INSERT ON app.opening_balance_preview,app.opening_balance_idempotency,app.opening_balance_event TO contaia_app;
REVOKE TRUNCATE ON app.opening_balance_version,app.opening_balance_line,app.opening_balance_preview,app.opening_balance_idempotency,app.opening_balance_event FROM PUBLIC,contaia_app;
