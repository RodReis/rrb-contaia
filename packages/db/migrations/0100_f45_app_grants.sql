-- Normaliza os grants de escrita do papel operacional depois de criadas as políticas e guards.
-- DELETE e TRUNCATE continuam revogados; substituição de rascunho usa soft deactivation na API.
GRANT SELECT, INSERT, UPDATE
  ON app.accounting_statement_version,
     app.accounting_statement_line,
     app.accounting_statement_mapping,
     app.accounting_statement_component
  TO contaia_app;

GRANT SELECT, INSERT
  ON app.accounting_statement_event,
     app.accounting_statement_export,
     app.accounting_period_close_snapshot_line
  TO contaia_app;
