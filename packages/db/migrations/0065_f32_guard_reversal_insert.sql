-- F32: somente a função de finalização grava estorno após aprovação humana.
REVOKE INSERT ON app.tax_st_return_reversal FROM contaia_app;
CREATE OR REPLACE FUNCTION app.tax_st_return_finalize(p_event uuid,p_tenant uuid,p_empresa uuid,p_actor uuid,p_competence date,
  p_quantity numeric,p_remaining numeric,p_restitution bigint,p_complement bigint,p_correlation text,p_now timestamptz)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=app,public,pg_temp AS $$
DECLARE source app.tax_st_return_event; result uuid;
BEGIN
  IF p_tenant<>app.tenant_atual() OR p_actor<>app.usuario_atual() OR NOT app.usuario_ativo_atual() OR NOT app.empresa_autorizada(p_empresa) OR
     NOT EXISTS(SELECT 1 FROM app.usuario_papel WHERE usuario_id=p_actor AND tenant_id=p_tenant AND removido_em IS NULL
       AND papel IN ('admin_escritorio','contador')) THEN RAISE EXCEPTION 'ICMS_ST_RETURN_REVIEW_FORBIDDEN'; END IF;
  SELECT * INTO source FROM app.tax_st_return_event WHERE id=p_event AND tenant_id=p_tenant AND empresa_id=p_empresa FOR UPDATE;
  IF source.id IS NULL OR NOT EXISTS(SELECT 1 FROM app.tax_st_return_review_event r WHERE r.return_event_id=p_event
      AND r.tenant_id=p_tenant AND r.empresa_id=p_empresa AND r.action='APPROVED'
      ORDER BY r.occurred_at DESC,r.id DESC LIMIT 1) THEN RAISE EXCEPTION 'ICMS_ST_RETURN_REVIEW_REQUIRED'; END IF;
  INSERT INTO app.tax_st_return_reversal(tenant_id,empresa_id,event_id,original_snapshot_id,original_line_id,competence,
    returned_quantity_scaled,remaining_quantity_scaled,reversed_restitution_cents,reversed_complement_cents,formula_version,source_ids,actor_id,correlation_id,occurred_at)
  SELECT p_tenant,p_empresa,p_event,source.original_snapshot_id,source.original_line_id,p_competence,p_quantity,p_remaining,
    p_restitution,p_complement,source.evidence_facts->>'formulaVersion',
    ARRAY(SELECT jsonb_array_elements_text(source.evidence_facts->'sourceIds')),p_actor,p_correlation,p_now RETURNING id INTO result;
  RETURN result;
END; $$;
REVOKE ALL ON FUNCTION app.tax_st_return_finalize(uuid,uuid,uuid,uuid,date,numeric,numeric,bigint,bigint,text,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.tax_st_return_finalize(uuid,uuid,uuid,uuid,date,numeric,numeric,bigint,bigint,text,timestamptz) TO contaia_app;
