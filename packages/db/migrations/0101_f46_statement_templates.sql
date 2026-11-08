-- SPEC-046/F46: biblioteca tenant-wide de modelos, estrutura imutável e aplicações rastreáveis.
CREATE TABLE app.accounting_statement_template (
 id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
 tenant_id uuid NOT NULL REFERENCES app.tenant(id),
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 120),
 description text CHECK(description IS NULL OR length(description)<=500),
 status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','ARCHIVED')),
 created_by uuid NOT NULL,
 updated_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,tenant_id),
 FOREIGN KEY(created_by,tenant_id) REFERENCES app.usuario(id,tenant_id),
 FOREIGN KEY(updated_by,tenant_id) REFERENCES app.usuario(id,tenant_id)
);
CREATE INDEX accounting_statement_template_tenant_idx ON app.accounting_statement_template(tenant_id,status,updated_at DESC);

CREATE TABLE app.accounting_statement_template_version (
 id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
 tenant_id uuid NOT NULL,
 template_id uuid NOT NULL,
 version integer NOT NULL CHECK(version>0),
 status text NOT NULL CHECK(status IN ('DRAFT','ACTIVE','SUPERSEDED')),
 revision integer NOT NULL DEFAULT 0 CHECK(revision>=0),
 origin text NOT NULL CHECK(origin IN ('MANUAL','COMPANY_VERSION')),
 structural_hash char(64) CHECK(structural_hash IS NULL OR structural_hash ~ '^[0-9a-f]{64}$'),
 created_by uuid NOT NULL,
 published_by uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 published_at timestamptz,
 correlation_id text NOT NULL,
 UNIQUE(id,tenant_id,template_id),
 UNIQUE(tenant_id,template_id,version),
 FOREIGN KEY(template_id,tenant_id) REFERENCES app.accounting_statement_template(id,tenant_id),
 FOREIGN KEY(created_by,tenant_id) REFERENCES app.usuario(id,tenant_id),
 FOREIGN KEY(published_by,tenant_id) REFERENCES app.usuario(id,tenant_id),
 CHECK((status='DRAFT' AND published_by IS NULL AND published_at IS NULL AND structural_hash IS NULL)
    OR (status IN ('ACTIVE','SUPERSEDED') AND published_by IS NOT NULL AND published_at IS NOT NULL AND structural_hash IS NOT NULL))
);
CREATE UNIQUE INDEX accounting_statement_template_one_active_idx ON app.accounting_statement_template_version(tenant_id,template_id) WHERE status='ACTIVE';
CREATE INDEX accounting_statement_template_version_history_idx ON app.accounting_statement_template_version(tenant_id,template_id,version DESC);

CREATE TABLE app.accounting_statement_template_line (
 tenant_id uuid NOT NULL,
 template_id uuid NOT NULL,
 version_id uuid NOT NULL,
 line_code text NOT NULL CHECK(length(btrim(line_code)) BETWEEN 1 AND 40),
 title text NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 160),
 line_type text NOT NULL CHECK(line_type IN ('DETAIL','SUBTOTAL')),
 display_order integer NOT NULL CHECK(display_order>0),
 level integer NOT NULL CHECK(level BETWEEN 0 AND 8),
 parent_code text,
 presentation_sign smallint NOT NULL CHECK(presentation_sign IN (-1,1)),
 vertical_basis boolean NOT NULL DEFAULT false,
 PRIMARY KEY(tenant_id,template_id,version_id,line_code),
 UNIQUE(version_id,line_code),
 UNIQUE(version_id,display_order),
 FOREIGN KEY(version_id,tenant_id,template_id) REFERENCES app.accounting_statement_template_version(id,tenant_id,template_id),
 FOREIGN KEY(tenant_id,template_id,version_id,parent_code) REFERENCES app.accounting_statement_template_line(tenant_id,template_id,version_id,line_code) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX accounting_statement_template_line_order_idx ON app.accounting_statement_template_line(tenant_id,template_id,version_id,display_order);

CREATE TABLE app.accounting_statement_template_component (
 tenant_id uuid NOT NULL,
 template_id uuid NOT NULL,
 version_id uuid NOT NULL,
 line_code text NOT NULL,
 component_code text NOT NULL,
 operator text NOT NULL CHECK(operator IN ('ADD','SUBTRACT')),
 PRIMARY KEY(tenant_id,template_id,version_id,line_code,component_code),
 FOREIGN KEY(tenant_id,template_id,version_id,line_code) REFERENCES app.accounting_statement_template_line(tenant_id,template_id,version_id,line_code),
 FOREIGN KEY(tenant_id,template_id,version_id,component_code) REFERENCES app.accounting_statement_template_line(tenant_id,template_id,version_id,line_code)
);

