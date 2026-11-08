-- SPEC-047 §5, §9 e §12: identidade fixa e snapshots sem edição pós-publicação.
CREATE OR REPLACE FUNCTION app.reference_package_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'REFERENCE_PACKAGE_IMMUTABLE' USING ERRCODE='restrict_violation'; END IF;
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.authority IS DISTINCT FROM OLD.authority OR NEW.source_document IS DISTINCT FROM OLD.source_document
 OR NEW.source_url IS DISTINCT FROM OLD.source_url OR NEW.layout IS DISTINCT FROM OLD.layout OR NEW.revision IS DISTINCT FROM OLD.revision
 OR NEW.covered_calendar_years IS DISTINCT FROM OLD.covered_calendar_years OR NEW.covered_special_situations IS DISTINCT FROM OLD.covered_special_situations
 OR NEW.downloaded_at IS DISTINCT FROM OLD.downloaded_at OR NEW.source_sha256 IS DISTINCT FROM OLD.source_sha256
 OR NEW.canonical_sha256 IS DISTINCT FROM OLD.canonical_sha256 OR NEW.created_at IS DISTINCT FROM OLD.created_at
 OR NOT ((OLD.status='AVAILABLE' AND NEW.status IN ('SUPERSEDED','REVOKED')) OR (OLD.status='SUPERSEDED' AND NEW.status='REVOKED')) THEN
  RAISE EXCEPTION 'REFERENCE_PACKAGE_IMMUTABLE' USING ERRCODE='restrict_violation';
 END IF;
 RETURN NEW;
END; $$;
CREATE OR REPLACE FUNCTION app.reference_package_account_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'REFERENCE_PACKAGE_IMMUTABLE' USING ERRCODE='restrict_violation'; END; $$;
CREATE TRIGGER reference_accounting_package_immutable BEFORE UPDATE OR DELETE ON app.reference_accounting_package FOR EACH ROW EXECUTE FUNCTION app.reference_package_guard();
CREATE TRIGGER reference_accounting_account_immutable BEFORE UPDATE OR DELETE ON app.reference_accounting_account FOR EACH ROW EXECUTE FUNCTION app.reference_package_account_immutable();

CREATE OR REPLACE FUNCTION app.reference_mapping_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.status='DRAFT' AND NEW.version IS NULL AND NEW.published_by IS NULL AND NEW.published_at IS NULL AND NEW.canonical_sha256 IS NULL THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'REFERENCE_MAPPING_VERSION_IMMUTABLE' USING ERRCODE='restrict_violation';
 END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'REFERENCE_MAPPING_VERSION_IMMUTABLE' USING ERRCODE='restrict_violation'; END IF;
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
DROP TRIGGER company_reference_mapping_version_guard ON app.company_reference_mapping;
CREATE TRIGGER company_reference_mapping_version_guard BEFORE INSERT OR UPDATE OR DELETE ON app.company_reference_mapping FOR EACH ROW EXECUTE FUNCTION app.reference_mapping_version_guard();

CREATE OR REPLACE FUNCTION app.reference_mapping_import_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'REFERENCE_MAPPING_APPEND_ONLY' USING ERRCODE='restrict_violation'; END IF;
 IF OLD.status='PREVIEW' AND NEW.status IN ('APPLIED','REJECTED') AND NEW.id=OLD.id AND NEW.tenant_id=OLD.tenant_id
 AND NEW.company_id=OLD.company_id AND NEW.mapping_id=OLD.mapping_id AND NEW.file_sha256=OLD.file_sha256
 AND NEW.expected_revision=OLD.expected_revision AND NEW.summary=OLD.summary AND NEW.actor_id=OLD.actor_id
 AND NEW.correlation_id=OLD.correlation_id AND NEW.created_at=OLD.created_at THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'REFERENCE_MAPPING_APPEND_ONLY' USING ERRCODE='restrict_violation';
END; $$;
CREATE TRIGGER company_reference_mapping_import_guard BEFORE UPDATE OR DELETE ON app.company_reference_mapping_import FOR EACH ROW EXECUTE FUNCTION app.reference_mapping_import_guard();
