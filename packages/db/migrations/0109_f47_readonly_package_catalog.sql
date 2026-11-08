-- A aplicação consulta o catálogo global por função estreita; não recebe SELECT direto nas tabelas.
REVOKE SELECT ON app.reference_accounting_package,app.reference_accounting_account FROM contaia_app;
CREATE OR REPLACE FUNCTION app.list_reference_accounting_packages()
RETURNS SETOF app.reference_accounting_package LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,app AS $$
 SELECT * FROM app.reference_accounting_package ORDER BY downloaded_at DESC,id
$$;
CREATE OR REPLACE FUNCTION app.list_reference_accounting_accounts(p_package_id text)
RETURNS SETOF app.reference_accounting_account LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,app AS $$
 SELECT * FROM app.reference_accounting_account WHERE package_id=p_package_id ORDER BY code
$$;
REVOKE ALL ON FUNCTION app.list_reference_accounting_packages() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.list_reference_accounting_accounts(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.list_reference_accounting_packages() TO contaia_app;
GRANT EXECUTE ON FUNCTION app.list_reference_accounting_accounts(text) TO contaia_app;
