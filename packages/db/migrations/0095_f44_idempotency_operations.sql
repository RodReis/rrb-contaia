-- Inclui todas as operações F44 em instalações que receberam a primeira versão da 0089.
ALTER TABLE app.opening_balance_idempotency DROP CONSTRAINT IF EXISTS opening_balance_idempotency_operation_check;
ALTER TABLE app.opening_balance_idempotency ADD CONSTRAINT opening_balance_idempotency_operation_check
  CHECK(operation IN ('DRAFT','UPDATE_DRAFT','CSV_PREVIEW','CSV_CONFIRM','APPROVE','REPLACE'));
