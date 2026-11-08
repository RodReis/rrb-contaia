-- A carteira da empresa também limita os registros de proveniência para jobs autorizados.
DROP POLICY accounting_statement_template_source_select ON app.accounting_statement_template_source;
DROP POLICY accounting_statement_template_source_insert ON app.accounting_statement_template_source;
CREATE POLICY accounting_statement_template_source_select ON app.accounting_statement_template_source FOR SELECT USING (tenant_id=app.tenant_atual() AND (app.contexto_humano() OR app.contexto_tecnico()) AND app.empresa_autorizada(company_id));
CREATE POLICY accounting_statement_template_source_insert ON app.accounting_statement_template_source FOR INSERT WITH CHECK (tenant_id=app.tenant_atual() AND (app.contexto_humano() OR app.contexto_tecnico()) AND app.empresa_autorizada(company_id));
DROP POLICY accounting_statement_template_application_select ON app.accounting_statement_template_application;
DROP POLICY accounting_statement_template_application_insert ON app.accounting_statement_template_application;
CREATE POLICY accounting_statement_template_application_select ON app.accounting_statement_template_application FOR SELECT USING (tenant_id=app.tenant_atual() AND (app.contexto_humano() OR app.contexto_tecnico()) AND app.empresa_autorizada(company_id));
CREATE POLICY accounting_statement_template_application_insert ON app.accounting_statement_template_application FOR INSERT WITH CHECK (tenant_id=app.tenant_atual() AND (app.contexto_humano() OR app.contexto_tecnico()) AND app.empresa_autorizada(company_id));

CREATE OR REPLACE FUNCTION app.accounting_statement_template_child_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_id uuid; v_tenant uuid; v_template uuid; v_status text;
BEGIN
 v_id:=CASE WHEN TG_OP='DELETE' THEN OLD.version_id ELSE NEW.version_id END;
 v_tenant:=CASE WHEN TG_OP='DELETE' THEN OLD.tenant_id ELSE NEW.tenant_id END;
 v_template:=CASE WHEN TG_OP='DELETE' THEN OLD.template_id ELSE NEW.template_id END;
 SELECT status INTO v_status FROM app.accounting_statement_template_version WHERE id=v_id AND tenant_id=v_tenant AND template_id=v_template;
 -- RLS/FK avaliam escopo e existência; o trigger só protege versões existentes.
 IF v_status IS NULL THEN IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF; END IF;
 IF v_status IS DISTINCT FROM 'DRAFT' THEN RAISE EXCEPTION 'STATEMENT_TEMPLATE_PUBLISHED_IMMUTABLE' USING ERRCODE='restrict_violation'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END; $$;
