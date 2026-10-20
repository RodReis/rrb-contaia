-- SPEC-026/F26: pacotes normativos globais curados e snapshots por tenant/empresa.
ALTER TABLE app.fiscal_document_item ADD COLUMN ncm text CHECK (ncm IS NULL OR ncm ~ '^\d{8}$');
ALTER TABLE app.fiscal_document_item ADD COLUMN cfop text CHECK (cfop IS NULL OR cfop ~ '^\d{4}$');
ALTER TABLE app.fiscal_document_item ADD COLUMN cst_csosn text CHECK (cst_csosn IS NULL OR cst_csosn ~ '^\d{2,3}$');

CREATE TABLE app.tax_resolution_package (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  package_id text NOT NULL,
  semantic_version text NOT NULL,
  status text NOT NULL CHECK (status IN ('IMPORTED','VALIDATED','REVIEWED','PUBLISHED','ARCHIVED')),
  content jsonb NOT NULL,
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  imported_by uuid NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid,
  reviewed_at timestamptz,
  published_by uuid,
  published_at timestamptz,
  archived_at timestamptz,
  UNIQUE (package_id, semantic_version),
  CHECK ((status IN ('REVIEWED','PUBLISHED','ARCHIVED')) = (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)),
  CHECK ((status IN ('PUBLISHED','ARCHIVED')) = (published_by IS NOT NULL AND published_at IS NOT NULL))
);

