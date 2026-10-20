-- SPEC-028/F28: componentes documentais por item e revisão humana imutável.
ALTER TABLE app.fiscal_document_item ADD COLUMN frete numeric(30,10) CHECK (frete IS NULL OR frete >= 0);
ALTER TABLE app.fiscal_document_item ADD COLUMN seguro numeric(30,10) CHECK (seguro IS NULL OR seguro >= 0);
ALTER TABLE app.fiscal_document_item ADD COLUMN desconto numeric(30,10) CHECK (desconto IS NULL OR desconto >= 0);
ALTER TABLE app.fiscal_document_item ADD COLUMN outras_despesas numeric(30,10) CHECK (outras_despesas IS NULL OR outras_despesas >= 0);

CREATE TABLE app.tax_entry_resolution_human_review (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES app.tenant(id),
  empresa_id uuid NOT NULL,
  document_id uuid NOT NULL,
  snapshot_id uuid NOT NULL REFERENCES app.tax_entry_resolution_snapshot(id),
  item_number integer NOT NULL CHECK (item_number > 0),
  revision integer NOT NULL CHECK (revision > 0),
  liability_kind text NOT NULL CHECK (liability_kind IN ('ICMS_ST_RECIPIENT_DUE','ICMS_ENTRY_ADVANCE','ICMS_ST_JOINT_LIABILITY')),
  status text NOT NULL CHECK (status IN ('PENDING_REVIEW')),
  submitted_by uuid NOT NULL,
  submitted_at timestamptz NOT NULL,
  decided_by uuid,
  decided_at timestamptz,
  rejection_reason text,
  lock_version integer NOT NULL DEFAULT 1 CHECK (lock_version = 1),
  correlation_id text NOT NULL,
  FOREIGN KEY (empresa_id,tenant_id) REFERENCES app.empresa(id,tenant_id),
  FOREIGN KEY (document_id,empresa_id,tenant_id) REFERENCES app.fiscal_document(id,empresa_id,tenant_id),
  FOREIGN KEY (document_id,revision,item_number) REFERENCES app.tax_entry_resolution_snapshot(document_id,revision,item_number),
  UNIQUE (snapshot_id,liability_kind),
  CHECK (status='PENDING_REVIEW' AND decided_by IS NULL AND decided_at IS NULL AND rejection_reason IS NULL)
);

CREATE INDEX tax_entry_human_review_scope_idx ON app.tax_entry_resolution_human_review(tenant_id,empresa_id,document_id,revision);
CREATE INDEX tax_entry_human_review_company_idx ON app.tax_entry_resolution_human_review(empresa_id);
ALTER TABLE app.tax_entry_resolution_human_review ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.tax_entry_resolution_human_review FORCE ROW LEVEL SECURITY;
CREATE POLICY tax_entry_human_review_scope ON app.tax_entry_resolution_human_review
  USING (tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id))
  WITH CHECK (tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id));
CREATE TRIGGER tax_entry_human_review_scope_immutable BEFORE UPDATE ON app.tax_entry_resolution_human_review
  FOR EACH ROW EXECUTE FUNCTION app.proteger_escopo_empresa();

CREATE TABLE app.tax_entry_resolution_human_review_event (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES app.tenant(id),
  empresa_id uuid NOT NULL,
  review_id uuid NOT NULL REFERENCES app.tax_entry_resolution_human_review(id),
  action text NOT NULL CHECK (action IN ('SUBMITTED','APPROVED','REJECTED')),
  actor_id uuid NOT NULL,
  correlation_id text NOT NULL,
  occurred_at timestamptz NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text CHECK (status IN ('APPROVED','REJECTED')),
  decided_by uuid,
  decided_at timestamptz,
  rejection_reason text,
  lock_version integer NOT NULL CHECK (lock_version IN (1,2)),
  CHECK ((action='APPROVED' AND status='APPROVED' AND decided_by=actor_id AND decided_at=occurred_at AND rejection_reason IS NULL) OR
         (action='REJECTED' AND status='REJECTED' AND decided_by=actor_id AND decided_at=occurred_at AND length(trim(rejection_reason))>=10) OR
         (action='SUBMITTED' AND status IS NULL AND decided_by IS NULL AND decided_at IS NULL AND rejection_reason IS NULL AND lock_version=1)),
  FOREIGN KEY (empresa_id,tenant_id) REFERENCES app.empresa(id,tenant_id)
);
CREATE INDEX tax_entry_human_review_event_scope_idx ON app.tax_entry_resolution_human_review_event(tenant_id,empresa_id,review_id);
CREATE INDEX tax_entry_human_review_event_company_idx ON app.tax_entry_resolution_human_review_event(empresa_id);
ALTER TABLE app.tax_entry_resolution_human_review_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.tax_entry_resolution_human_review_event FORCE ROW LEVEL SECURITY;
CREATE POLICY tax_entry_human_review_event_scope ON app.tax_entry_resolution_human_review_event
  USING (tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id))
  WITH CHECK (tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id));
