-- SPEC-023/F23: projeção derivada da saúde operacional por empresa.
CREATE TABLE app.dashboard_health_projection (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(), tenant_id uuid NOT NULL REFERENCES app.tenant(id), empresa_id uuid NOT NULL,
  cor text NOT NULL CHECK (cor IN ('VERMELHO','AMARELO','VERDE')), resumo jsonb NOT NULL DEFAULT '{}'::jsonb,
  contagens_fontes jsonb NOT NULL DEFAULT '{}'::jsonb, contagens_gravidade jsonb NOT NULL DEFAULT '{}'::jsonb,
  revisoes_fontes jsonb NOT NULL DEFAULT '{}'::jsonb, atualizado_em timestamptz NOT NULL DEFAULT now(), correlation_id text NOT NULL,
  CONSTRAINT dashboard_health_projection_scope FOREIGN KEY (empresa_id,tenant_id) REFERENCES app.empresa(id,tenant_id),
  CONSTRAINT dashboard_health_projection_company UNIQUE (tenant_id,empresa_id)
);
CREATE INDEX dashboard_health_projection_tenant_idx ON app.dashboard_health_projection(tenant_id);
CREATE INDEX dashboard_health_projection_empresa_idx ON app.dashboard_health_projection(empresa_id,tenant_id);
CREATE INDEX dashboard_health_projection_color_idx ON app.dashboard_health_projection(tenant_id,cor,empresa_id);

CREATE TABLE app.dashboard_health_reason (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(), tenant_id uuid NOT NULL REFERENCES app.tenant(id), empresa_id uuid NOT NULL,
  fonte text NOT NULL CHECK (fonte IN ('PENDENCIAS','CERTIFICADOS','CAPTURA','MANIFESTACOES','OBRIGACOES')),
  codigo text NOT NULL, gravidade text NOT NULL CHECK (gravidade IN ('VERMELHO','AMARELO')), origem_id text NOT NULL,
  descricao text NOT NULL, data_referencia date, atualizado_em timestamptz, ativo boolean NOT NULL DEFAULT true,
  CONSTRAINT dashboard_health_reason_scope FOREIGN KEY (empresa_id,tenant_id) REFERENCES app.empresa(id,tenant_id),
  CONSTRAINT dashboard_health_reason_identity UNIQUE (tenant_id,empresa_id,fonte,codigo,origem_id)
);
CREATE INDEX dashboard_health_reason_tenant_idx ON app.dashboard_health_reason(tenant_id);
CREATE INDEX dashboard_health_reason_empresa_idx ON app.dashboard_health_reason(empresa_id,tenant_id);
CREATE INDEX dashboard_health_reason_fonte_idx ON app.dashboard_health_reason(tenant_id,empresa_id,fonte,gravidade);
CREATE INDEX dashboard_health_reason_active_idx ON app.dashboard_health_reason(tenant_id,empresa_id,ativo,fonte,gravidade);

CREATE TABLE app.dashboard_health_source_checkpoint (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(), tenant_id uuid NOT NULL REFERENCES app.tenant(id), empresa_id uuid NOT NULL,
  fonte text NOT NULL CHECK (fonte IN ('PENDENCIAS','CERTIFICADOS','CAPTURA','MANIFESTACOES','OBRIGACOES')),
  revisao text NOT NULL, processado_em timestamptz NOT NULL,
  CONSTRAINT dashboard_health_checkpoint_scope FOREIGN KEY (empresa_id,tenant_id) REFERENCES app.empresa(id,tenant_id),
  CONSTRAINT dashboard_health_checkpoint_identity UNIQUE (tenant_id,empresa_id,fonte)
);
CREATE INDEX dashboard_health_checkpoint_tenant_idx ON app.dashboard_health_source_checkpoint(tenant_id);
CREATE INDEX dashboard_health_checkpoint_empresa_idx ON app.dashboard_health_source_checkpoint(empresa_id,tenant_id);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['dashboard_health_projection','dashboard_health_reason','dashboard_health_source_checkpoint'] LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY %I ON app.%I FOR SELECT USING (tenant_id=app.tenant_atual() AND (app.empresa_autorizada(empresa_id) OR (app.contexto_tecnico() AND empresa_id=app.empresa_tecnica_atual() AND current_setting(''app.finalidade'',true)=''PROCESSAMENTO_DE_EMPRESA'')))',t||'_select',t);
    EXECUTE format('CREATE POLICY %I ON app.%I FOR INSERT WITH CHECK (tenant_id=app.tenant_atual() AND (app.empresa_autorizada(empresa_id) OR (app.contexto_tecnico() AND empresa_id=app.empresa_tecnica_atual() AND current_setting(''app.finalidade'',true)=''PROCESSAMENTO_DE_EMPRESA'')))',t||'_insert',t);
    EXECUTE format('CREATE POLICY %I ON app.%I FOR UPDATE USING (tenant_id=app.tenant_atual() AND (app.empresa_autorizada(empresa_id) OR (app.contexto_tecnico() AND empresa_id=app.empresa_tecnica_atual() AND current_setting(''app.finalidade'',true)=''PROCESSAMENTO_DE_EMPRESA''))) WITH CHECK (tenant_id=app.tenant_atual() AND (app.empresa_autorizada(empresa_id) OR (app.contexto_tecnico() AND empresa_id=app.empresa_tecnica_atual() AND current_setting(''app.finalidade'',true)=''PROCESSAMENTO_DE_EMPRESA'')))',t||'_update',t);
    EXECUTE format('CREATE TRIGGER escopo_imutavel BEFORE UPDATE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.proteger_escopo_empresa()',t);
    EXECUTE format('CREATE INDEX %I ON app.%I (empresa_id,tenant_id)',t||'_empresa_tenant_idx',t);
  END LOOP;
END $$;
GRANT SELECT,INSERT,UPDATE ON app.dashboard_health_projection,app.dashboard_health_reason,app.dashboard_health_source_checkpoint TO contaia_app;
REVOKE DELETE ON app.dashboard_health_projection,app.dashboard_health_reason,app.dashboard_health_source_checkpoint FROM contaia_app;
