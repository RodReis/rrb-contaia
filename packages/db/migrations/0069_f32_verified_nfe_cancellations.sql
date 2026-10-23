-- SPEC-032/F32: guarda a identidade do evento somente após validação XSD e XMLDSig pelo worker.
CREATE TABLE app.fiscal_document_verified_event (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(), tenant_id uuid NOT NULL REFERENCES app.tenant(id), empresa_id uuid NOT NULL,
  staging_id uuid NOT NULL, chave_acesso text NOT NULL CHECK(chave_acesso ~ '^\d{44}$'), cnpj text NOT NULL CHECK(cnpj ~ '^\d{14}$'),
  ambiente text NOT NULL CHECK(ambiente IN ('PRODUCAO','HOMOLOGACAO')), tipo text NOT NULL CHECK(tipo='110111'),
  sequencia text NOT NULL CHECK(sequencia ~ '^\d{1,2}$'), protocolo text NOT NULL,
  hash_sha256 text NOT NULL CHECK(hash_sha256 ~ '^[0-9a-f]{64}$'), original_key text NOT NULL,
  ocorrido_em timestamptz NOT NULL, tamanho_bytes bigint NOT NULL CHECK(tamanho_bytes>0), correlation_id text NOT NULL, criado_em timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(staging_id,empresa_id,tenant_id) REFERENCES app.dfe_capture_staging(id,empresa_id,tenant_id),
  FOREIGN KEY(empresa_id,tenant_id) REFERENCES app.empresa(id,tenant_id), UNIQUE(id,empresa_id,tenant_id),
  UNIQUE(tenant_id,empresa_id,chave_acesso,tipo,sequencia)
);
CREATE INDEX fiscal_document_verified_event_scope_idx ON app.fiscal_document_verified_event(empresa_id,tenant_id);
CREATE INDEX fiscal_document_verified_event_key_idx ON app.fiscal_document_verified_event(tenant_id,empresa_id,chave_acesso);
ALTER TABLE app.fiscal_document_verified_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.fiscal_document_verified_event FORCE ROW LEVEL SECURITY;
CREATE POLICY fiscal_document_verified_event_select ON app.fiscal_document_verified_event FOR SELECT USING(tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id));
CREATE POLICY fiscal_document_verified_event_insert ON app.fiscal_document_verified_event FOR INSERT WITH CHECK(tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id));
CREATE TRIGGER escopo_imutavel BEFORE UPDATE ON app.fiscal_document_verified_event FOR EACH ROW EXECUTE FUNCTION app.proteger_escopo_empresa();
CREATE TRIGGER fiscal_document_verified_event_append_only BEFORE UPDATE OR DELETE ON app.fiscal_document_verified_event FOR EACH ROW EXECUTE FUNCTION app.rejeitar_escrita_em_historico();
GRANT SELECT,INSERT ON app.fiscal_document_verified_event TO contaia_app;
REVOKE UPDATE,DELETE ON app.fiscal_document_verified_event FROM contaia_app;

ALTER TABLE app.fiscal_document_event ADD COLUMN verified_event_id uuid;
ALTER TABLE app.fiscal_document_event ALTER COLUMN staging_id DROP NOT NULL;
ALTER TABLE app.fiscal_document_event ADD CONSTRAINT fiscal_document_event_verified_source FOREIGN KEY(verified_event_id,empresa_id,tenant_id) REFERENCES app.fiscal_document_verified_event(id,empresa_id,tenant_id);
CREATE UNIQUE INDEX fiscal_document_event_nfe_cancel_staging_unique ON app.fiscal_document_event(staging_id,tipo,codigo) WHERE codigo='110111';
-- Captura automática é um ator técnico; mantém a autoria humana nula em vez de inventar usuário.
ALTER TABLE app.tax_st_authorized_cancellation ALTER COLUMN actor_id DROP NOT NULL;
ALTER TABLE app.tax_st_settlement_event ALTER COLUMN actor_id DROP NOT NULL;

