-- Deixa a política RLS rejeitar primeiro filhos cujo rascunho está fora do recorte.
CREATE OR REPLACE FUNCTION app.reference_mapping_child_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_id uuid; v_tenant uuid; v_company uuid; v_status text;
BEGIN
 v_id:=CASE WHEN TG_OP='DELETE' THEN OLD.mapping_id ELSE NEW.mapping_id END;
 v_tenant:=CASE WHEN TG_OP='DELETE' THEN OLD.tenant_id ELSE NEW.tenant_id END;
 v_company:=CASE WHEN TG_OP='DELETE' THEN OLD.company_id ELSE NEW.company_id END;
 SELECT status INTO v_status FROM app.company_reference_mapping WHERE id=v_id AND tenant_id=v_tenant AND company_id=v_company;
 -- RLS oculta o pai fora do recorte; deixa a política da própria filha rejeitar a escrita.
 IF v_status IS NULL THEN IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF; END IF;
 IF v_status IS DISTINCT FROM 'DRAFT' THEN RAISE EXCEPTION 'REFERENCE_MAPPING_PUBLISHED_IMMUTABLE' USING ERRCODE='restrict_violation'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END; $$;