CREATE TABLE app.accounting_statement_template_event (
 id uuid PRIMARY KEY DEFAULT app.uuid_v7(), tenant_id uuid NOT NULL, template_id uuid NOT NULL,
 version_id uuid, actor_id uuid NOT NULL,
 action text NOT NULL CHECK(action IN ('CREATED','RENAMED','DRAFT_CREATED','DRAFT_UPDATED','PUBLISHED','SUPERSEDED','ARCHIVED','REACTIVATED','APPLIED')),
 result text NOT NULL CHECK(result IN ('SUCESSO','RECUSADO','FALHA')),
 details jsonb NOT NULL DEFAULT '{}'::jsonb,
 correlation_id text NOT NULL,
 occurred_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(template_id,tenant_id) REFERENCES app.accounting_statement_template(id,tenant_id),
 FOREIGN KEY(version_id,tenant_id,template_id) REFERENCES app.accounting_statement_template_version(id,tenant_id,template_id),
 FOREIGN KEY(actor_id,tenant_id) REFERENCES app.usuario(id,tenant_id)
);
CREATE INDEX accounting_statement_template_event_idx ON app.accounting_statement_template_event(tenant_id,template_id,occurred_at DESC);

-- Origem sanitizada: somente quem ainda tem acesso à empresa de origem pode ler a proveniência.
CREATE TABLE app.accounting_statement_template_source (
 id uuid PRIMARY KEY DEFAULT app.uuid_v7(), tenant_id uuid NOT NULL, template_id uuid NOT NULL,
 template_version_id uuid NOT NULL, company_id uuid NOT NULL, source_statement_version_id uuid NOT NULL,
 actor_id uuid NOT NULL, correlation_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(template_version_id),
 FOREIGN KEY(template_version_id,tenant_id,template_id) REFERENCES app.accounting_statement_template_version(id,tenant_id,template_id),
 FOREIGN KEY(company_id,tenant_id) REFERENCES app.empresa(id,tenant_id),
 FOREIGN KEY(source_statement_version_id,tenant_id,company_id) REFERENCES app.accounting_statement_version(id,tenant_id,company_id),
 FOREIGN KEY(actor_id,tenant_id) REFERENCES app.usuario(id,tenant_id)
);
CREATE INDEX accounting_statement_template_source_scope_idx ON app.accounting_statement_template_source(tenant_id,company_id,template_id);

CREATE TABLE app.accounting_statement_template_application (
 id uuid PRIMARY KEY DEFAULT app.uuid_v7(), tenant_id uuid NOT NULL, template_id uuid NOT NULL,
 template_version_id uuid NOT NULL, company_id uuid NOT NULL, statement_version_id uuid NOT NULL,
 idempotency_key text NOT NULL CHECK(length(btrim(idempotency_key)) BETWEEN 8 AND 128),
 request_hash char(64) NOT NULL CHECK(request_hash ~ '^[0-9a-f]{64}$'),
 actor_id uuid NOT NULL, correlation_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,idempotency_key), UNIQUE(statement_version_id),
 FOREIGN KEY(template_version_id,tenant_id,template_id) REFERENCES app.accounting_statement_template_version(id,tenant_id,template_id),
 FOREIGN KEY(company_id,tenant_id) REFERENCES app.empresa(id,tenant_id),
 FOREIGN KEY(statement_version_id,tenant_id,company_id) REFERENCES app.accounting_statement_version(id,tenant_id,company_id),
 FOREIGN KEY(actor_id,tenant_id) REFERENCES app.usuario(id,tenant_id)
);
CREATE INDEX accounting_statement_template_application_company_idx ON app.accounting_statement_template_application(tenant_id,company_id,created_at DESC);