-- F32: accept NF-e 55 cancellation only when the event provenance matches the verified record.
CREATE OR REPLACE FUNCTION app.tax_st_capture_authorized_cancellation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=app,public,pg_temp AS $$
DECLARE doc app.fiscal_document%ROWTYPE; month_start date; verified boolean:=false;
BEGIN
  IF NEW.tipo IS DISTINCT FROM 'CANCELAMENTO' OR NEW.codigo IS DISTINCT FROM '110111' THEN RETURN NEW; END IF;
  SELECT * INTO doc FROM app.fiscal_document WHERE id=NEW.document_id AND tenant_id=NEW.tenant_id AND empresa_id=NEW.empresa_id;
  IF NOT FOUND OR doc.especie NOT IN ('NFCE_65','NFE_55') OR doc.estado<>'CANCELLED' OR doc.protocolo_cancelamento IS NULL OR NEW.hash_sha256 IS NULL THEN RETURN NEW; END IF;
  IF doc.especie='NFCE_65' AND NEW.nfce_source_id IS NOT NULL THEN
    verified:=EXISTS(SELECT 1 FROM app.nfce_import_event event JOIN app.nfce_import_item item ON item.id=event.item_id AND item.tenant_id=event.tenant_id AND item.empresa_id=event.empresa_id
      WHERE event.source_id=NEW.nfce_source_id AND event.tenant_id=NEW.tenant_id AND event.empresa_id=NEW.empresa_id AND event.chave_acesso=doc.chave_acesso
        AND event.tipo='110111' AND event.protocolo=doc.protocolo_cancelamento AND event.hash_sha256=NEW.hash_sha256 AND item.status='IMPORTED' AND item.document_id=NEW.document_id);
  ELSIF doc.especie='NFE_55' AND NEW.verified_event_id IS NOT NULL AND NEW.nfce_source_id IS NULL THEN
    verified:=EXISTS(SELECT 1 FROM app.fiscal_document_verified_event event
      JOIN app.dfe_capture_staging staging ON staging.id=event.staging_id AND staging.tenant_id=event.tenant_id AND staging.empresa_id=event.empresa_id
      WHERE event.id=NEW.verified_event_id AND event.tenant_id=NEW.tenant_id AND event.empresa_id=NEW.empresa_id AND event.chave_acesso=doc.chave_acesso
        AND event.tipo='110111' AND event.protocolo=doc.protocolo_cancelamento AND event.hash_sha256=NEW.hash_sha256 AND staging.especie='NFE_55');
  END IF;
  IF NOT verified THEN RETURN NEW; END IF;
  month_start:=date_trunc('month',doc.emitido_em)::date;
  INSERT INTO app.tax_st_authorized_cancellation(tenant_id,empresa_id,output_document_id,source_event_id,output_competence,authorized_at,evidence_sha256,actor_id,correlation_id,occurred_at)
    VALUES(NEW.tenant_id,NEW.empresa_id,NEW.document_id,NEW.id,month_start,coalesce(doc.cancelado_em,NEW.ocorrido_em),NEW.hash_sha256,NEW.ator_id,NEW.correlation_id,NEW.ocorrido_em) ON CONFLICT DO NOTHING;
  PERFORM pg_advisory_xact_lock(hashtextextended('icms-st:'||NEW.tenant_id::text||':'||NEW.empresa_id::text||':'||to_char(month_start,'YYYY-MM'),0));
  INSERT INTO app.tax_st_settlement_event(tenant_id,empresa_id,snapshot_id,action,actor_id,correlation_id,occurred_at,details)
    SELECT s.tenant_id,s.empresa_id,s.id,'DOCUMENT_SET_CHANGED',NEW.ator_id,NEW.correlation_id,NEW.ocorrido_em,jsonb_build_object('source','F32_AUTHORIZED_CANCELLATION','documentId',NEW.document_id,'eventId',NEW.id)
      FROM app.tax_st_settlement_snapshot s WHERE s.tenant_id=NEW.tenant_id AND s.empresa_id=NEW.empresa_id AND s.competence=month_start
       AND EXISTS(SELECT 1 FROM app.tax_st_settlement_review_event review WHERE review.snapshot_id=s.id AND review.action IN ('SUBMITTED','APPROVED','REJECTED'))
       AND NOT EXISTS(SELECT 1 FROM app.tax_st_settlement_event prior WHERE prior.snapshot_id=s.id AND prior.action='DOCUMENT_SET_CHANGED' AND prior.details->>'eventId'=NEW.id::text);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.tax_st_capture_authorized_cancellation() FROM PUBLIC;
