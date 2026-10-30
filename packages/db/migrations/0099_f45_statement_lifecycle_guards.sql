CREATE OR REPLACE FUNCTION app.accounting_statement_version_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status<>'DRAFT' OR NEW.revision<>0 OR NEW.effective_from IS NOT NULL OR NEW.effective_to IS NOT NULL OR NEW.published_by IS NOT NULL OR NEW.published_at IS NOT NULL THEN
   RAISE EXCEPTION 'STATEMENT_VERSION_MUST_START_AS_DRAFT' USING ERRCODE='restrict_violation';
 END IF;
 RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION app.accounting_statement_version_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR OLD.id IS DISTINCT FROM NEW.id OR OLD.tenant_id IS DISTINCT FROM NEW.tenant_id OR OLD.company_id IS DISTINCT FROM NEW.company_id OR
    OLD.version IS DISTINCT FROM NEW.version OR OLD.created_by IS DISTINCT FROM NEW.created_by OR OLD.created_at IS DISTINCT FROM NEW.created_at OR OLD.correlation_id IS DISTINCT FROM NEW.correlation_id OR
    NOT ((OLD.status='DRAFT' AND NEW.status='DRAFT' AND NEW.revision=OLD.revision+1 AND NEW.effective_from IS NULL AND NEW.effective_to IS NULL AND NEW.published_by IS NULL AND NEW.published_at IS NULL) OR
         (OLD.status='DRAFT' AND NEW.status='ACTIVE' AND NEW.revision=OLD.revision+1 AND NEW.effective_from IS NOT NULL AND NEW.effective_to IS NULL AND NEW.published_by IS NOT NULL AND NEW.published_at IS NOT NULL) OR
         (OLD.status='ACTIVE' AND NEW.status='SUPERSEDED' AND NEW.revision=OLD.revision AND NEW.effective_from=OLD.effective_from AND NEW.published_by=OLD.published_by AND NEW.published_at=OLD.published_at AND NEW.effective_to IS NOT NULL AND NEW.effective_to>=NEW.effective_from)) THEN
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
DECLARE v_version_id uuid; v_tenant_id uuid; v_company_id uuid; v_status text; old_status text;
BEGIN
 v_version_id:=CASE WHEN TG_OP='DELETE' THEN OLD.version_id ELSE NEW.version_id END;
 v_tenant_id:=CASE WHEN TG_OP='DELETE' THEN OLD.tenant_id ELSE NEW.tenant_id END;
 v_company_id:=CASE WHEN TG_OP='DELETE' THEN OLD.company_id ELSE NEW.company_id END;
 IF TG_OP='UPDATE' AND (NEW.version_id IS DISTINCT FROM OLD.version_id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.company_id IS DISTINCT FROM OLD.company_id) THEN
   RAISE EXCEPTION 'STATEMENT_CHILD_SCOPE_IMMUTABLE' USING ERRCODE='restrict_violation';
 END IF;
 IF TG_OP='UPDATE' OR TG_OP='DELETE' THEN
   SELECT v.status INTO old_status FROM app.accounting_statement_version v WHERE v.id=OLD.version_id AND v.tenant_id=OLD.tenant_id AND v.company_id=OLD.company_id;
   IF old_status IS NULL THEN RETURN OLD; END IF;
   IF old_status<>'DRAFT' THEN RAISE EXCEPTION 'STATEMENT_PUBLISHED_IMMUTABLE' USING ERRCODE='restrict_violation'; END IF;
 END IF;
 IF TG_OP<>'DELETE' THEN
   SELECT v.status INTO v_status FROM app.accounting_statement_version v WHERE v.id=v_version_id AND v.tenant_id=v_tenant_id AND v.company_id=v_company_id;
   IF v_status IS NULL THEN RETURN NEW; END IF;
   IF v_status<>'DRAFT' THEN RAISE EXCEPTION 'STATEMENT_PUBLISHED_IMMUTABLE' USING ERRCODE='restrict_violation'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END; $$;

CREATE OR REPLACE FUNCTION app.accounting_statement_mapping_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE account_type text; account_class text; version_status text; old_status text;
BEGIN
 IF TG_OP='UPDATE' AND (NEW.version_id IS DISTINCT FROM OLD.version_id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.company_id IS DISTINCT FROM OLD.company_id) THEN
   RAISE EXCEPTION 'STATEMENT_CHILD_SCOPE_IMMUTABLE' USING ERRCODE='restrict_violation';
 END IF;
 IF TG_OP='UPDATE' OR TG_OP='DELETE' THEN
   SELECT v.status INTO old_status FROM app.accounting_statement_version v WHERE v.id=OLD.version_id AND v.tenant_id=OLD.tenant_id AND v.company_id=OLD.company_id;
   IF old_status IS NULL THEN RETURN OLD; END IF;
   IF old_status<>'DRAFT' THEN RAISE EXCEPTION 'STATEMENT_PUBLISHED_IMMUTABLE' USING ERRCODE='restrict_violation'; END IF;
   IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 END IF;
 SELECT v.status INTO version_status FROM app.accounting_statement_version v WHERE v.id=NEW.version_id AND v.tenant_id=NEW.tenant_id AND v.company_id=NEW.company_id;
 IF version_status IS NULL THEN RETURN NEW; END IF;
 IF version_status<>'DRAFT' THEN RAISE EXCEPTION 'STATEMENT_PUBLISHED_IMMUTABLE' USING ERRCODE='restrict_violation'; END IF;
 IF NEW.active THEN
   SELECT tipo,classe_contabil INTO account_type,account_class FROM app.conta_contabil WHERE id=NEW.account_id AND tenant_id=NEW.tenant_id AND empresa_id=NEW.company_id;
   IF account_type IS DISTINCT FROM 'analitica' OR account_class NOT IN ('REVENUE','EXPENSE') OR account_class IS DISTINCT FROM NEW.account_class THEN
     RAISE EXCEPTION 'STATEMENT_ACCOUNT_NOT_ELIGIBLE' USING ERRCODE='check_violation';
   END IF;
 END IF;
 RETURN NEW;
END; $$;

CREATE TRIGGER accounting_statement_version_insert_guard BEFORE INSERT ON app.accounting_statement_version FOR EACH ROW EXECUTE FUNCTION app.accounting_statement_version_insert_guard();
