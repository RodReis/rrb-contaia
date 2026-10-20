-- F26: preserva o código de benefício fiscal declarado por item na NF-e.
ALTER TABLE app.fiscal_document_item ADD COLUMN codigo_beneficio text;
