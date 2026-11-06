-- A execução E2E da F45 observou `permission denied` no papel operacional após as migrations
-- iniciais da fatia. Reaplicar os grants explicitamente no fim garante escrita sem ampliar DELETE.
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
