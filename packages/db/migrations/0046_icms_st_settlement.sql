-- SPEC-029/F29: snapshots mensais de complemento/restituição do ICMS-ST.
CREATE TABLE app.tax_st_settlement_snapshot (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES app.tenant(id),
  empresa_id uuid NOT NULL,
  competence date NOT NULL CHECK (extract(day from competence) = 1),
  regime text CHECK (regime IS NULL OR regime IN ('SIMPLES_NACIONAL','LUCRO_PRESUMIDO')),
  revision integer NOT NULL CHECK (revision > 0),
  idempotency_key text NOT NULL CHECK (length(trim(idempotency_key)) BETWEEN 1 AND 200),
  input_sha256 text NOT NULL CHECK (input_sha256 ~ '^[0-9a-f]{64}$'),
  package_id uuid REFERENCES app.tax_resolution_package(id),
  package_sha256 text CHECK (package_sha256 IS NULL OR package_sha256 ~ '^[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN ('BLOCKED','PENDING_REVIEW')),
  gross_restitution_cents bigint CHECK (gross_restitution_cents IS NULL OR gross_restitution_cents >= 0),
  gross_complement_cents bigint CHECK (gross_complement_cents IS NULL OR gross_complement_cents >= 0),
  net_amount_cents bigint,
  line_count integer NOT NULL CHECK (line_count >= 0),
  blocked_line_count integer NOT NULL CHECK (blocked_line_count >= 0 AND blocked_line_count <= line_count),
  facts jsonb NOT NULL,
  reprocessing_reason text,
  actor_id uuid NOT NULL,
  correlation_id text NOT NULL,
  processed_at timestamptz NOT NULL,
  FOREIGN KEY (empresa_id,tenant_id) REFERENCES app.empresa(id,tenant_id),
  UNIQUE (tenant_id,empresa_id,competence,revision),
  UNIQUE (tenant_id,empresa_id,competence,idempotency_key),
  UNIQUE (id,tenant_id,empresa_id),
  CHECK ((status='BLOCKED' AND (blocked_line_count > 0 OR line_count=0) AND gross_restitution_cents IS NULL AND gross_complement_cents IS NULL AND net_amount_cents IS NULL) OR
         (status='PENDING_REVIEW' AND blocked_line_count=0 AND gross_restitution_cents IS NOT NULL AND gross_complement_cents IS NOT NULL AND net_amount_cents IS NOT NULL))
);
CREATE INDEX tax_st_settlement_scope_idx ON app.tax_st_settlement_snapshot(tenant_id,empresa_id,competence DESC,revision DESC);
CREATE INDEX tax_st_settlement_company_idx ON app.tax_st_settlement_snapshot(empresa_id);

CREATE TABLE app.tax_st_settlement_line (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES app.tenant(id),
  empresa_id uuid NOT NULL,
  snapshot_id uuid NOT NULL,
  output_document_id uuid NOT NULL,
  output_item_id text NOT NULL,
  difference_kind text NOT NULL CHECK (difference_kind IN ('RESTITUTION','COMPLEMENT','NONE','INDETERMINATE')),
  restitution_cents bigint CHECK (restitution_cents IS NULL OR restitution_cents >= 0),
  complement_cents bigint CHECK (complement_cents IS NULL OR complement_cents >= 0),
  facts jsonb NOT NULL,
  calculation jsonb NOT NULL,
  recovery_memory jsonb NOT NULL,
  source_ids text[] NOT NULL DEFAULT '{}',
  blocking_reason_codes text[] NOT NULL DEFAULT '{}',
  FOREIGN KEY (snapshot_id,tenant_id,empresa_id) REFERENCES app.tax_st_settlement_snapshot(id,tenant_id,empresa_id),
  FOREIGN KEY (output_document_id,empresa_id,tenant_id) REFERENCES app.fiscal_document(id,empresa_id,tenant_id),
  FOREIGN KEY (empresa_id,tenant_id) REFERENCES app.empresa(id,tenant_id),
  UNIQUE (snapshot_id,output_document_id,output_item_id),
  UNIQUE (id,tenant_id,empresa_id)
);
CREATE INDEX tax_st_settlement_line_scope_idx ON app.tax_st_settlement_line(tenant_id,empresa_id,snapshot_id);
CREATE INDEX tax_st_settlement_line_company_idx ON app.tax_st_settlement_line(empresa_id);

CREATE TABLE app.tax_st_settlement_event (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES app.tenant(id),
  empresa_id uuid NOT NULL,
  snapshot_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('PROCESSED','BLOCKED','SUBMITTED','APPROVED','REJECTED','DRAFT_EXPORTED','REPROCESSED')),
  actor_id uuid NOT NULL,
  correlation_id text NOT NULL,
  occurred_at timestamptz NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  FOREIGN KEY (snapshot_id,tenant_id,empresa_id) REFERENCES app.tax_st_settlement_snapshot(id,tenant_id,empresa_id),
  FOREIGN KEY (empresa_id,tenant_id) REFERENCES app.empresa(id,tenant_id)
);
CREATE INDEX tax_st_settlement_event_scope_idx ON app.tax_st_settlement_event(tenant_id,empresa_id,snapshot_id,occurred_at);
CREATE INDEX tax_st_settlement_event_company_idx ON app.tax_st_settlement_event(empresa_id);

