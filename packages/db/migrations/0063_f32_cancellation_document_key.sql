-- F32: require the official event key to match the canceled NFC-e.
CREATE OR REPLACE FUNCTION app.tax_st_capture_authorized_cancellation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=app,public,pg_temp AS $$
DECLARE doc app.fiscal_document%ROWTYPE; month_start date;
BEGIN
  IF NEW.tipo IS DISTINCT FROM 'CANCELAMENTO' OR NEW.codigo IS DISTINCT FROM '110111' THEN RETURN NEW; END IF;
  SELECT * INTO doc FROM app.fiscal_document WHERE id=NEW.document_id AND tenant_id=NEW.tenant_id AND empresa_id=NEW.empresa_id;
  IF NOT FOUND OR doc.especie<>'NFCE_65' OR doc.estado<>'CANCELLED' OR doc.protocolo_cancelamento IS NULL OR NEW.hash_sha256 IS NULL OR NEW.nfce_source_id IS NULL THEN RETURN NEW; END IF;
  IF NOT EXISTS(SELECT 1 FROM app.nfce_import_event event
       JOIN app.nfce_import_item item ON item.id=event.item_id AND item.tenant_id=event.tenant_id AND item.empresa_id=event.empresa_id
       WHERE event.source_id=NEW.nfce_source_id AND event.tenant_id=NEW.tenant_id AND event.empresa_id=NEW.empresa_id AND event.chave_acesso=doc.chave_acesso
         AND event.tipo='110111' AND event.protocolo=doc.protocolo_cancelamento AND event.hash_sha256=NEW.hash_sha256
         AND item.status='IMPORTED' AND item.document_id=NEW.document_id) THEN RETURN NEW; END IF;
  month_start:=date_trunc('month',doc.emitido_em)::date;
  INSERT INTO app.tax_st_authorized_cancellation(tenant_id,empresa_id,output_document_id,source_event_id,output_competence,
    authorized_at,evidence_sha256,actor_id,correlation_id,occurred_at)
    VALUES(NEW.tenant_id,NEW.empresa_id,NEW.document_id,NEW.id,month_start,coalesce(doc.cancelado_em,NEW.ocorrido_em),NEW.hash_sha256,
      NEW.ator_id,NEW.correlation_id,NEW.ocorrido_em) ON CONFLICT DO NOTHING;
  PERFORM pg_advisory_xact_lock(hashtextextended('icms-st:'||NEW.tenant_id::text||':'||NEW.empresa_id::text||':'||to_char(month_start,'YYYY-MM'),0));
  INSERT INTO app.tax_st_settlement_event(tenant_id,empresa_id,snapshot_id,action,actor_id,correlation_id,occurred_at,details)
    SELECT s.tenant_id,s.empresa_id,s.id,'DOCUMENT_SET_CHANGED',NEW.ator_id,NEW.correlation_id,NEW.ocorrido_em,
      jsonb_build_object('source','F32_AUTHORIZED_CANCELLATION','documentId',NEW.document_id,'eventId',NEW.id)
      FROM app.tax_st_settlement_snapshot s WHERE s.tenant_id=NEW.tenant_id AND s.empresa_id=NEW.empresa_id AND s.competence=month_start
       AND EXISTS(SELECT 1 FROM app.tax_st_settlement_review_event review WHERE review.snapshot_id=s.id AND review.action IN ('SUBMITTED','APPROVED','REJECTED'))
       AND NOT EXISTS(SELECT 1 FROM app.tax_st_settlement_event prior WHERE prior.snapshot_id=s.id AND prior.action='DOCUMENT_SET_CHANGED' AND prior.details->>'eventId'=NEW.id::text);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.tax_st_capture_authorized_cancellation() FROM PUBLIC;
