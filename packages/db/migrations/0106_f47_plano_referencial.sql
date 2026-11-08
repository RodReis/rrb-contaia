-- SPEC-047/F47. Catálogo oficial inicia vazio quando a fonte aprovada não está disponível.
CREATE TABLE app.reference_accounting_package (
 id text PRIMARY KEY CHECK(length(btrim(id)) BETWEEN 1 AND 120),
 authority text NOT NULL, source_document text NOT NULL, source_url text NOT NULL CHECK(source_url LIKE 'https://%'),
 layout text NOT NULL, revision text NOT NULL, covered_calendar_years integer[] NOT NULL DEFAULT '{}',
 covered_special_situations jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(covered_special_situations)='array'),
 downloaded_at timestamptz NOT NULL, source_sha256 char(64) NOT NULL CHECK(source_sha256 ~ '^[0-9a-f]{64}$'),
 canonical_sha256 char(64) NOT NULL CHECK(canonical_sha256 ~ '^[0-9a-f]{64}$'),
 status text NOT NULL CHECK(status IN ('AVAILABLE','SUPERSEDED','REVOKED')),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(cardinality(covered_calendar_years)>0 OR jsonb_array_length(covered_special_situations)>0)
);
CREATE TABLE app.reference_accounting_account (
 package_id text NOT NULL REFERENCES app.reference_accounting_package(id), code text NOT NULL,
 description text NOT NULL, source_nature text NOT NULL, normal_balance text CHECK(normal_balance IN ('DEBIT','CREDIT')),
 parent_code text, valid_from date, valid_to date, status text NOT NULL CHECK(status IN ('ACTIVE','ARCHIVED')),
 PRIMARY KEY(package_id,code),
 FOREIGN KEY(package_id,parent_code) REFERENCES app.reference_accounting_account(package_id,code) DEFERRABLE INITIALLY DEFERRED,
 CHECK(valid_to IS NULL OR valid_from IS NULL OR valid_to>=valid_from)
);
REVOKE ALL ON app.reference_accounting_package,app.reference_accounting_account FROM PUBLIC,contaia_app;
GRANT SELECT ON app.reference_accounting_package,app.reference_accounting_account TO contaia_app;

ALTER TABLE app.conta_contabil ADD CONSTRAINT conta_contabil_id_scope_unique UNIQUE(id,tenant_id,empresa_id);
ALTER TABLE app.centro_custo ADD CONSTRAINT centro_custo_id_scope_unique UNIQUE(id,tenant_id,empresa_id);

CREATE TABLE app.company_reference_mapping (
 id uuid PRIMARY KEY DEFAULT app.uuid_v7(), tenant_id uuid NOT NULL, company_id uuid NOT NULL,
 calendar_year integer NOT NULL CHECK(calendar_year BETWEEN 1900 AND 2200),
 tax_regime text NOT NULL CHECK(tax_regime IN ('LUCRO_PRESUMIDO','SIMPLES_NACIONAL')), special_situation text,
 package_id text NOT NULL REFERENCES app.reference_accounting_package(id), applicability text NOT NULL CHECK(applicability IN ('APPLICABLE','OPTIONAL')),
 status text NOT NULL CHECK(status IN ('DRAFT','PUBLISHED','SUPERSEDED')), version integer CHECK(version IS NULL OR version>0),
 revision integer NOT NULL DEFAULT 0 CHECK(revision>=0), canonical_sha256 char(64) CHECK(canonical_sha256 IS NULL OR canonical_sha256 ~ '^[0-9a-f]{64}$'),
 package_sha256 char(64) NOT NULL CHECK(package_sha256 ~ '^[0-9a-f]{64}$'), created_by uuid NOT NULL, published_by uuid,
 created_at timestamptz NOT NULL DEFAULT now(), published_at timestamptz, correlation_id text NOT NULL,
 UNIQUE(id,tenant_id,company_id), UNIQUE(tenant_id,company_id,calendar_year,version),
 FOREIGN KEY(company_id,tenant_id) REFERENCES app.empresa(id,tenant_id),
 FOREIGN KEY(created_by,tenant_id) REFERENCES app.usuario(id,tenant_id), FOREIGN KEY(published_by,tenant_id) REFERENCES app.usuario(id,tenant_id),
 CHECK((status='DRAFT' AND version IS NULL AND published_by IS NULL AND published_at IS NULL AND canonical_sha256 IS NULL)
 OR (status IN ('PUBLISHED','SUPERSEDED') AND version IS NOT NULL AND published_by IS NOT NULL AND published_at IS NOT NULL AND canonical_sha256 IS NOT NULL))
);
CREATE UNIQUE INDEX company_reference_mapping_one_published_idx ON app.company_reference_mapping(tenant_id,company_id,calendar_year) WHERE status='PUBLISHED';
CREATE INDEX company_reference_mapping_history_idx ON app.company_reference_mapping(tenant_id,company_id,calendar_year,version DESC);