DO $$ DECLARE alvo text; BEGIN
  FOREACH alvo IN ARRAY ARRAY['tax_st_settlement_snapshot','tax_st_settlement_line','tax_st_settlement_event'] LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',alvo);
    EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',alvo);
    EXECUTE format('CREATE POLICY %I ON app.%I FOR SELECT USING (tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id))',alvo||'_select',alvo);
    EXECUTE format('CREATE POLICY %I ON app.%I FOR INSERT WITH CHECK (tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id))',alvo||'_insert',alvo);
    EXECUTE format('CREATE TRIGGER escopo_imutavel BEFORE UPDATE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.proteger_escopo_empresa()',alvo);
  END LOOP;
END $$;
CREATE TRIGGER tax_st_settlement_snapshot_append_only BEFORE UPDATE OR DELETE ON app.tax_st_settlement_snapshot FOR EACH ROW EXECUTE FUNCTION app.rejeitar_escrita_em_historico();
CREATE TRIGGER tax_st_settlement_snapshot_no_truncate BEFORE TRUNCATE ON app.tax_st_settlement_snapshot FOR EACH STATEMENT EXECUTE FUNCTION app.rejeitar_truncate_tax_resolution();
CREATE TRIGGER tax_st_settlement_line_append_only BEFORE UPDATE OR DELETE ON app.tax_st_settlement_line FOR EACH ROW EXECUTE FUNCTION app.rejeitar_escrita_em_historico();
CREATE TRIGGER tax_st_settlement_line_no_truncate BEFORE TRUNCATE ON app.tax_st_settlement_line FOR EACH STATEMENT EXECUTE FUNCTION app.rejeitar_truncate_tax_resolution();
CREATE TRIGGER tax_st_settlement_event_append_only BEFORE UPDATE OR DELETE ON app.tax_st_settlement_event FOR EACH ROW EXECUTE FUNCTION app.rejeitar_escrita_em_historico();
CREATE TRIGGER tax_st_settlement_event_no_truncate BEFORE TRUNCATE ON app.tax_st_settlement_event FOR EACH STATEMENT EXECUTE FUNCTION app.rejeitar_truncate_tax_resolution();
REVOKE ALL ON app.tax_st_settlement_snapshot,app.tax_st_settlement_line,app.tax_st_settlement_event FROM PUBLIC,contaia_app;
GRANT SELECT,INSERT ON app.tax_st_settlement_snapshot,app.tax_st_settlement_line,app.tax_st_settlement_event TO contaia_app;

