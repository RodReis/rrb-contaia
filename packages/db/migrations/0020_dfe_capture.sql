-- SPEC-017/F17 — captura DF-e por NSU, staging opaco e trilha operacional.
-- Conteúdo bruto existe somente em `dfe_capture_staging`; nunca em evento, execução ou estado.

CREATE TABLE app.dfe_capture_state (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES app.tenant(id),
  empresa_id uuid NOT NULL,
  cnpj text NOT NULL CHECK (cnpj ~ '^\d{14}$'),
  ult_nsu text NOT NULL DEFAULT '0' CHECK (ult_nsu ~ '^\d{1,15}$'),
  max_nsu text NOT NULL DEFAULT '0' CHECK (max_nsu ~ '^\d{1,15}$'),
  tempo_medio_ms integer NOT NULL DEFAULT 0 CHECK (tempo_medio_ms >= 0),
  proximo_instante_permitido timestamptz NOT NULL DEFAULT '1970-01-01T00:00:00Z',
  estado text NOT NULL DEFAULT 'READY'
    CHECK (estado IN ('READY', 'WAITING', 'CAPTURING', 'BLOCKED_656', 'FAILED', 'DISABLED')),
  bloqueado_ate timestamptz,
  falhas_consecutivas integer NOT NULL DEFAULT 0 CHECK (falhas_consecutivas >= 0),
  ultimo_sucesso_em timestamptz,
  ultimo_erro_codigo text,
  versao integer NOT NULL DEFAULT 1 CHECK (versao > 0),
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT dfe_capture_state_empresa_do_tenant
    FOREIGN KEY (empresa_id, tenant_id) REFERENCES app.empresa (id, tenant_id),
  CONSTRAINT dfe_capture_state_escopo UNIQUE (id, empresa_id, tenant_id),
  CONSTRAINT dfe_capture_state_cnpj_unico UNIQUE (tenant_id, empresa_id, cnpj),
  CONSTRAINT dfe_capture_state_bloqueio_condizente CHECK (
    (estado = 'BLOCKED_656') = (bloqueado_ate IS NOT NULL)
  )
);

CREATE INDEX dfe_capture_state_tenant_id_idx ON app.dfe_capture_state (tenant_id);
CREATE INDEX dfe_capture_state_empresa_id_idx ON app.dfe_capture_state (empresa_id);
CREATE INDEX dfe_capture_state_scheduler_idx
  ON app.dfe_capture_state (proximo_instante_permitido, empresa_id)
  WHERE estado IN ('READY', 'WAITING');

CREATE TABLE app.dfe_capture_run (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES app.tenant(id),
  empresa_id uuid NOT NULL,
  estado_id uuid NOT NULL,
  cnpj text NOT NULL CHECK (cnpj ~ '^\d{14}$'),
  origem text NOT NULL CHECK (origem IN ('AUTOMATIC', 'MANUAL')),
  usuario_originador_id uuid,
  chave_idempotente text NOT NULL CHECK (length(chave_idempotente) BETWEEN 8 AND 128),
  correlation_id text NOT NULL,
  estado text NOT NULL DEFAULT 'QUEUED'
    CHECK (estado IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'DEAD', 'BLOCKED_656')),
  tentativa integer NOT NULL DEFAULT 0 CHECK (tentativa BETWEEN 0 AND 3),
  ult_nsu_entrada text NOT NULL CHECK (ult_nsu_entrada ~ '^\d{1,15}$'),
  ult_nsu_retorno text CHECK (ult_nsu_retorno IS NULL OR ult_nsu_retorno ~ '^\d{1,15}$'),
  max_nsu_retorno text CHECK (max_nsu_retorno IS NULL OR max_nsu_retorno ~ '^\d{1,15}$'),
  quantidade_recebida integer NOT NULL DEFAULT 0 CHECK (quantidade_recebida BETWEEN 0 AND 50),
  quantidade_criada integer NOT NULL DEFAULT 0 CHECK (quantidade_criada BETWEEN 0 AND 50),
  quantidade_deduplicada integer NOT NULL DEFAULT 0 CHECK (quantidade_deduplicada BETWEEN 0 AND 50),
  codigo text,
  iniciado_em timestamptz,
  finalizado_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now(),
  sequencia bigint NOT NULL GENERATED ALWAYS AS IDENTITY,

  CONSTRAINT dfe_capture_run_empresa_do_tenant
    FOREIGN KEY (empresa_id, tenant_id) REFERENCES app.empresa (id, tenant_id),
  CONSTRAINT dfe_capture_run_estado_da_empresa
    FOREIGN KEY (estado_id, empresa_id, tenant_id)
    REFERENCES app.dfe_capture_state (id, empresa_id, tenant_id),
  CONSTRAINT dfe_capture_run_escopo UNIQUE (id, empresa_id, tenant_id),
  CONSTRAINT dfe_capture_run_originador_do_tenant
    FOREIGN KEY (usuario_originador_id, tenant_id) REFERENCES app.usuario (id, tenant_id),
  CONSTRAINT dfe_capture_run_chave_unica UNIQUE (tenant_id, empresa_id, chave_idempotente),
  CONSTRAINT dfe_capture_run_terminal_condizente CHECK (
    (estado IN ('SUCCEEDED', 'FAILED', 'DEAD', 'BLOCKED_656')) = (finalizado_em IS NOT NULL)
  )
);

