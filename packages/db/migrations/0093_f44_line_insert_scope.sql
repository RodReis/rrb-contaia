-- RLS deve rejeitar inserções fora do escopo antes de validar a linha filha.
CREATE OR REPLACE FUNCTION app.opening_balance_line_draft_only() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE version_status text; version_id_value uuid;
BEGIN
 IF TG_OP='INSERT' THEN RETURN NEW; END IF;
 version_id_value:=OLD.version_id;
 SELECT status INTO version_status FROM app.opening_balance_version WHERE id=version_id_value AND tenant_id=OLD.tenant_id AND empresa_id=OLD.empresa_id;
 IF version_status IS DISTINCT FROM 'DRAFT' THEN RAISE EXCEPTION 'OPENING_BALANCE_LINE_IMMUTABLE' USING ERRCODE='restrict_violation'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.empresa_id IS DISTINCT FROM OLD.empresa_id OR NEW.version_id IS DISTINCT FROM OLD.version_id THEN
   RAISE EXCEPTION 'OPENING_BALANCE_SCOPE_IMMUTABLE' USING ERRCODE='restrict_violation';
 END IF;
 RETURN NEW;
END; $$;