CREATE TABLE app.company_reference_mapping_entry (
 id uuid PRIMARY KEY DEFAULT app.uuid_v7(), tenant_id uuid NOT NULL, company_id uuid NOT NULL, mapping_id uuid NOT NULL,
 account_id uuid NOT NULL, center_id uuid, kind text NOT NULL CHECK(kind IN ('MAPPED','NOT_APPLICABLE')),
 reference_package_id text, reference_code text, reason text, author_id uuid NOT NULL, reviewed_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(mapping_id,tenant_id,company_id) REFERENCES app.company_reference_mapping(id,tenant_id,company_id),
 FOREIGN KEY(account_id,tenant_id,company_id) REFERENCES app.conta_contabil(id,tenant_id,empresa_id),
 FOREIGN KEY(center_id,tenant_id,company_id) REFERENCES app.centro_custo(id,tenant_id,empresa_id),
 FOREIGN KEY(reference_package_id,reference_code) REFERENCES app.reference_accounting_account(package_id,code),
 FOREIGN KEY(author_id,tenant_id) REFERENCES app.usuario(id,tenant_id), FOREIGN KEY(reviewed_by,tenant_id) REFERENCES app.usuario(id,tenant_id),
 CHECK((kind='MAPPED' AND reference_package_id IS NOT NULL AND reference_code IS NOT NULL AND reason IS NULL AND reviewed_by IS NULL)
 OR (kind='NOT_APPLICABLE' AND reference_package_id IS NULL AND reference_code IS NULL AND length(btrim(reason))>0 AND reviewed_by IS NOT NULL))
);
CREATE UNIQUE INDEX company_reference_mapping_entry_pair_idx ON app.company_reference_mapping_entry(tenant_id,mapping_id,account_id,coalesce(center_id,'00000000-0000-0000-0000-000000000000'::uuid));
CREATE TABLE app.company_reference_mapping_center_snapshot (
 tenant_id uuid NOT NULL, company_id uuid NOT NULL, mapping_id uuid NOT NULL, center_id uuid NOT NULL, center_code text NOT NULL,
 PRIMARY KEY(tenant_id,mapping_id,center_id),
 FOREIGN KEY(mapping_id,tenant_id,company_id) REFERENCES app.company_reference_mapping(id,tenant_id,company_id),
 FOREIGN KEY(center_id,tenant_id,company_id) REFERENCES app.centro_custo(id,tenant_id,empresa_id)
);
CREATE TABLE app.company_reference_mapping_import (
 id uuid PRIMARY KEY DEFAULT app.uuid_v7(), tenant_id uuid NOT NULL, company_id uuid NOT NULL, mapping_id uuid NOT NULL,
 file_sha256 char(64) NOT NULL CHECK(file_sha256 ~ '^[0-9a-f]{64}$'), expected_revision integer NOT NULL CHECK(expected_revision>=0),
 status text NOT NULL CHECK(status IN ('PREVIEW','APPLIED','REJECTED')), summary jsonb NOT NULL, actor_id uuid NOT NULL,
 correlation_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(mapping_id,tenant_id,company_id) REFERENCES app.company_reference_mapping(id,tenant_id,company_id),
 FOREIGN KEY(actor_id,tenant_id) REFERENCES app.usuario(id,tenant_id)
);
CREATE TABLE app.company_reference_mapping_event (
 id uuid PRIMARY KEY DEFAULT app.uuid_v7(), tenant_id uuid NOT NULL, company_id uuid NOT NULL, mapping_id uuid NOT NULL,
 actor_id uuid NOT NULL, action text NOT NULL, result text NOT NULL CHECK(result IN ('SUCESSO','RECUSADO','FALHA')),
 details jsonb NOT NULL DEFAULT '{}'::jsonb, correlation_id text NOT NULL, occurred_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(mapping_id,tenant_id,company_id) REFERENCES app.company_reference_mapping(id,tenant_id,company_id),
 FOREIGN KEY(actor_id,tenant_id) REFERENCES app.usuario(id,tenant_id)
);
CREATE INDEX company_reference_mapping_event_idx ON app.company_reference_mapping_event(tenant_id,company_id,mapping_id,occurred_at DESC);