CREATE TRIGGER tax_entry_human_review_event_append_only BEFORE UPDATE OR DELETE ON app.tax_entry_resolution_human_review_event
  FOR EACH ROW EXECUTE FUNCTION app.rejeitar_escrita_em_historico();
CREATE TRIGGER tax_entry_human_review_event_no_truncate BEFORE TRUNCATE ON app.tax_entry_resolution_human_review_event
  FOR EACH STATEMENT EXECUTE FUNCTION app.rejeitar_truncate_tax_resolution();
REVOKE ALL ON app.tax_entry_resolution_human_review,app.tax_entry_resolution_human_review_event FROM PUBLIC,contaia_app;
GRANT SELECT ON app.tax_entry_resolution_human_review,app.tax_entry_resolution_human_review_event TO contaia_app;

CREATE OR REPLACE FUNCTION app.tax_entry_human_review_submit(
  p_snapshot uuid,p_empresa_id uuid,p_liability_kind text,p_actor uuid,p_now timestamptz,p_correlation text
) RETURNS app.tax_entry_resolution_human_review
LANGUAGE plpgsql SECURITY DEFINER SET search_path=app,public,pg_temp AS $$
DECLARE source app.tax_entry_resolution_snapshot; result app.tax_entry_resolution_human_review; inserted boolean;
BEGIN
  IF p_actor<>app.usuario_atual() OR NOT app.usuario_ativo_atual() OR NOT EXISTS (
    SELECT 1 FROM app.usuario_papel WHERE usuario_id=p_actor AND tenant_id=app.tenant_atual()
      AND papel IN ('admin_escritorio','contador','auxiliar') AND removido_em IS NULL
  ) THEN RAISE EXCEPTION 'TAX_REVIEW_SUBMISSION_FORBIDDEN'; END IF;
  IF p_liability_kind NOT IN ('ICMS_ST_RECIPIENT_DUE','ICMS_ENTRY_ADVANCE','ICMS_ST_JOINT_LIABILITY') THEN
    RAISE EXCEPTION 'TAX_REVIEW_LIABILITY_INVALID';
  END IF;
  SELECT * INTO source FROM app.tax_entry_resolution_snapshot WHERE id=p_snapshot AND empresa_id=p_empresa_id
    AND tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id) FOR SHARE;
  IF source.id IS NULL THEN RAISE EXCEPTION 'TAX_SNAPSHOT_NOT_FOUND'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(source.decisions) decision
     WHERE decision->>'tax'='ICMS_HISTORICAL' AND decision->>'liabilityKind'=p_liability_kind
       AND decision->>'status'='APPLICABLE' AND decision->>'amountDueCents' IS NOT NULL
  ) THEN RAISE EXCEPTION 'TAX_REVIEW_RESULT_NOT_APPROVABLE'; END IF;
  INSERT INTO app.tax_entry_resolution_human_review
    (tenant_id,empresa_id,document_id,snapshot_id,item_number,revision,liability_kind,status,submitted_by,submitted_at,correlation_id)
  VALUES(source.tenant_id,source.empresa_id,source.document_id,source.id,source.item_number,source.revision,
         p_liability_kind,'PENDING_REVIEW',p_actor,p_now,p_correlation)
  ON CONFLICT(snapshot_id,liability_kind) DO NOTHING RETURNING * INTO result;
  inserted := result.id IS NOT NULL;
  IF NOT inserted THEN
    SELECT * INTO result FROM app.tax_entry_resolution_human_review WHERE snapshot_id=p_snapshot AND liability_kind=p_liability_kind;
  ELSE
    INSERT INTO app.tax_entry_resolution_human_review_event(tenant_id,empresa_id,review_id,action,actor_id,correlation_id,occurred_at,lock_version)
    VALUES(source.tenant_id,source.empresa_id,result.id,'SUBMITTED',p_actor,p_correlation,p_now,1);
  END IF;
  RETURN result;
