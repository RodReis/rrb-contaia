-- Banco local compartilhado pode ter executado uma revisão anterior da 0089.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='app' AND table_name='opening_balance_event' AND column_name='idempotency_id') THEN
    ALTER TABLE app.opening_balance_event ADD COLUMN idempotency_id uuid;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='app.opening_balance_event'::regclass AND conname='opening_balance_event_idempotency_scope_fkey') THEN
    ALTER TABLE app.opening_balance_event ADD CONSTRAINT opening_balance_event_idempotency_scope_fkey FOREIGN KEY(idempotency_id,tenant_id,empresa_id) REFERENCES app.opening_balance_idempotency(id,tenant_id,empresa_id);
  END IF;
END $$;
