-- SPEC-029/F29: conserva indFinal da NF-e para selecionar venda a consumidor final.
ALTER TABLE app.fiscal_document ADD COLUMN consumidor_final boolean;
GRANT UPDATE(consumidor_final) ON app.fiscal_document TO contaia_app;
