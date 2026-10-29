-- SPEC-043/F43: ciclos mensais, snapshots reproduzíveis e trilha append-only.
CREATE TABLE app.accounting_period_cycle (
  tenant_id uuid NOT NULL, company_id uuid NOT NULL,
  competence text NOT NULL CHECK(competence ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
 status text NOT NULL CHECK(status IN ('OPEN','CLOSED','REOPENED')),
 active_close_id uuid, latest_version integer NOT NULL CHECK(latest_version >= 0), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,company_id,competence),
  FOREIGN KEY(company_id,tenant_id) REFERENCES app.empresa(id,tenant_id),
 CHECK((status='CLOSED' AND active_close_id IS NOT NULL) OR (status IN ('OPEN','REOPENED') AND active_close_id IS NULL)),
 CHECK((status='OPEN' AND latest_version=0) OR (status IN ('CLOSED','REOPENED') AND latest_version > 0))
);
CREATE INDEX accounting_period_cycle_company_idx ON app.accounting_period_cycle(tenant_id,company_id,competence,status);
CREATE INDEX accounting_period_cycle_empresa_idx ON app.accounting_period_cycle(company_id);
CREATE INDEX accounting_period_cycle_tenant_idx ON app.accounting_period_cycle(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS conta_contabil_id_empresa_tenant_f43_idx ON app.conta_contabil(id,empresa_id,tenant_id);

CREATE TABLE app.accounting_period_close (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(), tenant_id uuid NOT NULL, company_id uuid NOT NULL,
  competence text NOT NULL CHECK(competence ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'), version integer NOT NULL CHECK(version > 0),
  projection_version bigint NOT NULL CHECK(projection_version > 0), kind text NOT NULL CHECK(kind IN ('REGULAR','EMPTY_CONFIRMED')),
  debit_cents bigint NOT NULL CHECK(debit_cents >= 0), credit_cents bigint NOT NULL CHECK(credit_cents >= 0),
  movement_count bigint NOT NULL CHECK(movement_count >= 0), entry_count bigint NOT NULL CHECK(entry_count >= 0),
  first_competence text NOT NULL CHECK(first_competence ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  content jsonb NOT NULL, content_hash char(64) NOT NULL CHECK(content_hash ~ '^[0-9a-f]{64}$'),
  closed_by uuid NOT NULL, closed_at timestamptz NOT NULL, correlation_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(company_id,tenant_id) REFERENCES app.empresa(id,tenant_id), FOREIGN KEY(closed_by,tenant_id) REFERENCES app.usuario(id,tenant_id),
  FOREIGN KEY(tenant_id,company_id,competence) REFERENCES app.accounting_period_cycle(tenant_id,company_id,competence) DEFERRABLE INITIALLY DEFERRED,
  UNIQUE(id,tenant_id,company_id), UNIQUE(tenant_id,company_id,competence,version)
);
ALTER TABLE app.accounting_period_cycle ADD CONSTRAINT accounting_period_active_close_fk
 FOREIGN KEY(active_close_id,tenant_id,company_id) REFERENCES app.accounting_period_close(id,tenant_id,company_id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX accounting_period_close_empresa_idx ON app.accounting_period_close(company_id);
CREATE INDEX accounting_period_close_tenant_empresa_idx ON app.accounting_period_close(tenant_id,company_id);

CREATE TABLE app.accounting_period_close_snapshot_line (
 tenant_id uuid NOT NULL, company_id uuid NOT NULL, close_id uuid NOT NULL, account_id uuid NOT NULL, code text NOT NULL, name text NOT NULL,
 account_type text NOT NULL CHECK(account_type IN ('ANALYTICAL','SYNTHETIC')), normal_balance text NOT NULL CHECK(normal_balance IN ('DEBIT','CREDIT')),
 level integer NOT NULL CHECK(level >= 0), parent_account_id uuid, opening_balance_cents bigint NOT NULL,
 debit_cents bigint NOT NULL CHECK(debit_cents >= 0), credit_cents bigint NOT NULL CHECK(credit_cents >= 0),
 closing_balance_cents bigint NOT NULL, closing_nature text NOT NULL CHECK(closing_nature IN ('DEBIT','CREDIT','ZERO')), movement_count bigint NOT NULL CHECK(movement_count >= 0),
 PRIMARY KEY(tenant_id,company_id,close_id,account_id),
 FOREIGN KEY(tenant_id,company_id,close_id) REFERENCES app.accounting_period_close(tenant_id,company_id,id),
 FOREIGN KEY(account_id,company_id,tenant_id) REFERENCES app.conta_contabil(id,empresa_id,tenant_id),
 FOREIGN KEY(parent_account_id,company_id,tenant_id) REFERENCES app.conta_contabil(id,empresa_id,tenant_id)
);
CREATE INDEX accounting_period_snapshot_line_empresa_idx ON app.accounting_period_close_snapshot_line(company_id);
CREATE INDEX accounting_period_snapshot_line_tenant_empresa_idx ON app.accounting_period_close_snapshot_line(tenant_id,company_id);

CREATE TABLE app.accounting_period_idempotency (
 tenant_id uuid NOT NULL, company_id uuid NOT NULL,
 competence text NOT NULL CHECK(competence ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
 operation text NOT NULL CHECK(operation IN ('CLOSE','REOPEN')), expected_version integer NOT NULL CHECK(expected_version >= 0),
 idempotency_key text NOT NULL, request_hash char(64) NOT NULL CHECK(request_hash ~ '^[0-9a-f]{64}$'),
 response jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,company_id,competence,operation,expected_version,idempotency_key),
 FOREIGN KEY(company_id,tenant_id) REFERENCES app.empresa(id,tenant_id)
);
CREATE INDEX accounting_period_idempotency_empresa_idx ON app.accounting_period_idempotency(company_id);
CREATE INDEX accounting_period_idempotency_tenant_empresa_idx ON app.accounting_period_idempotency(tenant_id,company_id);

CREATE TABLE app.accounting_period_event (
 id uuid PRIMARY KEY DEFAULT app.uuid_v7(), tenant_id uuid NOT NULL, company_id uuid NOT NULL,
 competence text NOT NULL CHECK(competence ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
 action text NOT NULL CHECK(action IN ('CLOSED','REOPENED','CLOSE_REJECTED','REOPEN_REJECTED','CONFLICT')),
 result text NOT NULL CHECK(result IN ('SUCESSO','RECUSADO','FALHA')), close_id uuid, version integer, actor_id uuid NOT NULL, reason text,
 blockers jsonb NOT NULL DEFAULT '[]'::jsonb, correlation_id text NOT NULL, operation text NOT NULL CHECK(operation IN ('CLOSE','REOPEN')),
 expected_version integer NOT NULL CHECK(expected_version >= 0), idempotency_key text NOT NULL, occurred_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(company_id,tenant_id) REFERENCES app.empresa(id,tenant_id), FOREIGN KEY(actor_id,tenant_id) REFERENCES app.usuario(id,tenant_id),
 FOREIGN KEY(tenant_id,company_id,close_id) REFERENCES app.accounting_period_close(tenant_id,company_id,id),
 UNIQUE(tenant_id,company_id,competence,action,idempotency_key),
 FOREIGN KEY(tenant_id,company_id,competence,operation,expected_version,idempotency_key)
   REFERENCES app.accounting_period_idempotency(tenant_id,company_id,competence,operation,expected_version,idempotency_key)
   DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX accounting_period_event_empresa_idx ON app.accounting_period_event(company_id);
CREATE INDEX accounting_period_event_tenant_empresa_idx ON app.accounting_period_event(tenant_id,company_id);
CREATE INDEX accounting_period_event_history_idx ON app.accounting_period_event(tenant_id,company_id,competence,occurred_at,id);

CREATE OR REPLACE FUNCTION app.accounting_period_no_change() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'ACCOUNTING_PERIOD_APPEND_ONLY' USING ERRCODE='restrict_violation'; END; $$;
CREATE OR REPLACE FUNCTION app.accounting_period_company_scope_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.company_id IS DISTINCT FROM OLD.company_id THEN
  RAISE EXCEPTION 'tenant_id e company_id sao imutaveis' USING ERRCODE='restrict_violation';
 END IF;
 RETURN NEW;
END; $$;
CREATE OR REPLACE FUNCTION app.accounting_period_idempotency_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'ACCOUNTING_PERIOD_IDEMPOTENCY_IMMUTABLE' USING ERRCODE='restrict_violation'; END; $$;
CREATE OR REPLACE FUNCTION app.accounting_period_cycle_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR OLD.tenant_id IS DISTINCT FROM NEW.tenant_id OR OLD.company_id IS DISTINCT FROM NEW.company_id OR OLD.competence IS DISTINCT FROM NEW.competence THEN
   RAISE EXCEPTION 'ACCOUNTING_PERIOD_CYCLE_TRANSITION_INVALID' USING ERRCODE='restrict_violation';
 END IF;
 IF OLD.latest_version > NEW.latest_version OR
   NOT ((OLD.status IN ('OPEN','REOPENED') AND NEW.status='CLOSED' AND NEW.latest_version=OLD.latest_version+1 AND NEW.active_close_id IS NOT NULL) OR
        (OLD.status='CLOSED' AND NEW.status='REOPENED' AND OLD.latest_version=NEW.latest_version AND OLD.active_close_id IS NOT NULL AND NEW.active_close_id IS NULL)) THEN
   RAISE EXCEPTION 'ACCOUNTING_PERIOD_CYCLE_TRANSITION_INVALID' USING ERRCODE='check_violation';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER accounting_period_close_immutable BEFORE UPDATE OR DELETE ON app.accounting_period_close FOR EACH ROW EXECUTE FUNCTION app.accounting_period_no_change();
CREATE TRIGGER accounting_period_snapshot_line_immutable BEFORE UPDATE OR DELETE ON app.accounting_period_close_snapshot_line FOR EACH ROW EXECUTE FUNCTION app.accounting_period_no_change();
CREATE TRIGGER accounting_period_event_immutable BEFORE UPDATE OR DELETE ON app.accounting_period_event FOR EACH ROW EXECUTE FUNCTION app.accounting_period_no_change();
CREATE TRIGGER accounting_period_cycle_transition BEFORE UPDATE OR DELETE ON app.accounting_period_cycle FOR EACH ROW EXECUTE FUNCTION app.accounting_period_cycle_transition();
CREATE TRIGGER accounting_period_idempotency_immutable BEFORE UPDATE OR DELETE ON app.accounting_period_idempotency FOR EACH ROW EXECUTE FUNCTION app.accounting_period_idempotency_transition();
CREATE TRIGGER escopo_imutavel BEFORE UPDATE ON app.accounting_period_cycle FOR EACH ROW EXECUTE FUNCTION app.accounting_period_company_scope_immutable();
CREATE TRIGGER escopo_imutavel BEFORE UPDATE ON app.accounting_period_close FOR EACH ROW EXECUTE FUNCTION app.accounting_period_company_scope_immutable();
CREATE TRIGGER escopo_imutavel BEFORE UPDATE ON app.accounting_period_close_snapshot_line FOR EACH ROW EXECUTE FUNCTION app.accounting_period_company_scope_immutable();
CREATE TRIGGER escopo_imutavel BEFORE UPDATE ON app.accounting_period_event FOR EACH ROW EXECUTE FUNCTION app.accounting_period_company_scope_immutable();
CREATE TRIGGER escopo_imutavel BEFORE UPDATE ON app.accounting_period_idempotency FOR EACH ROW EXECUTE FUNCTION app.accounting_period_company_scope_immutable();
CREATE TRIGGER accounting_period_close_no_truncate BEFORE TRUNCATE ON app.accounting_period_close FOR EACH STATEMENT EXECUTE FUNCTION app.rejeitar_truncate_tax_resolution();
CREATE TRIGGER accounting_period_snapshot_line_no_truncate BEFORE TRUNCATE ON app.accounting_period_close_snapshot_line FOR EACH STATEMENT EXECUTE FUNCTION app.rejeitar_truncate_tax_resolution();
CREATE TRIGGER accounting_period_event_no_truncate BEFORE TRUNCATE ON app.accounting_period_event FOR EACH STATEMENT EXECUTE FUNCTION app.rejeitar_truncate_tax_resolution();
CREATE TRIGGER accounting_period_idempotency_no_truncate BEFORE TRUNCATE ON app.accounting_period_idempotency FOR EACH STATEMENT EXECUTE FUNCTION app.rejeitar_truncate_tax_resolution();
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['accounting_period_cycle','accounting_period_close','accounting_period_close_snapshot_line','accounting_period_event','accounting_period_idempotency'] LOOP
  EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t); EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY %I ON app.%I FOR SELECT USING (tenant_id=app.tenant_atual() AND app.empresa_autorizada(company_id))',t||'_select',t);
  EXECUTE format('CREATE POLICY %I ON app.%I FOR INSERT WITH CHECK (tenant_id=app.tenant_atual() AND app.empresa_autorizada(company_id))',t||'_insert',t);
  IF t='accounting_period_cycle' THEN EXECUTE format('CREATE POLICY %I ON app.%I FOR UPDATE USING (tenant_id=app.tenant_atual() AND app.empresa_autorizada(company_id)) WITH CHECK (tenant_id=app.tenant_atual() AND app.empresa_autorizada(company_id))',t||'_update',t); END IF;
 END LOOP;
END $$;
REVOKE ALL ON app.accounting_period_cycle,app.accounting_period_close,app.accounting_period_close_snapshot_line,app.accounting_period_event,app.accounting_period_idempotency FROM PUBLIC,contaia_app;
GRANT SELECT,INSERT,UPDATE ON app.accounting_period_cycle TO contaia_app;
GRANT SELECT,INSERT ON app.accounting_period_close,app.accounting_period_close_snapshot_line,app.accounting_period_event,app.accounting_period_idempotency TO contaia_app;
REVOKE TRUNCATE ON app.accounting_period_cycle,app.accounting_period_close,app.accounting_period_close_snapshot_line,app.accounting_period_event,app.accounting_period_idempotency FROM PUBLIC,contaia_app;