CREATE UNIQUE INDEX dfe_capture_run_um_pendente_por_cnpj
  ON app.dfe_capture_run (tenant_id, empresa_id, cnpj)
  WHERE estado IN ('QUEUED', 'RUNNING');
CREATE INDEX dfe_capture_run_tenant_id_idx ON app.dfe_capture_run (tenant_id);
CREATE INDEX dfe_capture_run_empresa_id_idx ON app.dfe_capture_run (empresa_id);
CREATE INDEX dfe_capture_run_historico_idx
  ON app.dfe_capture_run (empresa_id, criado_em DESC, sequencia DESC);
CREATE INDEX dfe_capture_run_idempotencia_idx
  ON app.dfe_capture_run (tenant_id, empresa_id, chave_idempotente);

CREATE TABLE app.dfe_capture_staging (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES app.tenant(id),
  empresa_id uuid NOT NULL,
  run_id uuid NOT NULL,
  cnpj text NOT NULL CHECK (cnpj ~ '^\d{14}$'),
  nsu text NOT NULL CHECK (nsu ~ '^\d{1,15}$'),
  chave_acesso text CHECK (chave_acesso IS NULL OR chave_acesso ~ '^\d{44}$'),
  especie text NOT NULL CHECK (especie IN ('NFE_55', 'CTE')),
  conteudo_bruto bytea NOT NULL CHECK (octet_length(conteudo_bruto) > 0),
  disponibilizado_em timestamptz,
  capturado_em timestamptz NOT NULL,
  correlation_id text NOT NULL,

  CONSTRAINT dfe_capture_staging_empresa_do_tenant
    FOREIGN KEY (empresa_id, tenant_id) REFERENCES app.empresa (id, tenant_id),
  CONSTRAINT dfe_capture_staging_run_da_empresa
    FOREIGN KEY (run_id, empresa_id, tenant_id)
    REFERENCES app.dfe_capture_run (id, empresa_id, tenant_id),
  CONSTRAINT dfe_capture_staging_nsu_unico UNIQUE (tenant_id, empresa_id, cnpj, nsu)
);

CREATE UNIQUE INDEX dfe_capture_staging_chave_unica
  ON app.dfe_capture_staging (tenant_id, empresa_id, chave_acesso)
  WHERE chave_acesso IS NOT NULL;
CREATE INDEX dfe_capture_staging_tenant_id_idx ON app.dfe_capture_staging (tenant_id);
CREATE INDEX dfe_capture_staging_empresa_id_idx ON app.dfe_capture_staging (empresa_id);

CREATE TABLE app.dfe_capture_event (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES app.tenant(id),
  empresa_id uuid NOT NULL,
  run_id uuid,
  cnpj text NOT NULL CHECK (cnpj ~ '^\d{14}$'),
  tipo text NOT NULL CHECK (tipo IN ('QUEUED', 'STARTED', 'SUCCEEDED', 'FAILED', 'DEAD', 'BLOCKED_656', 'RECOVERED')),
  codigo text,
  tentativa integer NOT NULL CHECK (tentativa BETWEEN 0 AND 3),
  correlation_id text NOT NULL,
  ocorrido_em timestamptz NOT NULL,
  sequencia bigint NOT NULL GENERATED ALWAYS AS IDENTITY,

  CONSTRAINT dfe_capture_event_empresa_do_tenant
    FOREIGN KEY (empresa_id, tenant_id) REFERENCES app.empresa (id, tenant_id),
  CONSTRAINT dfe_capture_event_run_da_empresa
    FOREIGN KEY (run_id, empresa_id, tenant_id)
    REFERENCES app.dfe_capture_run (id, empresa_id, tenant_id)
);

