-- Permite descartar rascunho mantendo trilha auditável e sem tocar em versões publicadas.
ALTER TABLE app.accounting_statement_template_version DROP CONSTRAINT accounting_statement_template_version_status_check;
ALTER TABLE app.accounting_statement_template_version ADD CONSTRAINT accounting_statement_template_version_status_check CHECK(status IN ('DRAFT','ACTIVE','SUPERSEDED','DISCARDED'));
ALTER TABLE app.accounting_statement_template_version DROP CONSTRAINT accounting_statement_template_version_check;
ALTER TABLE app.accounting_statement_template_version ADD CONSTRAINT accounting_statement_template_version_check CHECK(
  (status='DRAFT' AND published_by IS NULL AND published_at IS NULL AND structural_hash IS NULL)
  OR (status IN ('ACTIVE','SUPERSEDED') AND published_by IS NOT NULL AND published_at IS NOT NULL AND structural_hash IS NOT NULL)
  OR (status='DISCARDED' AND published_by IS NULL AND published_at IS NULL AND structural_hash IS NULL)
);
ALTER TABLE app.accounting_statement_template_event DROP CONSTRAINT accounting_statement_template_event_action_check;
ALTER TABLE app.accounting_statement_template_event ADD CONSTRAINT accounting_statement_template_event_action_check CHECK(action IN ('CREATED','RENAMED','DRAFT_CREATED','DRAFT_UPDATED','DRAFT_DISCARDED','PUBLISHED','SUPERSEDED','ARCHIVED','REACTIVATED','APPLIED'));

CREATE OR REPLACE FUNCTION app.accounting_statement_template_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'STATEMENT_TEMPLATE_VERSION_IMMUTABLE' USING ERRCODE='restrict_violation'; END IF;
 IF OLD.status='DRAFT' AND NEW.status='DRAFT' AND NEW.revision=OLD.revision+1 AND NEW.version=OLD.version AND NEW.origin=OLD.origin AND NEW.created_by=OLD.created_by AND NEW.published_by IS NULL AND NEW.published_at IS NULL AND NEW.structural_hash IS NULL THEN RETURN NEW; END IF;
 IF OLD.status='DRAFT' AND NEW.status='ACTIVE' AND NEW.revision=OLD.revision+1 AND NEW.version=OLD.version AND NEW.origin=OLD.origin AND NEW.created_by=OLD.created_by AND NEW.published_by IS NOT NULL AND NEW.published_at IS NOT NULL AND NEW.structural_hash IS NOT NULL THEN RETURN NEW; END IF;
 IF OLD.status='DRAFT' AND NEW.status='DISCARDED' AND NEW.revision=OLD.revision+1 AND NEW.version=OLD.version AND NEW.origin=OLD.origin AND NEW.created_by=OLD.created_by AND NEW.published_by IS NULL AND NEW.published_at IS NULL AND NEW.structural_hash IS NULL THEN RETURN NEW; END IF;
 IF OLD.status='ACTIVE' AND NEW.status='SUPERSEDED' AND NEW.revision=OLD.revision AND NEW.version=OLD.version AND NEW.origin=OLD.origin AND NEW.created_by=OLD.created_by AND NEW.published_by=OLD.published_by AND NEW.published_at=OLD.published_at AND NEW.structural_hash=OLD.structural_hash THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'STATEMENT_TEMPLATE_VERSION_IMMUTABLE' USING ERRCODE='restrict_violation';
END; $$;
