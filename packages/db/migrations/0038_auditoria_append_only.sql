-- SPEC-024/F24: ledger transversal imutavel; payload integral fica separado.
CREATE TABLE app.audit_event (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES app.tenant(id), empresa_id uuid NOT NULL,
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version > 0),
  event_type text NOT NULL, origin text NOT NULL, occurred_at timestamptz NOT NULL,
  actor_id uuid, actor_kind text NOT NULL CHECK (actor_kind IN ('HUMAN','AGENT','SYSTEM','RULE')),
  actor_role text, agent text, agent_version text, model text, provider text,
  source_type text NOT NULL, source_id uuid NOT NULL, decision text, state text,
  score numeric(18,16) CHECK (score IS NULL OR score BETWEEN 0 AND 1),
  measured_cost_microusd bigint CHECK (measured_cost_microusd IS NULL OR measured_cost_microusd >= 0),
  input_tokens integer CHECK (input_tokens IS NULL OR input_tokens >= 0), output_tokens integer CHECK (output_tokens IS NULL OR output_tokens >= 0),
  correlation_id text NOT NULL, causation_id uuid, idempotency_key text NOT NULL,
  envelope jsonb NOT NULL, envelope_sha256 text NOT NULL CHECK (envelope_sha256 ~ '^[0-9a-f]{64}$'),
  payload_sha256 text CHECK (payload_sha256 IS NULL OR payload_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT audit_event_scope FOREIGN KEY (empresa_id,tenant_id) REFERENCES app.empresa(id,tenant_id),
  CONSTRAINT audit_event_actor FOREIGN KEY (actor_id,tenant_id) REFERENCES app.usuario(id,tenant_id),
  CONSTRAINT audit_event_idempotency UNIQUE (tenant_id,idempotency_key)
);
CREATE INDEX audit_event_timeline_idx ON app.audit_event(tenant_id,empresa_id,occurred_at DESC,id DESC);
CREATE INDEX audit_event_tenant_idx ON app.audit_event(tenant_id);
CREATE INDEX audit_event_empresa_idx ON app.audit_event(empresa_id);
CREATE INDEX audit_event_correlation_idx ON app.audit_event(tenant_id,correlation_id,occurred_at,id);
CREATE INDEX audit_event_filters_idx ON app.audit_event(tenant_id,event_type,state,actor_id,occurred_at DESC);

CREATE TABLE app.audit_payload (
  event_id uuid PRIMARY KEY REFERENCES app.audit_event(id), tenant_id uuid NOT NULL, empresa_id uuid NOT NULL,
  payload jsonb NOT NULL, payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL DEFAULT (now() + interval '12 months'),
  CONSTRAINT audit_payload_scope FOREIGN KEY (empresa_id,tenant_id) REFERENCES app.empresa(id,tenant_id),
  CONSTRAINT audit_payload_timing CHECK (expires_at >= created_at)
);
CREATE INDEX audit_payload_expiry_idx ON app.audit_payload(expires_at);
CREATE INDEX audit_payload_tenant_idx ON app.audit_payload(tenant_id);
CREATE INDEX audit_payload_empresa_idx ON app.audit_payload(empresa_id);

CREATE TABLE app.audit_export_manifest (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(), tenant_id uuid NOT NULL REFERENCES app.tenant(id), empresa_id uuid NOT NULL,
  requested_by uuid NOT NULL, format text NOT NULL CHECK (format IN ('JSON','CSV')),
  filters jsonb NOT NULL, item_count integer NOT NULL CHECK(item_count >= 0), schema_version integer NOT NULL,
  artifact_sha256 text NOT NULL CHECK(artifact_sha256 ~ '^[0-9a-f]{64}$'), created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_export_scope FOREIGN KEY (empresa_id,tenant_id) REFERENCES app.empresa(id,tenant_id),
  CONSTRAINT audit_export_actor FOREIGN KEY (requested_by,tenant_id) REFERENCES app.usuario(id,tenant_id)
);
CREATE INDEX audit_export_manifest_tenant_idx ON app.audit_export_manifest(tenant_id);
CREATE INDEX audit_export_manifest_empresa_idx ON app.audit_export_manifest(empresa_id);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['audit_event','audit_payload','audit_export_manifest'] LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY %I ON app.%I FOR SELECT USING (tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id))',t||'_select',t);
  END LOOP;
  CREATE POLICY audit_payload_expiry_delete ON app.audit_payload FOR DELETE USING (tenant_id=app.tenant_atual() AND app.contexto_tecnico() AND expires_at <= now());
  CREATE POLICY audit_export_insert ON app.audit_export_manifest FOR INSERT WITH CHECK (tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id));