CREATE TABLE app.tax_resolution_package_event (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  package_id uuid NOT NULL REFERENCES app.tax_resolution_package(id),
  action text NOT NULL CHECK (action IN ('IMPORTED','VALIDATED','REVIEWED','PUBLISHED','ARCHIVED')),
  actor_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  correlation_id text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE app.tax_entry_resolution_snapshot (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES app.tenant(id),
  empresa_id uuid NOT NULL,
  document_id uuid NOT NULL,
  item_number integer NOT NULL CHECK (item_number > 0),
  parser_version text NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  idempotency_key text NOT NULL,
  input_sha256 text NOT NULL CHECK (input_sha256 ~ '^[0-9a-f]{64}$'),
  package_id uuid REFERENCES app.tax_resolution_package(id),
  package_sha256 text,
  facts jsonb NOT NULL,
  decisions jsonb NOT NULL,
  reprocessing_reason text,
  actor_id uuid NOT NULL,
  correlation_id text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (empresa_id, tenant_id) REFERENCES app.empresa(id, tenant_id),
  FOREIGN KEY (document_id, empresa_id, tenant_id) REFERENCES app.fiscal_document(id, empresa_id, tenant_id),
  FOREIGN KEY (document_id, parser_version, item_number) REFERENCES app.fiscal_document_item(document_id, parser_version, numero),
  UNIQUE (document_id, revision, item_number),
  UNIQUE (tenant_id, empresa_id, document_id, item_number, idempotency_key)
);

CREATE INDEX tax_entry_resolution_snapshot_scope_idx ON app.tax_entry_resolution_snapshot(tenant_id, empresa_id, document_id, item_number, revision DESC);
CREATE INDEX tax_entry_resolution_snapshot_tenant_idx ON app.tax_entry_resolution_snapshot(tenant_id);
CREATE INDEX tax_entry_resolution_snapshot_company_idx ON app.tax_entry_resolution_snapshot(empresa_id);
CREATE INDEX tax_resolution_package_effective_idx ON app.tax_resolution_package(status, package_id);

ALTER TABLE app.tax_resolution_package ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.tax_resolution_package FORCE ROW LEVEL SECURITY;
ALTER TABLE app.tax_resolution_package_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.tax_resolution_package_event FORCE ROW LEVEL SECURITY;
ALTER TABLE app.tax_entry_resolution_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.tax_entry_resolution_snapshot FORCE ROW LEVEL SECURITY;

CREATE POLICY tax_resolution_package_platform ON app.tax_resolution_package
  USING (app.origem_atual() = 'SERVICO' AND app.finalidade_atual() = 'CATALOGO_TRIBUTARIO' AND app.tenant_atual() IS NULL)
  WITH CHECK (app.origem_atual() = 'SERVICO' AND app.finalidade_atual() = 'CATALOGO_TRIBUTARIO' AND app.tenant_atual() IS NULL);
CREATE POLICY tax_resolution_package_event_platform ON app.tax_resolution_package_event
  USING (app.origem_atual() = 'SERVICO' AND app.finalidade_atual() = 'CATALOGO_TRIBUTARIO' AND app.tenant_atual() IS NULL)
  WITH CHECK (app.origem_atual() = 'SERVICO' AND app.finalidade_atual() = 'CATALOGO_TRIBUTARIO' AND app.tenant_atual() IS NULL);
CREATE POLICY tax_entry_resolution_snapshot_scope ON app.tax_entry_resolution_snapshot
  USING (tenant_id = app.tenant_atual() AND app.empresa_autorizada(empresa_id))
  WITH CHECK (tenant_id = app.tenant_atual() AND app.empresa_autorizada(empresa_id));

CREATE TRIGGER escopo_imutavel BEFORE UPDATE ON app.tax_entry_resolution_snapshot
  FOR EACH ROW EXECUTE FUNCTION app.proteger_escopo_empresa();

CREATE FUNCTION app.protect_tax_resolution_package() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'TAX_PACKAGE_IMMUTABLE: pacote não pode ser removido' USING ERRCODE='restrict_violation'; END IF;
  IF OLD.status IN ('PUBLISHED','ARCHIVED') AND (NEW.package_id,NEW.semantic_version,NEW.content,NEW.content_sha256,NEW.imported_by,NEW.imported_at)
    IS DISTINCT FROM (OLD.package_id,OLD.semantic_version,OLD.content,OLD.content_sha256,OLD.imported_by,OLD.imported_at) THEN
    RAISE EXCEPTION 'TAX_PACKAGE_IMMUTABLE: pacote publicado não pode ser alterado' USING ERRCODE='restrict_violation';
  END IF;
  IF OLD.status = 'ARCHIVED' THEN RAISE EXCEPTION 'TAX_PACKAGE_IMMUTABLE: pacote arquivado é terminal' USING ERRCODE='restrict_violation'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER tax_resolution_package_immutable BEFORE UPDATE OR DELETE ON app.tax_resolution_package FOR EACH ROW EXECUTE FUNCTION app.protect_tax_resolution_package();
CREATE TRIGGER tax_resolution_package_event_append_only BEFORE UPDATE OR DELETE ON app.tax_resolution_package_event FOR EACH ROW EXECUTE FUNCTION app.rejeitar_escrita_em_historico();
CREATE TRIGGER tax_entry_resolution_snapshot_append_only BEFORE UPDATE OR DELETE ON app.tax_entry_resolution_snapshot FOR EACH ROW EXECUTE FUNCTION app.rejeitar_escrita_em_historico();
CREATE FUNCTION app.rejeitar_truncate_tax_resolution() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'TAX_RESOLUTION_IMMUTABLE: registros fiscais não podem ser esvaziados' USING ERRCODE='restrict_violation'; END;
$$;
CREATE TRIGGER tax_resolution_package_no_truncate BEFORE TRUNCATE ON app.tax_resolution_package FOR EACH STATEMENT EXECUTE FUNCTION app.rejeitar_truncate_tax_resolution();
CREATE TRIGGER tax_resolution_package_event_no_truncate BEFORE TRUNCATE ON app.tax_resolution_package_event FOR EACH STATEMENT EXECUTE FUNCTION app.rejeitar_truncate_tax_resolution();
CREATE TRIGGER tax_entry_resolution_snapshot_no_truncate BEFORE TRUNCATE ON app.tax_entry_resolution_snapshot FOR EACH STATEMENT EXECUTE FUNCTION app.rejeitar_truncate_tax_resolution();

CREATE OR REPLACE FUNCTION app.tax_package_import(p_actor uuid,p_now timestamptz,p_correlation text,p_package_id text,p_version text,p_content jsonb,p_sha256 text)
RETURNS app.tax_resolution_package LANGUAGE plpgsql SECURITY DEFINER SET search_path=app,public,pg_temp AS $$
DECLARE result app.tax_resolution_package;
BEGIN
  PERFORM app.exigir_contexto_do_catalogo_tributario();
  INSERT INTO app.tax_resolution_package(package_id,semantic_version,status,content,content_sha256,imported_by,imported_at)
  VALUES(p_package_id,p_version,'IMPORTED',p_content,p_sha256,p_actor,p_now) RETURNING * INTO result;
  INSERT INTO app.tax_resolution_package_event(package_id,action,actor_id,occurred_at,correlation_id)
  VALUES(result.id,'IMPORTED',p_actor,p_now,p_correlation);
  RETURN result;
END; $$;

CREATE OR REPLACE FUNCTION app.tax_package_transition(p_id uuid,p_actor uuid,p_now timestamptz,p_correlation text,p_action text,p_details jsonb DEFAULT '{}'::jsonb)
RETURNS app.tax_resolution_package LANGUAGE plpgsql SECURITY DEFINER SET search_path=app,public,pg_temp AS $$
DECLARE result app.tax_resolution_package; expected text;
BEGIN
  PERFORM app.exigir_contexto_do_catalogo_tributario();
  SELECT * INTO result FROM app.tax_resolution_package WHERE id=p_id FOR UPDATE;
  IF result.id IS NULL THEN RAISE EXCEPTION 'TAX_PACKAGE_NOT_FOUND: pacote inexistente'; END IF;
  expected := CASE p_action WHEN 'VALIDATED' THEN 'IMPORTED' WHEN 'REVIEWED' THEN 'VALIDATED' WHEN 'PUBLISHED' THEN 'REVIEWED' WHEN 'ARCHIVED' THEN 'PUBLISHED' END;
  IF expected IS NULL OR result.status <> expected THEN RAISE EXCEPTION 'TAX_PACKAGE_TRANSITION_INVALID: transição não permitida'; END IF;
  IF p_action='PUBLISHED' AND EXISTS (
    SELECT 1 FROM app.tax_resolution_package existing
    WHERE existing.status='PUBLISHED'
      AND existing.content->>'jurisdiction' = result.content->>'jurisdiction'
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(existing.content->'regimes') old_regime
        JOIN jsonb_array_elements_text(result.content->'regimes') new_regime ON old_regime.value=new_regime.value
      )
      AND daterange((existing.content->>'validFrom')::date,COALESCE((existing.content->>'validUntil')::date,'infinity'::date),'[]')
          && daterange((result.content->>'validFrom')::date,COALESCE((result.content->>'validUntil')::date,'infinity'::date),'[]')
  ) THEN RAISE EXCEPTION 'TAX_PACKAGE_OVERLAPPING_VALIDITY: pacote publicado já cobre combinação e data'; END IF;
  IF p_action='VALIDATED' THEN UPDATE app.tax_resolution_package SET status='VALIDATED' WHERE id=p_id;
  ELSIF p_action='REVIEWED' THEN UPDATE app.tax_resolution_package SET status='REVIEWED',reviewed_by=p_actor,reviewed_at=p_now WHERE id=p_id;
  ELSIF p_action='PUBLISHED' THEN UPDATE app.tax_resolution_package SET status='PUBLISHED',published_by=p_actor,published_at=p_now WHERE id=p_id;
  ELSIF p_action='ARCHIVED' THEN UPDATE app.tax_resolution_package SET status='ARCHIVED',archived_at=p_now WHERE id=p_id;
  END IF;
  INSERT INTO app.tax_resolution_package_event(package_id,action,actor_id,occurred_at,correlation_id,details)
  VALUES(p_id,p_action,p_actor,p_now,p_correlation,p_details);
  SELECT * INTO result FROM app.tax_resolution_package WHERE id=p_id;
  RETURN result;
