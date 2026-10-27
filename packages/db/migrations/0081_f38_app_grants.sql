-- Complementa a migration F38 original com privilégios mínimos para o papel da API.
GRANT SELECT,INSERT ON app.corporate_tax_rule_package,app.corporate_tax_rule_package_event,app.corporate_tax_declaration,
  app.corporate_tax_declaration_event,app.corporate_tax_evidence,app.corporate_tax_assessment,
  app.corporate_tax_assessment_event,app.corporate_tax_artifact TO contaia_app;