CREATE OR REPLACE FUNCTION app.accounting_statement_template_no_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'ACCOUNTING_STATEMENT_TEMPLATE_APPEND_ONLY' USING ERRCODE='restrict_violation'; END; $$;
CREATE OR REPLACE FUNCTION app.accounting_statement_template_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'STATEMENT_TEMPLATE_VERSION_IMMUTABLE' USING ERRCODE='restrict_violation'; END IF;
 IF OLD.status='DRAFT' AND NEW.status='DRAFT' AND NEW.revision=OLD.revision+1 AND NEW.version=OLD.version AND NEW.origin=OLD.origin AND NEW.created_by=OLD.created_by AND NEW.published_by IS NULL AND NEW.published_at IS NULL AND NEW.structural_hash IS NULL THEN RETURN NEW; END IF;
 IF OLD.status='DRAFT' AND NEW.status='ACTIVE' AND NEW.revision=OLD.revision+1 AND NEW.version=OLD.version AND NEW.origin=OLD.origin AND NEW.created_by=OLD.created_by AND NEW.published_by IS NOT NULL AND NEW.published_at IS NOT NULL AND NEW.structural_hash IS NOT NULL THEN RETURN NEW; END IF;
 IF OLD.status='ACTIVE' AND NEW.status='SUPERSEDED' AND NEW.revision=OLD.revision AND NEW.version=OLD.version AND NEW.origin=OLD.origin AND NEW.created_by=OLD.created_by AND NEW.published_by=OLD.published_by AND NEW.published_at=OLD.published_at AND NEW.structural_hash=OLD.structural_hash THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'STATEMENT_TEMPLATE_VERSION_IMMUTABLE' USING ERRCODE='restrict_violation';
END; $$;
CREATE OR REPLACE FUNCTION app.accounting_statement_template_child_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_id uuid; v_tenant uuid; v_template uuid; v_status text;
BEGIN
 v_id:=CASE WHEN TG_OP='DELETE' THEN OLD.version_id ELSE NEW.version_id END;
 v_tenant:=CASE WHEN TG_OP='DELETE' THEN OLD.tenant_id ELSE NEW.tenant_id END;
 v_template:=CASE WHEN TG_OP='DELETE' THEN OLD.template_id ELSE NEW.template_id END;
 SELECT status INTO v_status FROM app.accounting_statement_template_version WHERE id=v_id AND tenant_id=v_tenant AND template_id=v_template;
 IF v_status IS DISTINCT FROM 'DRAFT' THEN RAISE EXCEPTION 'STATEMENT_TEMPLATE_PUBLISHED_IMMUTABLE' USING ERRCODE='restrict_violation'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END; $$;
CREATE TRIGGER accounting_statement_template_version_transition BEFORE UPDATE OR DELETE ON app.accounting_statement_template_version FOR EACH ROW EXECUTE FUNCTION app.accounting_statement_template_version_guard();
CREATE TRIGGER accounting_statement_template_line_draft BEFORE INSERT OR UPDATE OR DELETE ON app.accounting_statement_template_line FOR EACH ROW EXECUTE FUNCTION app.accounting_statement_template_child_guard();
CREATE TRIGGER accounting_statement_template_component_draft BEFORE INSERT OR UPDATE OR DELETE ON app.accounting_statement_template_component FOR EACH ROW EXECUTE FUNCTION app.accounting_statement_template_child_guard();
CREATE TRIGGER accounting_statement_template_event_immutable BEFORE UPDATE OR DELETE ON app.accounting_statement_template_event FOR EACH ROW EXECUTE FUNCTION app.accounting_statement_template_no_change();
CREATE TRIGGER accounting_statement_template_source_immutable BEFORE UPDATE OR DELETE ON app.accounting_statement_template_source FOR EACH ROW EXECUTE FUNCTION app.accounting_statement_template_no_change();
CREATE TRIGGER accounting_statement_template_application_immutable BEFORE UPDATE OR DELETE ON app.accounting_statement_template_application FOR EACH ROW EXECUTE FUNCTION app.accounting_statement_template_no_change();

