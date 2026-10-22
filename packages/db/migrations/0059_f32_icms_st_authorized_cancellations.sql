-- SPEC-032/F32: persist authorized NF-e cancellation and stale affected reviews.
CREATE TABLE app.tax_st_authorized_cancellation (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES app.tenant(id),
  empresa_id uuid NOT NULL,
  output_document_id uuid NOT NULL,
  source_event_id uuid NOT NULL UNIQUE,
  output_competence date NOT NULL CHECK (extract(day from output_competence)=1),
  authorized_at timestamptz NOT NULL,
  evidence_sha256 text NOT NULL CHECK (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  actor_id uuid NOT NULL,
  correlation_id text NOT NULL,
  occurred_at timestamptz NOT NULL,
  FOREIGN KEY (output_document_id,empresa_id,tenant_id) REFERENCES app.fiscal_document(id,empresa_id,tenant_id),
  FOREIGN KEY (empresa_id,tenant_id) REFERENCES app.empresa(id,tenant_id),
  UNIQUE (tenant_id,empresa_id,output_document_id),
  UNIQUE (id,tenant_id,empresa_id)
);
CREATE INDEX tax_st_authorized_cancellation_scope_idx ON app.tax_st_authorized_cancellation(tenant_id,empresa_id,output_competence);
CREATE INDEX tax_st_authorized_cancellation_document_idx ON app.tax_st_authorized_cancellation(tenant_id,empresa_id,output_document_id);
ALTER TABLE app.tax_st_authorized_cancellation ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.tax_st_authorized_cancellation FORCE ROW LEVEL SECURITY;
CREATE POLICY tax_st_authorized_cancellation_select ON app.tax_st_authorized_cancellation FOR SELECT
  USING (tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id));
CREATE POLICY tax_st_authorized_cancellation_insert ON app.tax_st_authorized_cancellation FOR INSERT
  WITH CHECK (tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id));
CREATE TRIGGER escopo_imutavel BEFORE UPDATE ON app.tax_st_authorized_cancellation FOR EACH ROW EXECUTE FUNCTION app.proteger_escopo_empresa();
CREATE TRIGGER tax_st_authorized_cancellation_append_only BEFORE UPDATE OR DELETE ON app.tax_st_authorized_cancellation FOR EACH ROW EXECUTE FUNCTION app.rejeitar_escrita_em_historico();
CREATE TRIGGER tax_st_authorized_cancellation_no_truncate BEFORE TRUNCATE ON app.tax_st_authorized_cancellation FOR EACH STATEMENT EXECUTE FUNCTION app.rejeitar_truncate_tax_resolution();
REVOKE ALL ON app.tax_st_authorized_cancellation FROM PUBLIC,contaia_app;
GRANT SELECT,INSERT ON app.tax_st_authorized_cancellation TO contaia_app;

CREATE FUNCTION app.tax_st_capture_authorized_cancellation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=app,public,pg_temp AS $$
DECLARE doc app.fiscal_document%ROWTYPE; month_start date;
BEGIN
  IF NEW.tipo IS DISTINCT FROM 'CANCELAMENTO' OR NEW.codigo IS DISTINCT FROM '110111' THEN RETURN NEW; END IF;
  SELECT * INTO doc FROM app.fiscal_document WHERE id=NEW.document_id AND tenant_id=NEW.tenant_id AND empresa_id=NEW.empresa_id;
  IF NOT FOUND OR doc.especie NOT IN ('NFE_55','NFCE_65') OR doc.estado<>'CANCELLED' OR doc.protocolo_cancelamento IS NULL OR NEW.hash_sha256 IS NULL THEN RETURN NEW; END IF;
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
CREATE TRIGGER tax_st_capture_authorized_cancellation AFTER INSERT ON app.fiscal_document_event
  FOR EACH ROW EXECUTE FUNCTION app.tax_st_capture_authorized_cancellation();
