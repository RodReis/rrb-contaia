-- F26: impede duas publicações concorrentes de validar cobertura contra o mesmo estado antigo.
CREATE OR REPLACE FUNCTION app.tax_package_transition(p_id uuid,p_actor uuid,p_now timestamptz,p_correlation text,p_action text,p_details jsonb DEFAULT '{}'::jsonb)
RETURNS app.tax_resolution_package LANGUAGE plpgsql SECURITY DEFINER SET search_path=app,public,pg_temp AS $$
DECLARE result app.tax_resolution_package; expected text;
BEGIN
  PERFORM app.exigir_contexto_do_catalogo_tributario();
  SELECT * INTO result FROM app.tax_resolution_package WHERE id=p_id FOR UPDATE;
  IF result.id IS NULL THEN RAISE EXCEPTION 'TAX_PACKAGE_NOT_FOUND: pacote inexistente'; END IF;
  expected := CASE p_action WHEN 'VALIDATED' THEN 'IMPORTED' WHEN 'REVIEWED' THEN 'VALIDATED' WHEN 'PUBLISHED' THEN 'REVIEWED' WHEN 'ARCHIVED' THEN 'PUBLISHED' END;
  IF expected IS NULL OR result.status <> expected THEN RAISE EXCEPTION 'TAX_PACKAGE_TRANSITION_INVALID: transição não permitida'; END IF;
  IF p_action='PUBLISHED' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('tax_resolution_package_publish',0));
  END IF;
  IF p_action='PUBLISHED' AND EXISTS (
    SELECT 1 FROM app.tax_resolution_package existing
    WHERE existing.status='PUBLISHED'
      AND existing.content->>'jurisdiction' = result.content->>'jurisdiction'
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(existing.content->'regimes') old_regime
        JOIN jsonb_array_elements_text(result.content->'regimes') new_regime ON old_regime.value=new_regime.value
      )
      AND daterange((existing.content->>'validFrom')::date,COALESCE((existing.content->>'validUntil')::date,'infinity'::date),'[]')
          && daterange((result.content->>'validFrom')::date,COALESCE((result.content->>'validUntil')::date,'infinity'::date),'[]')
  ) THEN RAISE EXCEPTION 'TAX_PACKAGE_OVERLAPPING_VALIDITY: pacote publicado já cobre combinação e data'; END IF;
  IF p_action='VALIDATED' THEN UPDATE app.tax_resolution_package SET status='VALIDATED' WHERE id=p_id;
  ELSIF p_action='REVIEWED' THEN UPDATE app.tax_resolution_package SET status='REVIEWED',reviewed_by=p_actor,reviewed_at=p_now WHERE id=p_id;
  ELSIF p_action='PUBLISHED' THEN UPDATE app.tax_resolution_package SET status='PUBLISHED',published_by=p_actor,published_at=p_now WHERE id=p_id;
  ELSIF p_action='ARCHIVED' THEN UPDATE app.tax_resolution_package SET status='ARCHIVED',archived_at=p_now WHERE id=p_id;
  END IF;
  INSERT INTO app.tax_resolution_package_event(package_id,action,actor_id,occurred_at,correlation_id,details)
  VALUES(p_id,p_action,p_actor,p_now,p_correlation,p_details);
  SELECT * INTO result FROM app.tax_resolution_package WHERE id=p_id;
  RETURN result;
END; $$;