CREATE INDEX dfe_capture_event_tenant_id_idx ON app.dfe_capture_event (tenant_id);
CREATE INDEX dfe_capture_event_empresa_id_idx ON app.dfe_capture_event (empresa_id);
CREATE INDEX dfe_capture_event_historico_idx
  ON app.dfe_capture_event (empresa_id, ocorrido_em DESC, sequencia DESC);

CREATE TRIGGER dfe_capture_event_append_only
  BEFORE UPDATE OR DELETE ON app.dfe_capture_event
  FOR EACH ROW EXECUTE FUNCTION app.rejeitar_escrita_em_historico();
CREATE TRIGGER dfe_capture_staging_immutavel
  BEFORE UPDATE OR DELETE ON app.dfe_capture_staging
  FOR EACH ROW EXECUTE FUNCTION app.rejeitar_escrita_em_historico();

CREATE TRIGGER escopo_imutavel BEFORE UPDATE ON app.dfe_capture_staging
  FOR EACH ROW EXECUTE FUNCTION app.proteger_escopo_empresa();
CREATE TRIGGER escopo_imutavel BEFORE UPDATE ON app.dfe_capture_event
  FOR EACH ROW EXECUTE FUNCTION app.proteger_escopo_empresa();

DO $$
DECLARE
  alvo text;
  comando text;
BEGIN
  FOREACH alvo IN ARRAY ARRAY['dfe_capture_state', 'dfe_capture_run', 'dfe_capture_staging', 'dfe_capture_event'] LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', alvo);
    EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY', alvo);
    EXECUTE format(
      'CREATE POLICY %I ON app.%I FOR SELECT USING (tenant_id = app.tenant_atual() AND app.empresa_autorizada(empresa_id))',
      alvo || '_select', alvo);
    EXECUTE format(
      'CREATE POLICY %I ON app.%I FOR INSERT WITH CHECK (tenant_id = app.tenant_atual() AND app.empresa_autorizada(empresa_id))',
      alvo || '_insert', alvo);
    IF alvo IN ('dfe_capture_state', 'dfe_capture_run') THEN
      EXECUTE format(
        'CREATE POLICY %I ON app.%I FOR UPDATE USING (tenant_id = app.tenant_atual() AND app.empresa_autorizada(empresa_id)) WITH CHECK (tenant_id = app.tenant_atual() AND app.empresa_autorizada(empresa_id))',
        alvo || '_update', alvo);
    END IF;
  END LOOP;
END
$$;

CREATE TRIGGER escopo_imutavel BEFORE UPDATE ON app.dfe_capture_state
  FOR EACH ROW EXECUTE FUNCTION app.proteger_escopo_empresa();
CREATE TRIGGER escopo_imutavel BEFORE UPDATE ON app.dfe_capture_run
  FOR EACH ROW EXECUTE FUNCTION app.proteger_escopo_empresa();

GRANT SELECT, INSERT ON app.dfe_capture_state, app.dfe_capture_run,
  app.dfe_capture_staging, app.dfe_capture_event TO contaia_app;

REVOKE UPDATE ON app.dfe_capture_state, app.dfe_capture_run, app.dfe_capture_staging, app.dfe_capture_event FROM contaia_app;
GRANT UPDATE (ult_nsu, max_nsu, tempo_medio_ms, proximo_instante_permitido, estado, bloqueado_ate,
              falhas_consecutivas, ultimo_sucesso_em, ultimo_erro_codigo, versao, atualizado_em)
  ON app.dfe_capture_state TO contaia_app;
GRANT UPDATE (estado, tentativa, ult_nsu_retorno, max_nsu_retorno, quantidade_recebida,
              quantidade_criada, quantidade_deduplicada, codigo, iniciado_em, finalizado_em)
  ON app.dfe_capture_run TO contaia_app;

REVOKE DELETE ON app.dfe_capture_state, app.dfe_capture_run,
  app.dfe_capture_staging, app.dfe_capture_event FROM contaia_app;
