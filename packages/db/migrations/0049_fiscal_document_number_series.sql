-- SPEC-029/F29: preservar número e série da NF-e para o leiaute oficial do demonstrativo.
ALTER TABLE app.fiscal_document
  ADD COLUMN numero_documento text,
  ADD COLUMN serie_documento text;