END; $$;

CREATE OR REPLACE FUNCTION app.tax_package_list(p_include_drafts boolean DEFAULT false)
RETURNS SETOF app.tax_resolution_package LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=app,public,pg_temp AS $$
BEGIN
  PERFORM app.exigir_contexto_do_catalogo_tributario();
  RETURN QUERY SELECT * FROM app.tax_resolution_package WHERE p_include_drafts OR status='PUBLISHED' ORDER BY imported_at DESC;
END; $$;

CREATE OR REPLACE FUNCTION app.tax_package_get(p_id uuid)
RETURNS app.tax_resolution_package LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=app,public,pg_temp AS $$
DECLARE result app.tax_resolution_package;
BEGIN
  PERFORM app.exigir_contexto_do_catalogo_tributario();
  SELECT * INTO result FROM app.tax_resolution_package WHERE id=p_id;
  IF result.id IS NULL THEN RAISE EXCEPTION 'TAX_PACKAGE_NOT_FOUND: pacote inexistente'; END IF;
  RETURN result;
END; $$;

REVOKE ALL ON FUNCTION app.tax_package_import(uuid,timestamptz,text,text,text,jsonb,text), app.tax_package_transition(uuid,uuid,timestamptz,text,text,jsonb), app.tax_package_list(boolean), app.tax_package_get(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.tax_package_import(uuid,timestamptz,text,text,text,jsonb,text), app.tax_package_transition(uuid,uuid,timestamptz,text,text,jsonb), app.tax_package_list(boolean), app.tax_package_get(uuid) TO contaia_app;

REVOKE ALL ON app.tax_resolution_package, app.tax_resolution_package_event, app.tax_entry_resolution_snapshot FROM PUBLIC, contaia_app;
GRANT SELECT, INSERT ON app.tax_entry_resolution_snapshot TO contaia_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE DELETE ON TABLES FROM contaia_app;
