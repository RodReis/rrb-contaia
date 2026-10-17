-- F23: scheduler de descoberta opaca e gravação técnica validada da projeção.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='contaia_dashboard_scheduler') THEN
    CREATE ROLE contaia_dashboard_scheduler LOGIN PASSWORD 'contaia_dashboard_scheduler_local' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION app.dashboard_health_companies_pending(p_limite integer DEFAULT 500)
RETURNS TABLE(tenant_id uuid,empresa_id uuid) LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
  SELECT e.tenant_id,e.id FROM app.empresa e WHERE e.status='ATIVA' AND e.situacao='ativo'
  ORDER BY e.tenant_id,e.id LIMIT greatest(1,least(p_limite,5000))
$$;
ALTER FUNCTION app.dashboard_health_companies_pending(integer) OWNER TO contaia_dfe_scheduler_owner;
GRANT SELECT ON app.empresa TO contaia_dfe_scheduler_owner;
REVOKE ALL ON FUNCTION app.dashboard_health_companies_pending(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.dashboard_health_companies_pending(integer) TO contaia_dashboard_scheduler;

GRANT SELECT,INSERT,UPDATE ON app.dashboard_health_projection,app.dashboard_health_reason,app.dashboard_health_source_checkpoint TO contaia_dfe_scheduler_owner;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['dashboard_health_projection','dashboard_health_reason','dashboard_health_source_checkpoint'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON app.%I',t||'_select',t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON app.%I',t||'_insert',t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON app.%I',t||'_update',t);
    EXECUTE format('CREATE POLICY %I ON app.%I FOR SELECT USING (tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id))',t||'_select',t);
    EXECUTE format('CREATE POLICY %I ON app.%I FOR INSERT WITH CHECK (tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id))',t||'_insert',t);
    EXECUTE format('CREATE POLICY %I ON app.%I FOR UPDATE USING (tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id)) WITH CHECK (tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id))',t||'_update',t);
  END LOOP;
END $$;
CREATE OR REPLACE FUNCTION app.dashboard_health_projection_replace(p_doc jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE v_tenant uuid; v_empresa uuid; v_correlation text; v_now timestamptz;
BEGIN
  IF NOT app.contexto_tecnico() OR current_setting('app.finalidade',true)<>'PROCESSAMENTO_DE_EMPRESA' THEN
    RAISE EXCEPTION 'contexto técnico inválido' USING ERRCODE='insufficient_privilege';
  END IF;
  v_tenant:=app.tenant_atual(); v_empresa:=app.empresa_tecnica_atual();
  IF v_tenant IS NULL OR v_empresa IS NULL OR (p_doc->>'tenantId')::uuid<>v_tenant OR (p_doc->>'empresaId')::uuid<>v_empresa THEN
    RAISE EXCEPTION 'escopo de projeção divergente' USING ERRCODE='insufficient_privilege';
  END IF;
  v_correlation:=p_doc->>'correlationId'; v_now:=(p_doc->>'atualizadoEm')::timestamptz;
  UPDATE app.dashboard_health_reason SET ativo=false WHERE tenant_id=v_tenant AND empresa_id=v_empresa AND ativo;
  INSERT INTO app.dashboard_health_reason(tenant_id,empresa_id,fonte,codigo,gravidade,origem_id,descricao,data_referencia,atualizado_em,ativo)
    SELECT v_tenant,v_empresa,x.fonte,x.codigo,x.gravidade,x.origem_id,x.descricao,NULLIF(x.data_referencia,'')::date,NULLIF(x.atualizado_em,'')::timestamptz,true
      FROM jsonb_to_recordset(p_doc->'motivos') AS x(fonte text,codigo text,gravidade text,origem_id text,descricao text,data_referencia text,atualizado_em text)
    ON CONFLICT(tenant_id,empresa_id,fonte,codigo,origem_id) DO UPDATE SET gravidade=excluded.gravidade,descricao=excluded.descricao,data_referencia=excluded.data_referencia,atualizado_em=excluded.atualizado_em,ativo=true;
  INSERT INTO app.dashboard_health_projection(tenant_id,empresa_id,cor,resumo,contagens_fontes,contagens_gravidade,revisoes_fontes,atualizado_em,correlation_id)
    VALUES(v_tenant,v_empresa,p_doc->>'cor',p_doc->'resumo',p_doc->'contagensFontes',p_doc->'contagensGravidade',p_doc->'revisoesFontes',v_now,v_correlation)
    ON CONFLICT(tenant_id,empresa_id) DO UPDATE SET cor=excluded.cor,resumo=excluded.resumo,contagens_fontes=excluded.contagens_fontes,contagens_gravidade=excluded.contagens_gravidade,revisoes_fontes=excluded.revisoes_fontes,atualizado_em=excluded.atualizado_em,correlation_id=excluded.correlation_id;
  INSERT INTO app.dashboard_health_source_checkpoint(tenant_id,empresa_id,fonte,revisao,processado_em)
    SELECT v_tenant,v_empresa,key,value,v_now FROM jsonb_each_text(p_doc->'revisoesFontes')
    ON CONFLICT(tenant_id,empresa_id,fonte) DO UPDATE SET revisao=excluded.revisao,processado_em=excluded.processado_em;
END $$;
ALTER FUNCTION app.dashboard_health_projection_replace(jsonb) OWNER TO contaia_dfe_scheduler_owner;
REVOKE ALL ON FUNCTION app.dashboard_health_projection_replace(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.dashboard_health_projection_replace(jsonb) TO contaia_app;
