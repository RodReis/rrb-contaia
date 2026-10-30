-- SPEC-045/F45: DRE por empresa, versão publicada imutável e resultado auditável.
ALTER TABLE app.accounting_period_close_snapshot_line
  ADD COLUMN account_class text CHECK(account_class IS NULL OR account_class IN ('ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE','COMPENSATION','OTHER')),
  ADD COLUMN monthly_debit_cents bigint CHECK(monthly_debit_cents IS NULL OR monthly_debit_cents>=0),
  ADD COLUMN monthly_credit_cents bigint CHECK(monthly_credit_cents IS NULL OR monthly_credit_cents>=0);
ALTER TABLE app.accounting_period_close ADD COLUMN statement_version_id uuid;

CREATE TABLE app.accounting_statement_version (
 id uuid PRIMARY KEY DEFAULT app.uuid_v7(), tenant_id uuid NOT NULL, company_id uuid NOT NULL,
 version integer NOT NULL CHECK(version>0), status text NOT NULL CHECK(status IN ('DRAFT','ACTIVE','SUPERSEDED')),
 revision integer NOT NULL DEFAULT 0 CHECK(revision>=0), effective_from text, effective_to text,
 created_by uuid NOT NULL, published_by uuid, created_at timestamptz NOT NULL DEFAULT now(), published_at timestamptz,
 correlation_id text NOT NULL,
 FOREIGN KEY(company_id,tenant_id) REFERENCES app.empresa(id,tenant_id),
 FOREIGN KEY(created_by,tenant_id) REFERENCES app.usuario(id,tenant_id),
 FOREIGN KEY(published_by,tenant_id) REFERENCES app.usuario(id,tenant_id),
 CHECK((status='DRAFT' AND effective_from IS NULL AND effective_to IS NULL AND published_at IS NULL AND published_by IS NULL)
    OR (status='ACTIVE' AND effective_from ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' AND effective_to IS NULL AND published_at IS NOT NULL AND published_by IS NOT NULL)
    OR (status='SUPERSEDED' AND effective_from ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' AND effective_to ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' AND effective_to>=effective_from AND published_at IS NOT NULL AND published_by IS NOT NULL)),
 UNIQUE(id,tenant_id,company_id), UNIQUE(tenant_id,company_id,version)
);
CREATE UNIQUE INDEX accounting_statement_one_active_idx ON app.accounting_statement_version(tenant_id,company_id) WHERE status='ACTIVE';
CREATE INDEX accounting_statement_version_tenant_company_idx ON app.accounting_statement_version(tenant_id,company_id,version);
CREATE INDEX accounting_statement_version_company_idx ON app.accounting_statement_version(company_id);
ALTER TABLE app.accounting_period_close ADD CONSTRAINT accounting_period_close_statement_version_fk
 FOREIGN KEY(statement_version_id,tenant_id,company_id) REFERENCES app.accounting_statement_version(id,tenant_id,company_id) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE app.accounting_statement_line (
 id uuid PRIMARY KEY DEFAULT app.uuid_v7(), tenant_id uuid NOT NULL, company_id uuid NOT NULL, version_id uuid NOT NULL,
 line_code text NOT NULL CHECK(length(btrim(line_code)) BETWEEN 1 AND 40), title text NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 160),
 line_type text NOT NULL CHECK(line_type IN ('DETAIL','SUBTOTAL')), display_order integer NOT NULL CHECK(display_order>0),
 level integer NOT NULL CHECK(level BETWEEN 0 AND 8), parent_code text, presentation_sign smallint NOT NULL CHECK(presentation_sign IN (-1,1)),
 vertical_basis boolean NOT NULL DEFAULT false, active boolean NOT NULL DEFAULT true,
 FOREIGN KEY(version_id,tenant_id,company_id) REFERENCES app.accounting_statement_version(id,tenant_id,company_id),
 FOREIGN KEY(tenant_id,company_id,version_id,parent_code) REFERENCES app.accounting_statement_line(tenant_id,company_id,version_id,line_code) DEFERRABLE INITIALLY DEFERRED,
 UNIQUE(id,tenant_id,company_id,version_id), UNIQUE(tenant_id,company_id,version_id,line_code)
);
CREATE UNIQUE INDEX accounting_statement_line_active_code_idx ON app.accounting_statement_line(version_id,line_code) WHERE active;
CREATE UNIQUE INDEX accounting_statement_line_active_order_idx ON app.accounting_statement_line(version_id,display_order) WHERE active;
CREATE INDEX accounting_statement_line_company_idx ON app.accounting_statement_line(company_id);
CREATE INDEX accounting_statement_line_version_idx ON app.accounting_statement_line(tenant_id,company_id,version_id,active,display_order);

