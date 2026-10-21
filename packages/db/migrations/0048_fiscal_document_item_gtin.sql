-- SPEC-029/F29: identifica produto de forma estável para atribuição auditável de estoque.
ALTER TABLE app.fiscal_document_item ADD COLUMN gtin text CHECK (gtin IS NULL OR gtin ~ '^(\d{8}|\d{12}|\d{13}|\d{14})$');
CREATE INDEX fiscal_document_item_gtin_scope_idx ON app.fiscal_document_item(empresa_id,tenant_id,gtin) WHERE gtin IS NOT NULL;
