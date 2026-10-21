-- SPEC-029/F29: manter o nome canônico do trigger de escopo e permitir persistir
-- número/série normalizados no reprocessamento da NF-e.
DROP TRIGGER tax_st_settlement_review_scope_immutable ON app.tax_st_settlement_review_event;
CREATE TRIGGER escopo_imutavel BEFORE UPDATE ON app.tax_st_settlement_review_event
  FOR EACH ROW EXECUTE FUNCTION app.proteger_escopo_empresa();

GRANT UPDATE(numero_documento,serie_documento) ON app.fiscal_document TO contaia_app;
