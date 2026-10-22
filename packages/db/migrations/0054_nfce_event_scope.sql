-- SPEC-030/F30: mantém os identificadores de tenant/empresa imutáveis no evento fiscal.
CREATE TRIGGER escopo_imutavel BEFORE UPDATE ON app.nfce_import_event
  FOR EACH ROW EXECUTE FUNCTION app.proteger_escopo_empresa();