END $$;
CREATE TRIGGER audit_event_no_mutation BEFORE UPDATE OR DELETE ON app.audit_event FOR EACH ROW EXECUTE FUNCTION app.rejeitar_escrita_em_historico();
CREATE TRIGGER audit_export_no_mutation BEFORE UPDATE OR DELETE ON app.audit_export_manifest FOR EACH ROW EXECUTE FUNCTION app.rejeitar_escrita_em_historico();
CREATE TRIGGER escopo_imutavel BEFORE UPDATE ON app.audit_event FOR EACH ROW EXECUTE FUNCTION app.proteger_escopo_empresa();
CREATE TRIGGER escopo_imutavel BEFORE UPDATE ON app.audit_export_manifest FOR EACH ROW EXECUTE FUNCTION app.proteger_escopo_empresa();
CREATE TRIGGER escopo_imutavel BEFORE UPDATE ON app.audit_payload FOR EACH ROW EXECUTE FUNCTION app.proteger_escopo_empresa();
REVOKE ALL ON app.audit_event,app.audit_payload,app.audit_export_manifest FROM contaia_app;
GRANT SELECT ON app.audit_event,app.audit_payload,app.audit_export_manifest TO contaia_app;

-- Escrita executada pelo gatilho na mesma transacao da mudanca de origem.
CREATE OR REPLACE FUNCTION app.audit_capture_source() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE v jsonb; p jsonb; v_type text; v_state text; v_actor uuid; v_correlation text;
  v_source uuid; v_tenant uuid; v_company uuid; v_kind text; v_agent text; v_model text;
  v_provider text; v_decision text; v_score numeric; v_cost bigint; v_in integer; v_out integer; v_causation uuid;
  v_key text; v_hash text; v_payload_hash text; v_id uuid; v_pair record;
