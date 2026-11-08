-- Índices da carteira e no-op usados pela matriz antidrifts de RLS.
CREATE INDEX company_reference_mapping_entry_company_idx ON app.company_reference_mapping_entry(tenant_id,company_id,mapping_id);
CREATE INDEX company_reference_mapping_center_company_idx ON app.company_reference_mapping_center_snapshot(tenant_id,company_id,mapping_id);
CREATE INDEX company_reference_mapping_import_company_idx ON app.company_reference_mapping_import(tenant_id,company_id,created_at DESC);
CREATE OR REPLACE FUNCTION app.reference_mapping_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.status='DRAFT' AND NEW.version IS NULL AND NEW.published_by IS NULL AND NEW.published_at IS NULL AND NEW.canonical_sha256 IS NULL THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'REFERENCE_MAPPING_VERSION_IMMUTABLE' USING ERRCODE='restrict_violation';
 END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'REFERENCE_MAPPING_VERSION_IMMUTABLE' USING ERRCODE='restrict_violation'; END IF;
 IF NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
 IF OLD.status='DRAFT' AND NEW.status='DRAFT' AND NEW.revision=OLD.revision+1 AND NEW.version IS NULL
 AND NEW.tenant_id=OLD.tenant_id AND NEW.company_id=OLD.company_id AND NEW.calendar_year=OLD.calendar_year
 AND NEW.tax_regime=OLD.tax_regime AND NEW.special_situation IS NOT DISTINCT FROM OLD.special_situation
 AND NEW.package_id=OLD.package_id AND NEW.applicability=OLD.applicability AND NEW.package_sha256=OLD.package_sha256
 AND NEW.created_by=OLD.created_by AND NEW.created_at=OLD.created_at AND NEW.correlation_id=OLD.correlation_id
 AND NEW.published_by IS NULL AND NEW.published_at IS NULL AND NEW.canonical_sha256 IS NULL THEN RETURN NEW; END IF;
 IF OLD.status='DRAFT' AND NEW.status='PUBLISHED' AND NEW.revision=OLD.revision+1 AND NEW.version IS NOT NULL
 AND NEW.tenant_id=OLD.tenant_id AND NEW.company_id=OLD.company_id AND NEW.calendar_year=OLD.calendar_year
 AND NEW.tax_regime=OLD.tax_regime AND NEW.special_situation IS NOT DISTINCT FROM OLD.special_situation
 AND NEW.package_id=OLD.package_id AND NEW.applicability=OLD.applicability AND NEW.package_sha256=OLD.package_sha256
 AND NEW.created_by=OLD.created_by AND NEW.created_at=OLD.created_at AND NEW.correlation_id=OLD.correlation_id
 AND NEW.published_by IS NOT NULL AND NEW.published_at IS NOT NULL AND NEW.canonical_sha256 IS NOT NULL THEN RETURN NEW; END IF;
 IF OLD.status='PUBLISHED' AND NEW.status='SUPERSEDED' AND NEW.revision=OLD.revision AND NEW.version=OLD.version
 AND NEW.tenant_id=OLD.tenant_id AND NEW.company_id=OLD.company_id AND NEW.calendar_year=OLD.calendar_year
 AND NEW.tax_regime=OLD.tax_regime AND NEW.special_situation IS NOT DISTINCT FROM OLD.special_situation
 AND NEW.package_id=OLD.package_id AND NEW.applicability=OLD.applicability AND NEW.package_sha256=OLD.package_sha256
 AND NEW.created_by=OLD.created_by AND NEW.created_at=OLD.created_at AND NEW.correlation_id=OLD.correlation_id
 AND NEW.published_by=OLD.published_by AND NEW.published_at=OLD.published_at AND NEW.canonical_sha256=OLD.canonical_sha256 THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'REFERENCE_MAPPING_VERSION_IMMUTABLE' USING ERRCODE='restrict_violation';
END; $$;
CREATE OR REPLACE FUNCTION app.reference_mapping_import_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'REFERENCE_MAPPING_APPEND_ONLY' USING ERRCODE='restrict_violation'; END IF;
 IF NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
 IF OLD.status='PREVIEW' AND NEW.status IN ('APPLIED','REJECTED') AND NEW.id=OLD.id AND NEW.tenant_id=OLD.tenant_id
 AND NEW.company_id=OLD.company_id AND NEW.mapping_id=OLD.mapping_id AND NEW.file_sha256=OLD.file_sha256
 AND NEW.expected_revision=OLD.expected_revision AND NEW.summary=OLD.summary AND NEW.actor_id=OLD.actor_id
 AND NEW.correlation_id=OLD.correlation_id AND NEW.created_at=OLD.created_at THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'REFERENCE_MAPPING_APPEND_ONLY' USING ERRCODE='restrict_violation';
END; $$;
CREATE OR REPLACE FUNCTION app.reference_mapping_child_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_id uuid; v_tenant uuid; v_company uuid; v_status text;
BEGIN
 v_id:=CASE WHEN TG_OP='DELETE' THEN OLD.mapping_id ELSE NEW.mapping_id END;
 v_tenant:=CASE WHEN TG_OP='DELETE' THEN OLD.tenant_id ELSE NEW.tenant_id END;
 v_company:=CASE WHEN TG_OP='DELETE' THEN OLD.company_id ELSE NEW.company_id END;
 SELECT status INTO v_status FROM app.company_reference_mapping WHERE id=v_id AND tenant_id=v_tenant AND company_id=v_company;
 IF v_status IS NULL THEN IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF; END IF;
 IF v_status IS DISTINCT FROM 'DRAFT' THEN RAISE EXCEPTION 'REFERENCE_MAPPING_PUBLISHED_IMMUTABLE' USING ERRCODE='restrict_violation'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END; $$;