CREATE OR REPLACE FUNCTION app.tax_st_settlement_process(p_payload jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=app,public,pg_temp AS $$
DECLARE s jsonb:=p_payload->'snapshot'; snapshot_id uuid; tenant uuid; company uuid; actor uuid; item jsonb; event_action text;
BEGIN
  tenant:=app.tenant_atual(); actor:=app.usuario_atual(); company:=(s->>'empresa_id')::uuid;
  IF tenant IS NULL OR actor IS NULL OR NOT app.usuario_ativo_atual() OR NOT app.empresa_autorizada(company) OR
     NOT EXISTS (SELECT 1 FROM app.usuario_papel WHERE usuario_id=actor AND tenant_id=tenant AND removido_em IS NULL
       AND papel IN ('admin_escritorio','contador','auxiliar')) THEN RAISE EXCEPTION 'ICMS_ST_SETTLEMENT_ACCESS_DENIED'; END IF;
  IF (s->>'tenant_id')::uuid<>tenant OR (s->>'actor_id')::uuid<>actor THEN RAISE EXCEPTION 'ICMS_ST_SETTLEMENT_SCOPE_INVALID'; END IF;
  IF EXISTS(SELECT 1 FROM app.tax_st_settlement_snapshot WHERE tenant_id=tenant AND empresa_id=company AND competence=(s->>'competence')::date
      AND idempotency_key=s->>'idempotency_key') THEN RAISE EXCEPTION 'ICMS_ST_SETTLEMENT_IDEMPOTENCY_CONFLICT'; END IF;
  IF (s->>'revision')::int<>coalesce((SELECT max(revision)+1 FROM app.tax_st_settlement_snapshot WHERE tenant_id=tenant AND empresa_id=company
      AND competence=(s->>'competence')::date),1) THEN RAISE EXCEPTION 'ICMS_ST_SETTLEMENT_REVISION_CONFLICT'; END IF;
  INSERT INTO app.tax_st_settlement_snapshot(tenant_id,empresa_id,competence,regime,revision,idempotency_key,input_sha256,package_id,package_sha256,status,
    gross_restitution_cents,gross_complement_cents,net_amount_cents,line_count,blocked_line_count,facts,reprocessing_reason,actor_id,correlation_id,processed_at)
  VALUES(tenant,company,(s->>'competence')::date,nullif(s->>'regime',''),(s->>'revision')::int,s->>'idempotency_key',s->>'input_sha256',
    nullif(s->>'package_id','')::uuid,nullif(s->>'package_sha256',''),s->>'status',nullif(s->>'gross_restitution_cents','')::bigint,
    nullif(s->>'gross_complement_cents','')::bigint,nullif(s->>'net_amount_cents','')::bigint,(s->>'line_count')::int,
    (s->>'blocked_line_count')::int,s->'facts',nullif(s->>'reprocessing_reason',''),actor,s->>'correlation_id',(s->>'processed_at')::timestamptz)
  RETURNING id INTO snapshot_id;
  FOR item IN SELECT value FROM jsonb_array_elements(coalesce(p_payload->'lines','[]'::jsonb)) LOOP
    INSERT INTO app.tax_st_settlement_line(tenant_id,empresa_id,snapshot_id,output_document_id,output_item_id,difference_kind,restitution_cents,
      complement_cents,facts,calculation,recovery_memory,source_ids,blocking_reason_codes)
    VALUES(tenant,company,snapshot_id,(item->>'output_document_id')::uuid,item->>'output_item_id',item->>'difference_kind',
      nullif(item->>'restitution_cents','')::bigint,nullif(item->>'complement_cents','')::bigint,coalesce(item->'facts','{}'::jsonb),coalesce(item->'calculation','{}'::jsonb),
      coalesce(item->'recovery_memory','{}'::jsonb),ARRAY(SELECT jsonb_array_elements_text(coalesce(item->'source_ids','[]'::jsonb))),ARRAY(SELECT jsonb_array_elements_text(coalesce(item->'blocking_reason_codes','[]'::jsonb))));
  END LOOP;
  event_action:=CASE WHEN s->>'status'='BLOCKED' THEN 'BLOCKED' ELSE 'PROCESSED' END;
  INSERT INTO app.tax_st_settlement_event(tenant_id,empresa_id,snapshot_id,action,actor_id,correlation_id,occurred_at,details)
  VALUES(tenant,company,snapshot_id,event_action,actor,s->>'correlation_id',(s->>'processed_at')::timestamptz,coalesce(p_payload->'event_details','{}'::jsonb));
  RETURN snapshot_id;
END; $$;
REVOKE ALL ON FUNCTION app.tax_st_settlement_process(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.tax_st_settlement_process(jsonb) TO contaia_app;

CREATE TABLE app.tax_st_settlement_review_event (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(), tenant_id uuid NOT NULL REFERENCES app.tenant(id), empresa_id uuid NOT NULL,
  snapshot_id uuid NOT NULL, action text NOT NULL CHECK(action IN ('SUBMITTED','APPROVED','REJECTED')),
  actor_id uuid NOT NULL, occurred_at timestamptz NOT NULL, correlation_id text NOT NULL, details jsonb NOT NULL DEFAULT '{}'::jsonb,
  FOREIGN KEY(snapshot_id,tenant_id,empresa_id) REFERENCES app.tax_st_settlement_snapshot(id,tenant_id,empresa_id),
  FOREIGN KEY(empresa_id,tenant_id) REFERENCES app.empresa(id,tenant_id)
);
CREATE INDEX tax_st_settlement_review_scope_idx ON app.tax_st_settlement_review_event(tenant_id,empresa_id,snapshot_id,occurred_at);
CREATE INDEX tax_st_settlement_review_company_idx ON app.tax_st_settlement_review_event(empresa_id);
ALTER TABLE app.tax_st_settlement_review_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.tax_st_settlement_review_event FORCE ROW LEVEL SECURITY;
CREATE POLICY tax_st_settlement_review_select ON app.tax_st_settlement_review_event FOR SELECT USING(tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id));
CREATE TRIGGER tax_st_settlement_review_append_only BEFORE UPDATE OR DELETE ON app.tax_st_settlement_review_event FOR EACH ROW EXECUTE FUNCTION app.rejeitar_escrita_em_historico();
CREATE TRIGGER tax_st_settlement_review_no_truncate BEFORE TRUNCATE ON app.tax_st_settlement_review_event FOR EACH STATEMENT EXECUTE FUNCTION app.rejeitar_truncate_tax_resolution();
CREATE TRIGGER tax_st_settlement_review_scope_immutable BEFORE UPDATE ON app.tax_st_settlement_review_event FOR EACH ROW EXECUTE FUNCTION app.proteger_escopo_empresa();
REVOKE ALL ON app.tax_st_settlement_review_event FROM PUBLIC,contaia_app;
GRANT SELECT ON app.tax_st_settlement_review_event TO contaia_app;

CREATE OR REPLACE FUNCTION app.tax_st_settlement_review(p_id uuid,p_empresa uuid,p_actor uuid,p_expected_revision integer,p_now timestamptz,p_action text,p_reason text,p_correlation text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=app,public,pg_temp AS $$
DECLARE source app.tax_st_settlement_snapshot; latest app.tax_st_settlement_review_event;
BEGIN
  IF p_actor<>app.usuario_atual() OR NOT app.usuario_ativo_atual() OR NOT EXISTS(
    SELECT 1 FROM app.usuario_papel WHERE usuario_id=p_actor AND tenant_id=app.tenant_atual() AND removido_em IS NULL
      AND papel IN ('admin_escritorio','contador','auxiliar')) OR
    (p_action IN ('APPROVED','REJECTED') AND NOT EXISTS(SELECT 1 FROM app.usuario_papel WHERE usuario_id=p_actor AND tenant_id=app.tenant_atual()
      AND removido_em IS NULL AND papel IN ('admin_escritorio','contador'))) THEN RAISE EXCEPTION 'ICMS_ST_SETTLEMENT_REVIEW_FORBIDDEN'; END IF;
  IF p_action NOT IN ('SUBMITTED','APPROVED','REJECTED') OR (p_action='REJECTED' AND length(trim(coalesce(p_reason,'')))<10) THEN
    RAISE EXCEPTION 'ICMS_ST_SETTLEMENT_REVIEW_INVALID'; END IF;
  SELECT * INTO source FROM app.tax_st_settlement_snapshot WHERE id=p_id AND empresa_id=p_empresa AND tenant_id=app.tenant_atual()
    AND app.empresa_autorizada(empresa_id) FOR UPDATE;
  IF source.id IS NULL THEN RAISE EXCEPTION 'ICMS_ST_SETTLEMENT_NOT_FOUND'; END IF;
  IF source.revision<>p_expected_revision THEN RAISE EXCEPTION 'ICMS_ST_SETTLEMENT_REVIEW_CONFLICT'; END IF;
  SELECT * INTO latest FROM app.tax_st_settlement_review_event WHERE snapshot_id=p_id ORDER BY occurred_at DESC,id DESC LIMIT 1;
  IF p_action='SUBMITTED' THEN
    IF source.status<>'PENDING_REVIEW' OR source.blocked_line_count<>0 OR latest.id IS NOT NULL THEN RAISE EXCEPTION 'ICMS_ST_SETTLEMENT_NOT_APPROVABLE'; END IF;
  ELSIF latest.action IS DISTINCT FROM 'SUBMITTED' OR source.status<>'PENDING_REVIEW' OR source.blocked_line_count<>0 OR
    EXISTS(SELECT 1 FROM app.tax_st_settlement_line WHERE snapshot_id=p_id AND difference_kind='INDETERMINATE') THEN RAISE EXCEPTION 'ICMS_ST_SETTLEMENT_REVIEW_CONFLICT';
  END IF;
  INSERT INTO app.tax_st_settlement_review_event(tenant_id,empresa_id,snapshot_id,action,actor_id,occurred_at,correlation_id,details)
  VALUES(source.tenant_id,source.empresa_id,source.id,p_action,p_actor,p_now,p_correlation,
    CASE WHEN p_reason IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('reason',trim(p_reason)) END);
END; $$;
REVOKE ALL ON FUNCTION app.tax_st_settlement_review(uuid,uuid,uuid,integer,timestamptz,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.tax_st_settlement_review(uuid,uuid,uuid,integer,timestamptz,text,text,text) TO contaia_app;
