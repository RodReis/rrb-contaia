-- Reescrita atômica de conteúdo de rascunho sem conceder DELETE direto ao papel da aplicação.
CREATE OR REPLACE FUNCTION app.accounting_statement_template_clear_draft_lines(p_tenant uuid,p_template uuid,p_version uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
BEGIN
 IF p_tenant IS DISTINCT FROM app.tenant_atual() OR NOT app.contexto_humano() THEN
  RAISE EXCEPTION 'STATEMENT_TEMPLATE_SCOPE_FORBIDDEN' USING ERRCODE='insufficient_privilege';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM app.accounting_statement_template_version WHERE tenant_id=p_tenant AND template_id=p_template AND id=p_version AND status='DRAFT' FOR UPDATE) THEN
  RAISE EXCEPTION 'STATEMENT_TEMPLATE_DRAFT_REQUIRED' USING ERRCODE='restrict_violation';
 END IF;
 DELETE FROM app.accounting_statement_template_component WHERE tenant_id=p_tenant AND template_id=p_template AND version_id=p_version;
 DELETE FROM app.accounting_statement_template_line WHERE tenant_id=p_tenant AND template_id=p_template AND version_id=p_version;
END; $$;
REVOKE ALL ON FUNCTION app.accounting_statement_template_clear_draft_lines(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.accounting_statement_template_clear_draft_lines(uuid,uuid,uuid) TO contaia_app;
