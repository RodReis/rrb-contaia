-- F32 invalidates older snapshots when return evidence arrives.
CREATE OR REPLACE FUNCTION app.tax_st_settlement_mark_return_stale(
  p_empresa uuid,p_competence date,p_actor uuid,p_correlation text,p_event uuid,p_now timestamptz
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=app,public,pg_temp AS $$
DECLARE tenant uuid:=app.tenant_atual(); affected integer;
BEGIN
  IF tenant IS NULL OR p_actor IS DISTINCT FROM app.usuario_atual() OR NOT app.usuario_ativo_atual() OR
     NOT app.empresa_autorizada(p_empresa) OR NOT EXISTS(
       SELECT 1 FROM app.usuario_papel WHERE usuario_id=p_actor AND tenant_id=tenant AND removido_em IS NULL
         AND papel IN ('admin_escritorio','contador','auxiliar')
     ) THEN RAISE EXCEPTION 'ICMS_ST_SETTLEMENT_ACCESS_DENIED'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('icms-st:'||tenant::text||':'||p_empresa::text||':'||to_char(p_competence,'YYYY-MM'),0));
  INSERT INTO app.tax_st_settlement_event(tenant_id,empresa_id,snapshot_id,action,actor_id,correlation_id,occurred_at,details)
    SELECT s.tenant_id,s.empresa_id,s.id,'DOCUMENT_SET_CHANGED',p_actor,p_correlation,p_now,
      jsonb_build_object('source','F32_RETURN','eventId',p_event::text)
      FROM app.tax_st_settlement_snapshot s
     WHERE s.tenant_id=tenant AND s.empresa_id=p_empresa AND s.competence=p_competence
       AND NOT EXISTS(SELECT 1 FROM app.tax_st_settlement_event prior
         WHERE prior.snapshot_id=s.id AND prior.details->>'eventId'=p_event::text);
  GET DIAGNOSTICS affected=ROW_COUNT;
  RETURN affected;
END; $$;
REVOKE ALL ON FUNCTION app.tax_st_settlement_mark_return_stale(uuid,date,uuid,text,uuid,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.tax_st_settlement_mark_return_stale(uuid,date,uuid,text,uuid,timestamptz) TO contaia_app;
