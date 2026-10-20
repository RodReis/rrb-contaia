-- F27/SPEC-027: preserva CEST original do item para enquadramento versionado.
ALTER TABLE app.fiscal_document_item
  ADD COLUMN cest text CHECK (cest IS NULL OR cest ~ '^[0-9]{7}$');
