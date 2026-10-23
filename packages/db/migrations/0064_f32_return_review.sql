-- F32: devolução submetida aguarda decisão humana antes de gerar estorno.
CREATE TABLE app.tax_st_return_review_event (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES app.tenant(id),
  empresa_id uuid NOT NULL,
  return_event_id uuid NOT NULL,
  action text NOT NULL CHECK(action IN ('SUBMITTED','APPROVED','REJECTED')),
  actor_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL,
  correlation_id text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  FOREIGN KEY(return_event_id,tenant_id,empresa_id) REFERENCES app.tax_st_return_event(id,tenant_id,empresa_id),
  FOREIGN KEY(empresa_id,tenant_id) REFERENCES app.empresa(id,tenant_id)
);
CREATE INDEX tax_st_return_review_scope_idx ON app.tax_st_return_review_event(tenant_id,empresa_id,return_event_id,occurred_at DESC);
CREATE INDEX tax_st_return_review_company_idx ON app.tax_st_return_review_event(empresa_id);
ALTER TABLE app.tax_st_return_review_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.tax_st_return_review_event FORCE ROW LEVEL SECURITY;
CREATE POLICY tax_st_return_review_select ON app.tax_st_return_review_event FOR SELECT
  USING(tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id));
CREATE TRIGGER escopo_imutavel BEFORE UPDATE ON app.tax_st_return_review_event
  FOR EACH ROW EXECUTE FUNCTION app.proteger_escopo_empresa();
CREATE TRIGGER tax_st_return_review_append_only BEFORE UPDATE OR DELETE ON app.tax_st_return_review_event
  FOR EACH ROW EXECUTE FUNCTION app.rejeitar_escrita_em_historico();
CREATE TRIGGER tax_st_return_review_no_truncate BEFORE TRUNCATE ON app.tax_st_return_review_event
  FOR EACH STATEMENT EXECUTE FUNCTION app.rejeitar_truncate_tax_resolution();
REVOKE ALL ON app.tax_st_return_review_event FROM PUBLIC,contaia_app;
GRANT SELECT ON app.tax_st_return_review_event TO contaia_app;

CREATE OR REPLACE FUNCTION app.tax_st_return_review(p_event uuid,p_empresa uuid,p_actor uuid,p_now timestamptz,
  p_action text,p_reason text,p_correlation text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=app,public,pg_temp AS $$
DECLARE source app.tax_st_return_event; latest app.tax_st_return_review_event;
BEGIN
  IF p_actor<>app.usuario_atual() OR NOT app.usuario_ativo_atual() OR NOT EXISTS(
      SELECT 1 FROM app.usuario_papel WHERE usuario_id=p_actor AND tenant_id=app.tenant_atual() AND removido_em IS NULL
        AND papel IN ('admin_escritorio','contador','auxiliar')) OR
      (p_action IN ('APPROVED','REJECTED') AND NOT EXISTS(
        SELECT 1 FROM app.usuario_papel WHERE usuario_id=p_actor AND tenant_id=app.tenant_atual() AND removido_em IS NULL
          AND papel IN ('admin_escritorio','contador'))) THEN RAISE EXCEPTION 'ICMS_ST_RETURN_REVIEW_FORBIDDEN'; END IF;
  IF p_action NOT IN ('SUBMITTED','APPROVED','REJECTED') OR (p_action='REJECTED' AND length(trim(coalesce(p_reason,'')))<10) THEN
    RAISE EXCEPTION 'ICMS_ST_RETURN_REVIEW_INVALID'; END IF;
  SELECT * INTO source FROM app.tax_st_return_event WHERE id=p_event AND empresa_id=p_empresa AND tenant_id=app.tenant_atual()
    AND app.empresa_autorizada(empresa_id) FOR UPDATE;
  IF source.id IS NULL THEN RAISE EXCEPTION 'ICMS_ST_RETURN_NOT_FOUND'; END IF;
  SELECT * INTO latest FROM app.tax_st_return_review_event WHERE return_event_id=p_event ORDER BY occurred_at DESC,id DESC LIMIT 1;
  IF (p_action='SUBMITTED' AND latest.id IS NOT NULL) OR
     (p_action IN ('APPROVED','REJECTED') AND latest.action IS DISTINCT FROM 'SUBMITTED') THEN
    RAISE EXCEPTION 'ICMS_ST_RETURN_REVIEW_CONFLICT';
  END IF;
  INSERT INTO app.tax_st_return_review_event(tenant_id,empresa_id,return_event_id,action,actor_id,occurred_at,correlation_id,details)
  VALUES(source.tenant_id,source.empresa_id,source.id,p_action,p_actor,p_now,p_correlation,
    CASE WHEN p_reason IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('reason',trim(p_reason)) END);
END; $$;
REVOKE ALL ON FUNCTION app.tax_st_return_review(uuid,uuid,uuid,timestamptz,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.tax_st_return_review(uuid,uuid,uuid,timestamptz,text,text,text) TO contaia_app;

CREATE OR REPLACE FUNCTION app.tax_st_return_reversal_requires_approval()
RETURNS trigger LANGUAGE plpgsql SET search_path=app,public,pg_temp AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM app.tax_st_return_review_event e WHERE e.return_event_id=NEW.event_id
      AND e.tenant_id=NEW.tenant_id AND e.empresa_id=NEW.empresa_id AND e.action='APPROVED'
      ORDER BY e.occurred_at DESC,e.id DESC LIMIT 1) THEN RAISE EXCEPTION 'ICMS_ST_RETURN_REVIEW_REQUIRED'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER tax_st_return_reversal_approval_required BEFORE INSERT ON app.tax_st_return_reversal
  FOR EACH ROW EXECUTE FUNCTION app.tax_st_return_reversal_requires_approval();
