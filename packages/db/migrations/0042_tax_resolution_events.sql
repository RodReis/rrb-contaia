-- SPEC-026: trilha append-only das conclusões de resolução por empresa.
CREATE TABLE app.tax_entry_resolution_event (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES app.tenant(id), empresa_id uuid NOT NULL,
  document_id uuid NOT NULL, actor_id uuid NOT NULL REFERENCES app.usuario(id),
  correlation_id text NOT NULL,
  action text NOT NULL CHECK (action IN ('PROCESSED','REPROCESSED','ABSTAINED')),
  revision integer NOT NULL CHECK (revision > 0),
  package_id uuid REFERENCES app.tax_resolution_package(id),
  item_count integer NOT NULL CHECK (item_count > 0),
  indeterminate_count integer NOT NULL CHECK (indeterminate_count BETWEEN 0 AND item_count),
  idempotency_key text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (empresa_id,tenant_id) REFERENCES app.empresa(id,tenant_id),
  FOREIGN KEY (document_id,empresa_id,tenant_id) REFERENCES app.fiscal_document(id,empresa_id,tenant_id),
  UNIQUE (tenant_id,idempotency_key)
);
CREATE INDEX tax_entry_resolution_event_scope_idx ON app.tax_entry_resolution_event(tenant_id,empresa_id,occurred_at DESC);
CREATE INDEX tax_entry_resolution_event_document_idx ON app.tax_entry_resolution_event(document_id,revision DESC);
ALTER TABLE app.tax_entry_resolution_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.tax_entry_resolution_event FORCE ROW LEVEL SECURITY;
CREATE POLICY tax_entry_resolution_event_scope ON app.tax_entry_resolution_event
  USING (tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id))
  WITH CHECK (tenant_id=app.tenant_atual() AND app.origem_atual()='HUMANA' AND
    app.empresa_autorizada(empresa_id) AND actor_id=app.usuario_atual());
CREATE TRIGGER escopo_imutavel BEFORE UPDATE ON app.tax_entry_resolution_event
  FOR EACH ROW EXECUTE FUNCTION app.proteger_escopo_empresa();
CREATE TRIGGER tax_entry_resolution_event_append_only BEFORE UPDATE OR DELETE ON app.tax_entry_resolution_event
  FOR EACH ROW EXECUTE FUNCTION app.rejeitar_escrita_em_historico();
CREATE TRIGGER tax_entry_resolution_event_no_truncate BEFORE TRUNCATE ON app.tax_entry_resolution_event
  FOR EACH STATEMENT EXECUTE FUNCTION app.rejeitar_truncate_tax_resolution();
REVOKE ALL ON app.tax_entry_resolution_event FROM PUBLIC,contaia_app;
GRANT SELECT,INSERT ON app.tax_entry_resolution_event TO contaia_app;

-- A unicidade temporal deve refletir a combinação inteira coberta pelo pacote.
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
    IF EXISTS (
      SELECT 1 FROM app.tax_resolution_package existing
      WHERE existing.status='PUBLISHED'
        AND existing.content->>'jurisdiction' = result.content->>'jurisdiction'
        AND existing.content->'document' = result.content->'document'
        AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(existing.content->'operations') old_operation
          JOIN jsonb_array_elements_text(result.content->'operations') new_operation ON old_operation.value=new_operation.value)
        AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(existing.content->'regimes') old_regime
          JOIN jsonb_array_elements_text(result.content->'regimes') new_regime ON old_regime.value=new_regime.value)
        AND daterange((existing.content->>'validFrom')::date,COALESCE((existing.content->>'validUntil')::date,'infinity'::date),'[]')
          && daterange((result.content->>'validFrom')::date,COALESCE((result.content->>'validUntil')::date,'infinity'::date),'[]')
    ) THEN RAISE EXCEPTION 'TAX_PACKAGE_OVERLAPPING_VALIDITY: pacote publicado já cobre combinação e data'; END IF;
  END IF;
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
