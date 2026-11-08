-- tenant_id e company_id pertencem ao escopo imutável da carteira.
CREATE OR REPLACE FUNCTION app.reference_mapping_scope_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.company_id IS DISTINCT FROM OLD.company_id THEN
  RAISE EXCEPTION 'REFERENCE_MAPPING_SCOPE_IMMUTABLE' USING ERRCODE='restrict_violation';
 END IF;
 RETURN NEW;
END; $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['company_reference_mapping','company_reference_mapping_entry','company_reference_mapping_center_snapshot','company_reference_mapping_import','company_reference_mapping_event'] LOOP
  EXECUTE format('CREATE TRIGGER aaa_%I_scope_guard BEFORE UPDATE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.reference_mapping_scope_guard()',t,t);
 END LOOP;
END $$;