BEGIN
  v:=to_jsonb(NEW);
  v_tenant:=(v->>'tenant_id')::uuid; v_company:=(v->>'empresa_id')::uuid;
  v_source:=(v->>'id')::uuid;
  v_correlation:=COALESCE(v->>'correlation_id','audit:'||v_source::text);
  v_state:=COALESCE(v->>'estado',v->>'estado_novo',v->>'resultado');
  v_actor:=NULLIF(COALESCE(v->>'ator_id',v->>'aprovador_id',v->>'autor_id',v->>'requested_by'),'')::uuid;
  v_kind:=CASE
    WHEN TG_TABLE_NAME='fiscal_risk_analysis' THEN CASE WHEN v->>'origem'='LLM' THEN 'AGENT' ELSE 'RULE' END
    WHEN TG_TABLE_NAME='fiscal_risk_attempt' THEN CASE WHEN v->>'etapa'='LLM' THEN 'AGENT' ELSE 'RULE' END
    WHEN TG_TABLE_NAME='obligation_event' AND v_actor IS NULL THEN 'RULE'
    WHEN v_actor IS NOT NULL THEN 'HUMAN' ELSE 'SYSTEM' END;
  v_agent:=CASE WHEN TG_TABLE_NAME IN ('fiscal_risk_analysis','fiscal_risk_execution','fiscal_risk_attempt') THEN 'Agente de Captura' END;
  v_model:=COALESCE(v->>'modelo',v->>'model'); v_provider:=COALESCE(v->>'provedor',v->>'provider'); v_decision:=COALESCE(v->>'tipo_manifestacao',v->>'acao',v->>'estado');
  v_score:=NULLIF(v->>'confianca','')::numeric; v_cost:=NULLIF(v->>'custo_microusd','')::bigint;
  v_in:=NULLIF(v->>'tokens_entrada','')::integer; v_out:=NULLIF(v->>'tokens_saida','')::integer;
  IF TG_TABLE_NAME='fiscal_manifestation' THEN
    -- A decisão humana F21 já tem sua trilha própria; a F24 registra apenas a proposta de agente.
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME='obligation_event' AND v_actor IS NOT NULL THEN
    -- Baixas/reaberturas humanas ficam no histórico da F22; somente eventos de regra entram aqui.
    RETURN NEW;
  END IF;
  v_type:=CASE TG_TABLE_NAME
    WHEN 'fiscal_risk_execution' THEN 'agent.execution.'||lower(COALESCE(v_state,'requested'))
    WHEN 'fiscal_risk_analysis' THEN 'agent.decision.'||lower(COALESCE(v_decision,'recorded'))
    WHEN 'fiscal_risk_attempt' THEN 'agent.attempt.'||lower(COALESCE(v->>'resultado','recorded'))
    WHEN 'fiscal_risk_event' THEN 'agent.execution.lifecycle.'||lower(COALESCE(v->>'estado','recorded'))
    WHEN 'fiscal_manifestation_event' THEN 'fiscal.transmission.'||lower(COALESCE(v_state,'recorded'))
    WHEN 'obligation_event' THEN 'compliance.rule.'||lower(COALESCE(v->>'acao','recorded'))
    ELSE 'source.event' END;
  IF TG_OP='UPDATE' THEN v_actor:=NULL; v_kind:='SYSTEM'; END IF;
  v_key:=TG_TABLE_NAME||':'||v_source::text||':'||TG_OP||':'||COALESCE(v_state,'created')||':'||COALESCE(v->>'tentativas','0')||':'||COALESCE(v->>'codigo_erro','');
  p:=v;
  -- Payload separado, removendo segredos mesmo se o schema de origem evoluir.
  FOR v_pair IN SELECT key FROM jsonb_each(p) WHERE lower(key) ~ '(secret|password|credential|private.?key|certificate.?pem|token_value)' LOOP
    p:=p-v_pair.key;
  END LOOP;
  -- Payload table is separate; source event contains only stable metadata.
  v_id:=app.uuid_v7();
  v_causation:=NULLIF(COALESCE(p->>'execution_id',p->>'analysis_id',p->>'manifestation_id',p->>'occurrence_id',p->>'document_id'),'')::uuid;
  v:=jsonb_build_object('id',v_id,'schema_version',1,'table',TG_TABLE_NAME,'tenant_id',v_tenant,'empresa_id',v_company,
       'event_type',v_type,'state',v_state,'actor_id',v_actor,'correlation_id',v_correlation,
       'source_id',v_source,'causation_id',v_causation,
       'decision',v_decision,'agent',v_agent,'agent_version',COALESCE(p->>'classifier_version',p->>'versao'),
       'model',v_model,'provider',v_provider,'score',v_score,'measured_cost_microusd',v_cost,
       'input_tokens',v_in,'output_tokens',v_out);
  v_hash:=encode(public.digest(convert_to(v::text,'UTF8'),'sha256'),'hex');
  v_payload_hash:=encode(public.digest(convert_to(p::text,'UTF8'),'sha256'),'hex');
  INSERT INTO app.audit_event(id,tenant_id,empresa_id,event_type,origin,occurred_at,actor_id,actor_kind,agent,agent_version,model,provider,
    source_type,source_id,decision,state,score,measured_cost_microusd,input_tokens,output_tokens,correlation_id,causation_id,idempotency_key,envelope,envelope_sha256,payload_sha256)
  VALUES(v_id,v_tenant,v_company,v_type,TG_TABLE_NAME,COALESCE(NULLIF(COALESCE(p->>'criado_em',p->>'solicitado_em',p->>'ocorrido_em'), '')::timestamptz,now()),
    v_actor,v_kind,v_agent,COALESCE(p->>'classifier_version',p->>'versao'),v_model,v_provider,TG_TABLE_NAME,v_source,v_decision,v_state,v_score,v_cost,v_in,v_out,v_correlation,
    v_causation,v_key,v,v_hash,v_payload_hash) ON CONFLICT(tenant_id,idempotency_key) DO NOTHING RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN
    INSERT INTO app.audit_payload(event_id,tenant_id,empresa_id,payload,payload_sha256)
    VALUES(v_id,v_tenant,v_company,p,v_payload_hash);
  END IF;
  RETURN NEW;