CREATE TABLE app.accounting_statement_mapping (
 tenant_id uuid NOT NULL, company_id uuid NOT NULL, version_id uuid NOT NULL, line_code text NOT NULL, account_id uuid NOT NULL,
 account_class text NOT NULL CHECK(account_class IN ('REVENUE','EXPENSE')), account_code text NOT NULL, account_name text NOT NULL,
 active boolean NOT NULL DEFAULT true,
 PRIMARY KEY(tenant_id,company_id,version_id,line_code,account_id),
 FOREIGN KEY(tenant_id,company_id,version_id,line_code) REFERENCES app.accounting_statement_line(tenant_id,company_id,version_id,line_code),
 FOREIGN KEY(account_id,company_id,tenant_id) REFERENCES app.conta_contabil(id,empresa_id,tenant_id)
);
CREATE UNIQUE INDEX accounting_statement_mapping_account_idx ON app.accounting_statement_mapping(version_id,account_id) WHERE active;
CREATE INDEX accounting_statement_mapping_company_idx ON app.accounting_statement_mapping(company_id);
CREATE INDEX accounting_statement_mapping_version_idx ON app.accounting_statement_mapping(tenant_id,company_id,version_id,active,line_code);

CREATE TABLE app.accounting_statement_component (
 tenant_id uuid NOT NULL, company_id uuid NOT NULL, version_id uuid NOT NULL, line_code text NOT NULL,
 component_code text NOT NULL, operator text NOT NULL CHECK(operator IN ('ADD','SUBTRACT')), active boolean NOT NULL DEFAULT true,
 PRIMARY KEY(tenant_id,company_id,version_id,line_code,component_code),
 FOREIGN KEY(tenant_id,company_id,version_id,line_code) REFERENCES app.accounting_statement_line(tenant_id,company_id,version_id,line_code),
 FOREIGN KEY(tenant_id,company_id,version_id,component_code) REFERENCES app.accounting_statement_line(tenant_id,company_id,version_id,line_code)
);
CREATE INDEX accounting_statement_component_company_idx ON app.accounting_statement_component(company_id);
CREATE INDEX accounting_statement_component_version_idx ON app.accounting_statement_component(tenant_id,company_id,version_id,line_code,active);

