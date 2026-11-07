-- Preserva o erro nativo de RLS quando o pai fica invisível ao trigger.
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
   IF version_status IS NULL THEN RETURN OLD; END IF;
   IF version_status<>'DRAFT' THEN RAISE EXCEPTION 'STATEMENT_PUBLISHED_IMMUTABLE' USING ERRCODE='restrict_violation'; END IF;
   RETURN OLD;
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