ALTER TABLE app.accounting_statement_template ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.accounting_statement_template FORCE ROW LEVEL SECURITY;
CREATE POLICY accounting_statement_template_select ON app.accounting_statement_template FOR SELECT USING (tenant_id=app.tenant_atual());
CREATE POLICY accounting_statement_template_insert ON app.accounting_statement_template FOR INSERT WITH CHECK (tenant_id=app.tenant_atual());
CREATE POLICY accounting_statement_template_update ON app.accounting_statement_template FOR UPDATE USING (tenant_id=app.tenant_atual()) WITH CHECK (tenant_id=app.tenant_atual());
ALTER TABLE app.accounting_statement_template_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.accounting_statement_template_version FORCE ROW LEVEL SECURITY;
CREATE POLICY accounting_statement_template_version_select ON app.accounting_statement_template_version FOR SELECT USING (tenant_id=app.tenant_atual());
CREATE POLICY accounting_statement_template_version_insert ON app.accounting_statement_template_version FOR INSERT WITH CHECK (tenant_id=app.tenant_atual());
CREATE POLICY accounting_statement_template_version_update ON app.accounting_statement_template_version FOR UPDATE USING (tenant_id=app.tenant_atual()) WITH CHECK (tenant_id=app.tenant_atual());
ALTER TABLE app.accounting_statement_template_line ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.accounting_statement_template_line FORCE ROW LEVEL SECURITY;
CREATE POLICY accounting_statement_template_line_select ON app.accounting_statement_template_line FOR SELECT USING (tenant_id=app.tenant_atual());
CREATE POLICY accounting_statement_template_line_insert ON app.accounting_statement_template_line FOR INSERT WITH CHECK (tenant_id=app.tenant_atual());
CREATE POLICY accounting_statement_template_line_update ON app.accounting_statement_template_line FOR UPDATE USING (tenant_id=app.tenant_atual()) WITH CHECK (tenant_id=app.tenant_atual());
ALTER TABLE app.accounting_statement_template_component ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.accounting_statement_template_component FORCE ROW LEVEL SECURITY;
CREATE POLICY accounting_statement_template_component_select ON app.accounting_statement_template_component FOR SELECT USING (tenant_id=app.tenant_atual());
CREATE POLICY accounting_statement_template_component_insert ON app.accounting_statement_template_component FOR INSERT WITH CHECK (tenant_id=app.tenant_atual());
CREATE POLICY accounting_statement_template_component_update ON app.accounting_statement_template_component FOR UPDATE USING (tenant_id=app.tenant_atual()) WITH CHECK (tenant_id=app.tenant_atual());
ALTER TABLE app.accounting_statement_template_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.accounting_statement_template_event FORCE ROW LEVEL SECURITY;
CREATE POLICY accounting_statement_template_event_select ON app.accounting_statement_template_event FOR SELECT USING (tenant_id=app.tenant_atual());
CREATE POLICY accounting_statement_template_event_insert ON app.accounting_statement_template_event FOR INSERT WITH CHECK (tenant_id=app.tenant_atual());
ALTER TABLE app.accounting_statement_template_source ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.accounting_statement_template_source FORCE ROW LEVEL SECURITY;
CREATE POLICY accounting_statement_template_source_select ON app.accounting_statement_template_source FOR SELECT USING (tenant_id=app.tenant_atual() AND app.empresa_autorizada(company_id));
CREATE POLICY accounting_statement_template_source_insert ON app.accounting_statement_template_source FOR INSERT WITH CHECK (tenant_id=app.tenant_atual() AND app.empresa_autorizada(company_id));
ALTER TABLE app.accounting_statement_template_application ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.accounting_statement_template_application FORCE ROW LEVEL SECURITY;
CREATE POLICY accounting_statement_template_application_select ON app.accounting_statement_template_application FOR SELECT USING (tenant_id=app.tenant_atual() AND app.empresa_autorizada(company_id));
CREATE POLICY accounting_statement_template_application_insert ON app.accounting_statement_template_application FOR INSERT WITH CHECK (tenant_id=app.tenant_atual() AND app.empresa_autorizada(company_id));

REVOKE ALL ON app.accounting_statement_template,app.accounting_statement_template_version,app.accounting_statement_template_line,app.accounting_statement_template_component,app.accounting_statement_template_event,app.accounting_statement_template_source,app.accounting_statement_template_application FROM PUBLIC,contaia_app;
GRANT SELECT,INSERT,UPDATE ON app.accounting_statement_template,app.accounting_statement_template_version,app.accounting_statement_template_line,app.accounting_statement_template_component TO contaia_app;
GRANT SELECT,INSERT ON app.accounting_statement_template_event,app.accounting_statement_template_source,app.accounting_statement_template_application TO contaia_app;
REVOKE DELETE,TRUNCATE ON app.accounting_statement_template,app.accounting_statement_template_version,app.accounting_statement_template_line,app.accounting_statement_template_component,app.accounting_statement_template_event,app.accounting_statement_template_source,app.accounting_statement_template_application FROM PUBLIC,contaia_app;