CREATE OR REPLACE FUNCTION app.reference_mapping_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'REFERENCE_MAPPING_VERSION_IMMUTABLE' USING ERRCODE='restrict_violation'; END IF;
 IF OLD.status='DRAFT' AND NEW.status='DRAFT' AND NEW.revision=OLD.revision+1 AND NEW.version IS NULL AND NEW.published_by IS NULL AND NEW.published_at IS NULL AND NEW.canonical_sha256 IS NULL THEN RETURN NEW; END IF;
 IF OLD.status='DRAFT' AND NEW.status='PUBLISHED' AND NEW.revision=OLD.revision+1 AND NEW.version IS NOT NULL AND NEW.published_by IS NOT NULL AND NEW.published_at IS NOT NULL AND NEW.canonical_sha256 IS NOT NULL THEN RETURN NEW; END IF;
 IF OLD.status='PUBLISHED' AND NEW.status='SUPERSEDED' AND NEW.revision=OLD.revision AND NEW.version=OLD.version AND NEW.published_by=OLD.published_by AND NEW.published_at=OLD.published_at AND NEW.canonical_sha256=OLD.canonical_sha256 THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'REFERENCE_MAPPING_VERSION_IMMUTABLE' USING ERRCODE='restrict_violation';
END; $$;
CREATE OR REPLACE FUNCTION app.reference_mapping_child_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_id uuid; v_tenant uuid; v_company uuid; v_status text;
BEGIN
 v_id:=CASE WHEN TG_OP='DELETE' THEN OLD.mapping_id ELSE NEW.mapping_id END;
 v_tenant:=CASE WHEN TG_OP='DELETE' THEN OLD.tenant_id ELSE NEW.tenant_id END;
 v_company:=CASE WHEN TG_OP='DELETE' THEN OLD.company_id ELSE NEW.company_id END;
 SELECT status INTO v_status FROM app.company_reference_mapping WHERE id=v_id AND tenant_id=v_tenant AND company_id=v_company;
 IF v_status IS DISTINCT FROM 'DRAFT' THEN RAISE EXCEPTION 'REFERENCE_MAPPING_PUBLISHED_IMMUTABLE' USING ERRCODE='restrict_violation'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END; $$;
CREATE OR REPLACE FUNCTION app.reference_mapping_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'REFERENCE_MAPPING_APPEND_ONLY' USING ERRCODE='restrict_violation'; END; $$;
CREATE TRIGGER company_reference_mapping_version_guard BEFORE UPDATE OR DELETE ON app.company_reference_mapping FOR EACH ROW EXECUTE FUNCTION app.reference_mapping_version_guard();
CREATE TRIGGER company_reference_mapping_entry_guard BEFORE INSERT OR UPDATE OR DELETE ON app.company_reference_mapping_entry FOR EACH ROW EXECUTE FUNCTION app.reference_mapping_child_guard();
CREATE TRIGGER company_reference_mapping_center_guard BEFORE INSERT OR UPDATE OR DELETE ON app.company_reference_mapping_center_snapshot FOR EACH ROW EXECUTE FUNCTION app.reference_mapping_child_guard();
CREATE TRIGGER company_reference_mapping_event_append_only BEFORE UPDATE OR DELETE ON app.company_reference_mapping_event FOR EACH ROW EXECUTE FUNCTION app.reference_mapping_append_only();

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['company_reference_mapping','company_reference_mapping_entry','company_reference_mapping_center_snapshot','company_reference_mapping_import','company_reference_mapping_event'] LOOP
  EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY %I ON app.%I FOR SELECT USING (tenant_id=app.tenant_atual() AND app.empresa_autorizada(company_id))',t||'_select',t);
  EXECUTE format('CREATE POLICY %I ON app.%I FOR INSERT WITH CHECK (tenant_id=app.tenant_atual() AND app.contexto_humano() AND app.empresa_autorizada(company_id))',t||'_insert',t);
  IF t IN ('company_reference_mapping','company_reference_mapping_entry','company_reference_mapping_center_snapshot','company_reference_mapping_import') THEN
   EXECUTE format('CREATE POLICY %I ON app.%I FOR UPDATE USING (tenant_id=app.tenant_atual() AND app.contexto_humano() AND app.empresa_autorizada(company_id)) WITH CHECK (tenant_id=app.tenant_atual() AND app.contexto_humano() AND app.empresa_autorizada(company_id))',t||'_update',t);
  END IF;
 END LOOP;
END $$;
REVOKE ALL ON app.company_reference_mapping,app.company_reference_mapping_entry,app.company_reference_mapping_center_snapshot,app.company_reference_mapping_import,app.company_reference_mapping_event FROM PUBLIC,contaia_app;
GRANT SELECT,INSERT,UPDATE ON app.company_reference_mapping,app.company_reference_mapping_entry,app.company_reference_mapping_center_snapshot,app.company_reference_mapping_import TO contaia_app;
GRANT SELECT,INSERT ON app.company_reference_mapping_event TO contaia_app;
REVOKE DELETE,TRUNCATE ON app.company_reference_mapping,app.company_reference_mapping_entry,app.company_reference_mapping_center_snapshot,app.company_reference_mapping_import,app.company_reference_mapping_event FROM PUBLIC,contaia_app;
