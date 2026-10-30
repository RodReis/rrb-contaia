-- Substituição de linhas em rascunho sem conceder DELETE direto à aplicação.
CREATE OR REPLACE FUNCTION app.opening_balance_replace_draft_lines(p_tenant uuid,p_empresa uuid,p_version uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=app,pg_catalog AS $$
BEGIN
 IF NOT app.contexto_humano() OR app.tenant_atual() IS DISTINCT FROM p_tenant OR NOT app.empresa_autorizada(p_empresa) THEN
   RAISE EXCEPTION 'OPENING_BALANCE_SCOPE_FORBIDDEN' USING ERRCODE='insufficient_privilege';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM app.opening_balance_version WHERE id=p_version AND tenant_id=p_tenant AND empresa_id=p_empresa AND status='DRAFT' FOR UPDATE) THEN
   RAISE EXCEPTION 'OPENING_BALANCE_DRAFT_REQUIRED' USING ERRCODE='restrict_violation';
 END IF;
 DELETE FROM app.opening_balance_line WHERE tenant_id=p_tenant AND empresa_id=p_empresa AND version_id=p_version;
END; $$;
REVOKE ALL ON FUNCTION app.opening_balance_replace_draft_lines(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.opening_balance_replace_draft_lines(uuid,uuid,uuid) TO contaia_app;
