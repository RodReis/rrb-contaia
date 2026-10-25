-- SPEC-036/F36: tentativa de decisão negada é append-only e não altera o estado do pacote.
ALTER TABLE app.tax_monthly_rule_package_event
  DROP CONSTRAINT tax_monthly_rule_package_event_action_check;
ALTER TABLE app.tax_monthly_rule_package_event
  ADD CONSTRAINT tax_monthly_rule_package_event_action_check
  CHECK(action IN ('IMPORTED','APPROVED','REJECTED','SUPERSEDED','DOWNLOADED','FAILED'));