END $$;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['fiscal_risk_execution','fiscal_risk_analysis','fiscal_risk_attempt','fiscal_risk_event','fiscal_manifestation_event','obligation_event'] LOOP
    EXECUTE format('CREATE TRIGGER audit_capture AFTER INSERT ON app.%I FOR EACH ROW EXECUTE FUNCTION app.audit_capture_source()',t);
  END LOOP;
END $$;
CREATE TRIGGER audit_capture_execution_update AFTER UPDATE OF estado,tentativas,codigo_erro ON app.fiscal_risk_execution
  FOR EACH ROW WHEN (OLD.estado IS DISTINCT FROM NEW.estado OR OLD.tentativas IS DISTINCT FROM NEW.tentativas OR OLD.codigo_erro IS DISTINCT FROM NEW.codigo_erro)
  EXECUTE FUNCTION app.audit_capture_source();
GRANT INSERT ON app.audit_export_manifest TO contaia_app;

CREATE OR REPLACE FUNCTION app.audit_payload_expired_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE e jsonb; h text; k text;
BEGIN
  e:=jsonb_build_object('event_type','audit.payload.expired','origin','audit_payload','tenant_id',OLD.tenant_id,
    'empresa_id',OLD.empresa_id,'occurred_at',now(),'actor_kind','SYSTEM','source_type','audit_payload',
    'source_id',OLD.event_id,'causation_id',OLD.event_id,'correlation_id','retention:'||OLD.event_id::text,
    'payload_sha256',OLD.payload_sha256,'state','EXPIRADO');
  h:=encode(public.digest(convert_to(e::text,'UTF8'),'sha256'),'hex');
  k:='audit_payload:expired:'||OLD.event_id::text;
  INSERT INTO app.audit_event(tenant_id,empresa_id,event_type,origin,occurred_at,actor_kind,source_type,source_id,
    state,correlation_id,causation_id,idempotency_key,envelope,envelope_sha256,payload_sha256)
  VALUES(OLD.tenant_id,OLD.empresa_id,'audit.payload.expired','audit_payload',now(),'SYSTEM','audit_payload',
    OLD.event_id,'EXPIRADO','retention:'||OLD.event_id::text,OLD.event_id,k,e,h,OLD.payload_sha256)
  ON CONFLICT(tenant_id,idempotency_key) DO NOTHING;
  RETURN OLD;
END $$;
CREATE TRIGGER audit_payload_expired_event AFTER DELETE ON app.audit_payload FOR EACH ROW EXECUTE FUNCTION app.audit_payload_expired_event();

CREATE OR REPLACE FUNCTION app.audit_expire_payloads() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE v_count integer;
BEGIN
  IF NOT app.contexto_tecnico() THEN RAISE EXCEPTION 'expiracao de payload exige contexto tecnico' USING ERRCODE='42501'; END IF;
  DELETE FROM app.audit_payload WHERE tenant_id=app.tenant_atual() AND expires_at<=now();
  GET DIAGNOSTICS v_count=ROW_COUNT;
  RETURN v_count;
END $$;
GRANT EXECUTE ON FUNCTION app.audit_expire_payloads() TO contaia_app;