END; $$;

CREATE OR REPLACE FUNCTION app.tax_entry_human_review_decide(
  p_id uuid,p_empresa_id uuid,p_actor uuid,p_now timestamptz,p_expected_version integer,p_action text,p_reason text,p_correlation text
) RETURNS app.tax_entry_resolution_human_review
LANGUAGE plpgsql SECURITY DEFINER SET search_path=app,public,pg_temp AS $$
DECLARE result app.tax_entry_resolution_human_review; inserted_event app.tax_entry_resolution_human_review_event; latest app.tax_entry_resolution_human_review_event;
        latest_action text; latest_version integer;
BEGIN
  IF p_actor<>app.usuario_atual() OR NOT app.usuario_ativo_atual() OR NOT EXISTS (
    SELECT 1 FROM app.usuario_papel WHERE usuario_id=p_actor AND tenant_id=app.tenant_atual()
      AND papel IN ('admin_escritorio','contador') AND removido_em IS NULL
  ) THEN RAISE EXCEPTION 'TAX_REVIEW_DECISION_FORBIDDEN'; END IF;
  IF p_action NOT IN ('APPROVED','REJECTED') THEN RAISE EXCEPTION 'TAX_REVIEW_ACTION_INVALID'; END IF;
  IF p_action='REJECTED' AND length(trim(coalesce(p_reason,''))) < 10 THEN RAISE EXCEPTION 'TAX_REVIEW_REASON_REQUIRED'; END IF;
  SELECT * INTO result FROM app.tax_entry_resolution_human_review WHERE id=p_id AND empresa_id=p_empresa_id
    AND tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id) FOR UPDATE;
  IF result.id IS NULL THEN RAISE EXCEPTION 'TAX_REVIEW_NOT_FOUND'; END IF;
  SELECT event.action,event.lock_version INTO latest_action,latest_version FROM app.tax_entry_resolution_human_review_event event
   WHERE event.review_id=p_id ORDER BY event.lock_version DESC LIMIT 1;
  IF latest_version IS DISTINCT FROM p_expected_version OR p_expected_version<>1 OR latest_action IS DISTINCT FROM 'SUBMITTED' THEN
    RAISE EXCEPTION 'TAX_REVIEW_CONFLICT expected %, latest %, action %',p_expected_version,latest_version,latest_action;
  END IF;
  INSERT INTO app.tax_entry_resolution_human_review_event(tenant_id,empresa_id,review_id,action,actor_id,correlation_id,occurred_at,details,status,decided_by,decided_at,rejection_reason,lock_version)
  VALUES(result.tenant_id,result.empresa_id,result.id,p_action,p_actor,p_correlation,p_now,
    CASE WHEN p_action='REJECTED' THEN jsonb_build_object('reason',trim(p_reason)) ELSE '{}'::jsonb END,
    p_action,p_actor,p_now,CASE WHEN p_action='REJECTED' THEN trim(p_reason) ELSE NULL END,p_expected_version+1)
  RETURNING * INTO inserted_event;
  result.status:=inserted_event.status;
  result.decided_by:=inserted_event.decided_by;
  result.decided_at:=inserted_event.decided_at;
  result.rejection_reason:=inserted_event.rejection_reason;
  result.lock_version:=inserted_event.lock_version;
  RETURN result;
END; $$;

REVOKE ALL ON FUNCTION app.tax_entry_human_review_submit(uuid,uuid,text,uuid,timestamptz,text),
  app.tax_entry_human_review_decide(uuid,uuid,uuid,timestamptz,integer,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.tax_entry_human_review_submit(uuid,uuid,text,uuid,timestamptz,text),
  app.tax_entry_human_review_decide(uuid,uuid,uuid,timestamptz,integer,text,text,text) TO contaia_app;