CREATE TABLE app.accounting_statement_event (
 id uuid PRIMARY KEY DEFAULT app.uuid_v7(), tenant_id uuid NOT NULL, company_id uuid NOT NULL, version_id uuid,
 action text NOT NULL CHECK(action IN ('DRAFT_CREATED','DRAFT_UPDATED','PUBLISHED','REPORT_QUERIED','EXPORT_CREATED','EXPORT_REPLAYED','EXPORT_REJECTED')),
 result text NOT NULL CHECK(result IN ('SUCESSO','RECUSADO','FALHA')), actor_id uuid NOT NULL,
 competence text CHECK(competence IS NULL OR competence ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'), period_mode text CHECK(period_mode IS NULL OR period_mode IN ('MONTH','YEAR_TO_DATE')),
 report_hash char(64) CHECK(report_hash IS NULL OR report_hash ~ '^[0-9a-f]{64}$'), details jsonb NOT NULL DEFAULT '{}'::jsonb,
 correlation_id text NOT NULL, occurred_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(company_id,tenant_id) REFERENCES app.empresa(id,tenant_id),
 FOREIGN KEY(actor_id,tenant_id) REFERENCES app.usuario(id,tenant_id),
 FOREIGN KEY(version_id,tenant_id,company_id) REFERENCES app.accounting_statement_version(id,tenant_id,company_id)
);
CREATE INDEX accounting_statement_event_company_idx ON app.accounting_statement_event(company_id);
CREATE INDEX accounting_statement_event_scope_idx ON app.accounting_statement_event(tenant_id,company_id,occurred_at,id);

CREATE TABLE app.accounting_statement_export (
 id uuid PRIMARY KEY DEFAULT app.uuid_v7(), tenant_id uuid NOT NULL, company_id uuid NOT NULL, version_id uuid NOT NULL,
 competence text NOT NULL CHECK(competence ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'), period_mode text NOT NULL CHECK(period_mode IN ('MONTH','YEAR_TO_DATE')),
 format text NOT NULL CHECK(format IN ('PDF','CSV')), idempotency_key text NOT NULL CHECK(length(btrim(idempotency_key)) BETWEEN 8 AND 128),
 request_hash char(64) NOT NULL CHECK(request_hash ~ '^[0-9a-f]{64}$'), report_hash char(64) NOT NULL CHECK(report_hash ~ '^[0-9a-f]{64}$'),
 canonical_result jsonb NOT NULL,
 actor_id uuid NOT NULL, correlation_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(company_id,tenant_id) REFERENCES app.empresa(id,tenant_id),
 FOREIGN KEY(version_id,tenant_id,company_id) REFERENCES app.accounting_statement_version(id,tenant_id,company_id),
 FOREIGN KEY(actor_id,tenant_id) REFERENCES app.usuario(id,tenant_id),
 UNIQUE(tenant_id,company_id,version_id,competence,period_mode,format,idempotency_key)
);
CREATE INDEX accounting_statement_export_company_idx ON app.accounting_statement_export(company_id);
CREATE INDEX accounting_statement_export_scope_idx ON app.accounting_statement_export(tenant_id,company_id,created_at,id);

CREATE OR REPLACE FUNCTION app.accounting_statement_scope_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.company_id IS DISTINCT FROM OLD.company_id THEN
  RAISE EXCEPTION 'tenant_id e company_id sao imutaveis' USING ERRCODE='restrict_violation';
 END IF;
 RETURN NEW;
END; $$;
CREATE OR REPLACE FUNCTION app.accounting_statement_version_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR OLD.tenant_id IS DISTINCT FROM NEW.tenant_id OR OLD.company_id IS DISTINCT FROM NEW.company_id OR
    OLD.version IS DISTINCT FROM NEW.version OR OLD.created_by IS DISTINCT FROM NEW.created_by OR OLD.created_at IS DISTINCT FROM NEW.created_at OR OLD.correlation_id IS DISTINCT FROM NEW.correlation_id OR
    NOT ((OLD.status='DRAFT' AND NEW.status='DRAFT' AND NEW.revision=OLD.revision+1 AND NEW.effective_from IS NULL AND NEW.effective_to IS NULL) OR
         (OLD.status='DRAFT' AND NEW.status='ACTIVE' AND NEW.revision=OLD.revision+1 AND NEW.effective_from IS NOT NULL AND NEW.effective_to IS NULL) OR
         (OLD.status='ACTIVE' AND NEW.status='SUPERSEDED' AND NEW.revision=OLD.revision AND NEW.effective_from=OLD.effective_from AND NEW.published_by=OLD.published_by AND NEW.published_at=OLD.published_at AND NEW.effective_to IS NOT NULL AND NEW.effective_to>=NEW.effective_from)) OR
    (OLD.status=NEW.status AND OLD.status='DRAFT' AND (NEW.published_by IS DISTINCT FROM OLD.published_by OR NEW.published_at IS DISTINCT FROM OLD.published_at)) OR
    (OLD.status='DRAFT' AND NEW.status='ACTIVE' AND (NEW.published_by IS NULL OR NEW.published_at IS NULL)) OR
    (OLD.status='ACTIVE' AND NEW.status='SUPERSEDED' AND NEW.published_by IS DISTINCT FROM OLD.published_by) THEN
   RAISE EXCEPTION 'STATEMENT_VERSION_IMMUTABLE' USING ERRCODE='restrict_violation';
 END IF;
 IF NEW.status IN ('ACTIVE','SUPERSEDED') AND NOT (OLD.status='ACTIVE' AND NEW.status='SUPERSEDED') AND EXISTS (
   SELECT 1 FROM app.accounting_statement_version v WHERE v.tenant_id=NEW.tenant_id AND v.company_id=NEW.company_id AND v.id<>NEW.id
     AND v.status IN ('ACTIVE','SUPERSEDED') AND NEW.effective_from<=coalesce(v.effective_to,'9999-12')
     AND v.effective_to>=NEW.effective_from
 ) THEN RAISE EXCEPTION 'STATEMENT_PERIOD_OVERLAP' USING ERRCODE='check_violation'; END IF;
 RETURN NEW;
END; $$;
CREATE OR REPLACE FUNCTION app.accounting_statement_draft_child() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_version_id uuid; v_tenant_id uuid; v_company_id uuid; v_status text;
BEGIN
 v_version_id:=CASE WHEN TG_OP='DELETE' THEN OLD.version_id ELSE NEW.version_id END;
 v_tenant_id:=CASE WHEN TG_OP='DELETE' THEN OLD.tenant_id ELSE NEW.tenant_id END;
 v_company_id:=CASE WHEN TG_OP='DELETE' THEN OLD.company_id ELSE NEW.company_id END;
 SELECT v.status INTO v_status FROM app.accounting_statement_version v WHERE v.id=v_version_id AND v.tenant_id=v_tenant_id AND v.company_id=v_company_id;
 IF v_status IS NULL THEN IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF; END IF;
 IF v_status<>'DRAFT' THEN RAISE EXCEPTION 'STATEMENT_PUBLISHED_IMMUTABLE' USING ERRCODE='restrict_violation'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END; $$;
CREATE OR REPLACE FUNCTION app.accounting_statement_mapping_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE account_type text; account_class text; version_status text;
BEGIN
 IF TG_OP='DELETE' THEN
   SELECT v.status INTO version_status FROM app.accounting_statement_version v WHERE v.id=OLD.version_id AND v.tenant_id=OLD.tenant_id AND v.company_id=OLD.company_id;
   IF version_status IS DISTINCT FROM 'DRAFT' THEN RAISE EXCEPTION 'STATEMENT_PUBLISHED_IMMUTABLE' USING ERRCODE='restrict_violation'; END IF;
   RETURN OLD;
 END IF;
 SELECT v.status INTO version_status FROM app.accounting_statement_version v WHERE v.id=NEW.version_id AND v.tenant_id=NEW.tenant_id AND v.company_id=NEW.company_id;
 IF version_status IS NULL THEN RETURN NEW; END IF;
 IF version_status<>'DRAFT' THEN RAISE EXCEPTION 'STATEMENT_PUBLISHED_IMMUTABLE' USING ERRCODE='restrict_violation'; END IF;
 IF TG_OP<>'DELETE' AND NEW.active THEN
   SELECT tipo,classe_contabil INTO account_type,account_class FROM app.conta_contabil WHERE id=NEW.account_id AND tenant_id=NEW.tenant_id AND empresa_id=NEW.company_id;
   IF account_type IS DISTINCT FROM 'analitica' OR account_class NOT IN ('REVENUE','EXPENSE') OR account_class IS DISTINCT FROM NEW.account_class THEN
     RAISE EXCEPTION 'STATEMENT_ACCOUNT_NOT_ELIGIBLE' USING ERRCODE='check_violation';
   END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END; $$;
CREATE OR REPLACE FUNCTION app.accounting_statement_no_change() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'ACCOUNTING_STATEMENT_APPEND_ONLY' USING ERRCODE='restrict_violation'; END; $$;
CREATE OR REPLACE FUNCTION app.accounting_statement_no_truncate() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'ACCOUNTING_STATEMENT_APPEND_ONLY' USING ERRCODE='restrict_violation'; END; $$;

CREATE TRIGGER accounting_statement_version_transition BEFORE UPDATE OR DELETE ON app.accounting_statement_version FOR EACH ROW EXECUTE FUNCTION app.accounting_statement_version_transition();
CREATE TRIGGER accounting_statement_line_draft BEFORE INSERT OR UPDATE ON app.accounting_statement_line FOR EACH ROW EXECUTE FUNCTION app.accounting_statement_draft_child();
CREATE TRIGGER accounting_statement_mapping_draft BEFORE INSERT OR UPDATE ON app.accounting_statement_mapping FOR EACH ROW EXECUTE FUNCTION app.accounting_statement_mapping_guard();
CREATE TRIGGER accounting_statement_component_draft BEFORE INSERT OR UPDATE ON app.accounting_statement_component FOR EACH ROW EXECUTE FUNCTION app.accounting_statement_draft_child();
CREATE TRIGGER accounting_statement_event_immutable BEFORE UPDATE OR DELETE ON app.accounting_statement_event FOR EACH ROW EXECUTE FUNCTION app.accounting_statement_no_change();
CREATE TRIGGER accounting_statement_export_immutable BEFORE UPDATE OR DELETE ON app.accounting_statement_export FOR EACH ROW EXECUTE FUNCTION app.accounting_statement_no_change();

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['accounting_statement_version','accounting_statement_line','accounting_statement_mapping','accounting_statement_component','accounting_statement_event','accounting_statement_export'] LOOP
  EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t); EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY %I ON app.%I FOR SELECT USING (tenant_id=app.tenant_atual() AND app.empresa_autorizada(company_id))',t||'_select',t);
  EXECUTE format('CREATE POLICY %I ON app.%I FOR INSERT WITH CHECK (tenant_id=app.tenant_atual() AND app.empresa_autorizada(company_id))',t||'_insert',t);
  IF t IN ('accounting_statement_version','accounting_statement_line','accounting_statement_mapping','accounting_statement_component') THEN
   EXECUTE format('CREATE POLICY %I ON app.%I FOR UPDATE USING (tenant_id=app.tenant_atual() AND app.empresa_autorizada(company_id)) WITH CHECK (tenant_id=app.tenant_atual() AND app.empresa_autorizada(company_id))',t||'_update',t);
  END IF;
  EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.accounting_statement_scope_immutable()',t||'_scope',t);
 END LOOP;
END $$;
CREATE TRIGGER accounting_statement_event_no_truncate BEFORE TRUNCATE ON app.accounting_statement_event FOR EACH STATEMENT EXECUTE FUNCTION app.accounting_statement_no_truncate();
CREATE TRIGGER accounting_statement_export_no_truncate BEFORE TRUNCATE ON app.accounting_statement_export FOR EACH STATEMENT EXECUTE FUNCTION app.accounting_statement_no_truncate();
REVOKE ALL ON app.accounting_period_close_snapshot_line,app.accounting_statement_version,app.accounting_statement_line,app.accounting_statement_mapping,app.accounting_statement_component,app.accounting_statement_event,app.accounting_statement_export FROM PUBLIC,contaia_app;
GRANT SELECT,INSERT ON app.accounting_period_close_snapshot_line TO contaia_app;
GRANT SELECT,INSERT,UPDATE ON app.accounting_statement_version,app.accounting_statement_line,app.accounting_statement_mapping,app.accounting_statement_component TO contaia_app;
GRANT SELECT,INSERT ON app.accounting_statement_event,app.accounting_statement_export TO contaia_app;
REVOKE DELETE,TRUNCATE ON app.accounting_period_close_snapshot_line,app.accounting_statement_version,app.accounting_statement_line,app.accounting_statement_mapping,app.accounting_statement_component,app.accounting_statement_event,app.accounting_statement_export FROM PUBLIC,contaia_app;
