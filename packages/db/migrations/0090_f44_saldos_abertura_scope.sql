-- Completa a chave e proteções da 0089 também em bancos locais já existentes.
DO $$
DECLARE pk_name text; pk_is_id boolean;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='app' AND table_name='opening_balance_idempotency' AND column_name='id') THEN
    ALTER TABLE app.opening_balance_idempotency ADD COLUMN id uuid DEFAULT app.uuid_v7();
    UPDATE app.opening_balance_idempotency SET id=app.uuid_v7() WHERE id IS NULL;
    ALTER TABLE app.opening_balance_idempotency ALTER COLUMN id SET NOT NULL;
  END IF;
  SELECT conname, (SELECT array_agg(a.attname ORDER BY k.ordinality)=ARRAY['id']::name[] FROM unnest(c.conkey) WITH ORDINALITY k(attnum,ordinality) JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum)
    INTO pk_name,pk_is_id FROM pg_constraint c WHERE c.conrelid='app.opening_balance_idempotency'::regclass AND c.contype='p';
  IF pk_name IS NOT NULL AND NOT coalesce(pk_is_id,false) THEN EXECUTE format('ALTER TABLE app.opening_balance_idempotency DROP CONSTRAINT %I',pk_name); pk_name:=NULL; END IF;
  IF pk_name IS NULL THEN ALTER TABLE app.opening_balance_idempotency ADD CONSTRAINT opening_balance_idempotency_pkey PRIMARY KEY(id); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='app.opening_balance_idempotency'::regclass AND conname='opening_balance_idempotency_id_scope_key') THEN
    ALTER TABLE app.opening_balance_idempotency ADD CONSTRAINT opening_balance_idempotency_id_scope_key UNIQUE(id,tenant_id,empresa_id);
  END IF;
END $$;
DO $$
DECLARE pair text[]; trigger_name text;
BEGIN
  FOREACH pair SLICE 1 IN ARRAY ARRAY[
    ARRAY['opening_balance_version_scope','opening_balance_version'],
    ARRAY['opening_balance_line_scope','opening_balance_line'],
    ARRAY['opening_balance_preview_scope','opening_balance_preview'],
    ARRAY['opening_balance_idempotency_scope','opening_balance_idempotency'],
    ARRAY['opening_balance_event_scope','opening_balance_event'],
    ARRAY['movimento_razao_f44_scope','movimento_razao']
  ] LOOP
    trigger_name:=pair[1];
    IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=format('app.%I',pair[2])::regclass AND tgname=trigger_name AND NOT tgisinternal) THEN
      EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.proteger_escopo_empresa()',pair[1],pair[2]);
    END IF;
  END LOOP;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='app' AND table_name='opening_balance_event' AND column_name='idempotency_id') THEN
    ALTER TABLE app.opening_balance_event ADD COLUMN idempotency_id uuid;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='app.opening_balance_event'::regclass AND conname='opening_balance_event_idempotency_scope_fkey') THEN
    ALTER TABLE app.opening_balance_event ADD CONSTRAINT opening_balance_event_idempotency_scope_fkey FOREIGN KEY(idempotency_id,tenant_id,empresa_id) REFERENCES app.opening_balance_idempotency(id,tenant_id,empresa_id);
  END IF;
END $$;
