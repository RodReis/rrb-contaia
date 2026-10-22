-- SPEC-030/F30: permite ao worker sinalizar mudança documental preservando o ator humano ativo.
CREATE OR REPLACE FUNCTION app.tax_st_settlement_mark_stale(p_empresa uuid,p_competence date,p_actor uuid,p_correlation text,p_document uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=app,public,pg_temp AS $$
DECLARE tenant uuid:=app.tenant_atual(); affected integer;
BEGIN
  IF tenant IS NULL OR p_actor IS NULL OR NOT app.empresa_autorizada(p_empresa) OR
     NOT EXISTS(SELECT 1 FROM app.usuario u WHERE u.id=p_actor AND u.tenant_id=tenant AND u.estado='ATIVO') OR
     NOT EXISTS(SELECT 1 FROM app.usuario_papel WHERE usuario_id=p_actor AND tenant_id=tenant AND removido_em IS NULL
       AND papel IN ('admin_escritorio','contador','auxiliar')) OR
     NOT (
       (app.origem_atual()='HUMANA' AND p_actor IS NOT DISTINCT FROM app.usuario_atual() AND app.usuario_ativo_atual()) OR
       (app.origem_atual()='TECNICA' AND app.finalidade_atual()='IMPORTACAO_NFCE'
         AND NULLIF(current_setting('app.identidade_tecnica',true),'')='worker-nfce'
         AND app.empresa_tecnica_atual()=p_empresa)
     ) THEN RAISE EXCEPTION 'ICMS_ST_SETTLEMENT_ACCESS_DENIED'; END IF;
  INSERT INTO app.tax_st_settlement_event(tenant_id,empresa_id,snapshot_id,action,actor_id,correlation_id,occurred_at,details)
    SELECT s.tenant_id,s.empresa_id,s.id,'DOCUMENT_SET_CHANGED',p_actor,p_correlation,now(),jsonb_build_object('source','NFCE_65','documentId',p_document,'event','IMPORTED')
      FROM app.tax_st_settlement_snapshot s WHERE s.tenant_id=tenant AND s.empresa_id=p_empresa AND s.competence=p_competence
        AND EXISTS(SELECT 1 FROM app.tax_st_settlement_review_event review WHERE review.snapshot_id=s.id AND review.action IN ('SUBMITTED','APPROVED','REJECTED'))
        AND NOT EXISTS(SELECT 1 FROM app.tax_st_settlement_event prior WHERE prior.snapshot_id=s.id AND prior.action='DOCUMENT_SET_CHANGED' AND prior.details->>'documentId'=p_document::text);
  GET DIAGNOSTICS affected=ROW_COUNT; RETURN affected;
END; $$;
REVOKE ALL ON FUNCTION app.tax_st_settlement_mark_stale(uuid,date,uuid,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.tax_st_settlement_mark_stale(uuid,date,uuid,text,uuid) TO contaia_app;
