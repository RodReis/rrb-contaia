-- Remove políticas legadas de DELETE em bancos que já aplicaram a primeira revisão da 0089.
DROP POLICY IF EXISTS opening_balance_version_delete ON app.opening_balance_version;
DROP POLICY IF EXISTS opening_balance_line_delete ON app.opening_balance_line;
REVOKE DELETE ON app.opening_balance_version,app.opening_balance_line FROM PUBLIC,contaia_app;
