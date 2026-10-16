-- SPEC-020/F20: configurações versionadas, execução idempotente e análises fiscais explicáveis.
CREATE TABLE app.fiscal_risk_configuration (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(), tenant_id uuid NOT NULL, empresa_id uuid NOT NULL,
  versao integer NOT NULL CHECK (versao > 0), limite_centavos bigint NOT NULL CHECK (limite_centavos >= 0),
  motivo text NOT NULL CHECK (length(btrim(motivo)) BETWEEN 3 AND 500), ator_id uuid NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (empresa_id,tenant_id) REFERENCES app.empresa(id,tenant_id),
  CONSTRAINT fiscal_risk_configuration_version UNIQUE (empresa_id,tenant_id,versao),
  CONSTRAINT fiscal_risk_configuration_scope UNIQUE (id,empresa_id,tenant_id)
);
CREATE INDEX fiscal_risk_configuration_scope_idx ON app.fiscal_risk_configuration(empresa_id,tenant_id,versao DESC);

CREATE TABLE app.fiscal_risk_supplier (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(), tenant_id uuid NOT NULL, empresa_id uuid NOT NULL,
  configuration_id uuid NOT NULL, cnpj text NOT NULL, nome_exibicao text NOT NULL CHECK (length(btrim(nome_exibicao)) BETWEEN 1 AND 200),
  situacao text NOT NULL CHECK (situacao IN ('ATIVO','ARQUIVADO')), motivo text NOT NULL CHECK (length(btrim(motivo)) BETWEEN 3 AND 500),
  ator_id uuid NOT NULL, criado_em timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (empresa_id,tenant_id) REFERENCES app.empresa(id,tenant_id),
  FOREIGN KEY (configuration_id,empresa_id,tenant_id) REFERENCES app.fiscal_risk_configuration(id,empresa_id,tenant_id),
  CONSTRAINT fiscal_risk_supplier_cnpj CHECK (cnpj ~ '^[0-9A-Z]{12}[0-9]{2}$'),
  CONSTRAINT fiscal_risk_supplier_configuration_cnpj UNIQUE (configuration_id,cnpj),
  CONSTRAINT fiscal_risk_supplier_scope UNIQUE (id,empresa_id,tenant_id)
);
CREATE INDEX fiscal_risk_supplier_scope_idx ON app.fiscal_risk_supplier(empresa_id,tenant_id,configuration_id,situacao);

CREATE TABLE app.fiscal_risk_execution (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(), tenant_id uuid NOT NULL, empresa_id uuid NOT NULL, document_id uuid NOT NULL,
  configuration_id uuid NOT NULL, parser_version text NOT NULL, classifier_version text NOT NULL,
  estado text NOT NULL CHECK (estado IN ('AGUARDANDO','PROCESSANDO','CONCLUIDA','INELEGIVEL','ABSTER_SE','FALHA','DLQ')),
  tentativas smallint NOT NULL DEFAULT 0 CHECK (tentativas BETWEEN 0 AND 3), codigo_erro text,
  correlation_id text NOT NULL, ator_id uuid NOT NULL, solicitado_em timestamptz NOT NULL DEFAULT now(), atualizado_em timestamptz NOT NULL DEFAULT now(),
  reprocessamento_de uuid,
  FOREIGN KEY (document_id,empresa_id,tenant_id) REFERENCES app.fiscal_document(id,empresa_id,tenant_id),
  FOREIGN KEY (configuration_id,empresa_id,tenant_id) REFERENCES app.fiscal_risk_configuration(id,empresa_id,tenant_id),
  CONSTRAINT fiscal_risk_execution_identity UNIQUE (tenant_id,empresa_id,document_id,parser_version,classifier_version,configuration_id),
  CONSTRAINT fiscal_risk_execution_scope UNIQUE (id,empresa_id,tenant_id),
  FOREIGN KEY (reprocessamento_de,empresa_id,tenant_id) REFERENCES app.fiscal_risk_execution(id,empresa_id,tenant_id)
);
CREATE INDEX fiscal_risk_execution_scope_idx ON app.fiscal_risk_execution(empresa_id,tenant_id,solicitado_em DESC,id);
CREATE INDEX fiscal_risk_execution_state_idx ON app.fiscal_risk_execution(estado,atualizado_em);

CREATE TABLE app.fiscal_risk_analysis (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(), tenant_id uuid NOT NULL, empresa_id uuid NOT NULL, execution_id uuid NOT NULL,
  document_id uuid NOT NULL, configuration_id uuid NOT NULL, parser_version text NOT NULL, classifier_version text NOT NULL,
  tipo_manifestacao text NOT NULL CHECK (tipo_manifestacao IN ('210200','210220','210240','ABSTER_SE')),
  confianca numeric(18,16) NOT NULL CHECK (confianca BETWEEN 0 AND 1),
  faixa_confianca text NOT NULL CHECK (faixa_confianca IN ('PRONTA_PARA_REVISAO','ATENCAO','INCONCLUSIVA','ABSTER_SE')),
  justificativa text NOT NULL CHECK (length(btrim(justificativa)) BETWEEN 1 AND 2000),
  riscos jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(riscos)='array'),
  evidencias jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(evidencias)='array'),
  lacunas jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(lacunas)='array'),
  origem text NOT NULL CHECK (origem IN ('DETERMINISTICA','LLM','FALLBACK','ABSTENCAO')),
  provedor text, modelo text, versao_prompt text, versao_schema text NOT NULL,
  fallback boolean NOT NULL DEFAULT false, tokens_entrada integer CHECK (tokens_entrada IS NULL OR tokens_entrada >= 0),
  tokens_saida integer CHECK (tokens_saida IS NULL OR tokens_saida >= 0), custo_microusd bigint CHECK (custo_microusd IS NULL OR custo_microusd >= 0),
  duracao_ms integer NOT NULL CHECK (duracao_ms >= 0), correlation_id text NOT NULL, criado_em timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (execution_id,empresa_id,tenant_id) REFERENCES app.fiscal_risk_execution(id,empresa_id,tenant_id),
  FOREIGN KEY (document_id,empresa_id,tenant_id) REFERENCES app.fiscal_document(id,empresa_id,tenant_id),
  FOREIGN KEY (configuration_id,empresa_id,tenant_id) REFERENCES app.fiscal_risk_configuration(id,empresa_id,tenant_id),
  CONSTRAINT fiscal_risk_analysis_execution UNIQUE (execution_id),
  CONSTRAINT fiscal_risk_analysis_scope UNIQUE (id,empresa_id,tenant_id)
);
CREATE INDEX fiscal_risk_analysis_scope_idx ON app.fiscal_risk_analysis(empresa_id,tenant_id,criado_em DESC,id);
CREATE INDEX fiscal_risk_analysis_document_idx ON app.fiscal_risk_analysis(document_id,criado_em DESC,id);

CREATE TABLE app.fiscal_risk_attempt (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(), tenant_id uuid NOT NULL, empresa_id uuid NOT NULL, execution_id uuid NOT NULL,
  numero smallint NOT NULL CHECK (numero BETWEEN 1 AND 3), etapa text NOT NULL CHECK (etapa IN ('DETERMINISTICA','LLM','FALLBACK')),
  resultado text NOT NULL CHECK (resultado IN ('SUCESSO','TIMEOUT','INDISPONIVEL','SAIDA_INVALIDA','CONFLITO','FALHA')),
  provedor text, modelo text, codigo_erro text, tokens_entrada integer CHECK (tokens_entrada IS NULL OR tokens_entrada >= 0),
  tokens_saida integer CHECK (tokens_saida IS NULL OR tokens_saida >= 0), custo_microusd bigint CHECK (custo_microusd IS NULL OR custo_microusd >= 0),
  duracao_ms integer NOT NULL CHECK (duracao_ms >= 0), correlation_id text NOT NULL, iniciado_em timestamptz NOT NULL,
  finalizado_em timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (execution_id,empresa_id,tenant_id) REFERENCES app.fiscal_risk_execution(id,empresa_id,tenant_id),
  CONSTRAINT fiscal_risk_attempt_once UNIQUE (execution_id,numero),
  CONSTRAINT fiscal_risk_attempt_scope UNIQUE (id,empresa_id,tenant_id)
);
CREATE INDEX fiscal_risk_attempt_execution_idx ON app.fiscal_risk_attempt(execution_id,numero);
CREATE INDEX fiscal_risk_attempt_scope_idx ON app.fiscal_risk_attempt(empresa_id,tenant_id,execution_id,numero);

CREATE TABLE app.fiscal_risk_event (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(), tenant_id uuid NOT NULL, empresa_id uuid NOT NULL, execution_id uuid NOT NULL,
  estado text NOT NULL, codigo text, detalhe_sanitizado text, correlation_id text NOT NULL,
  ocorrido_em timestamptz NOT NULL DEFAULT now(), sequencia bigint NOT NULL GENERATED ALWAYS AS IDENTITY,
  FOREIGN KEY (execution_id,empresa_id,tenant_id) REFERENCES app.fiscal_risk_execution(id,empresa_id,tenant_id),
  CONSTRAINT fiscal_risk_event_scope UNIQUE (id,empresa_id,tenant_id)
);
CREATE INDEX fiscal_risk_event_history_idx ON app.fiscal_risk_event(execution_id,ocorrido_em DESC,sequencia DESC);
CREATE INDEX fiscal_risk_event_scope_idx ON app.fiscal_risk_event(empresa_id,tenant_id,execution_id,ocorrido_em DESC);

DO $$ DECLARE alvo text; BEGIN
  FOREACH alvo IN ARRAY ARRAY['fiscal_risk_configuration','fiscal_risk_supplier','fiscal_risk_execution','fiscal_risk_analysis','fiscal_risk_attempt','fiscal_risk_event'] LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',alvo);
    EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',alvo);
    EXECUTE format('CREATE POLICY %I ON app.%I FOR SELECT USING(tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id))',alvo||'_select',alvo);
    EXECUTE format('CREATE POLICY %I ON app.%I FOR INSERT WITH CHECK(tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id))',alvo||'_insert',alvo);
  END LOOP;
END $$;
CREATE POLICY fiscal_risk_execution_update ON app.fiscal_risk_execution FOR UPDATE
  USING(tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id))
  WITH CHECK(tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id));

DO $$ DECLARE alvo text; BEGIN
  FOREACH alvo IN ARRAY ARRAY['fiscal_risk_configuration','fiscal_risk_supplier','fiscal_risk_analysis','fiscal_risk_attempt','fiscal_risk_event'] LOOP
    EXECUTE format('CREATE TRIGGER escopo_imutavel BEFORE UPDATE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.proteger_escopo_empresa()',alvo);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.rejeitar_escrita_em_historico()',alvo||'_append_only',alvo);
  END LOOP;
END $$;
CREATE TRIGGER escopo_imutavel BEFORE UPDATE ON app.fiscal_risk_execution
  FOR EACH ROW EXECUTE FUNCTION app.proteger_escopo_empresa();

GRANT SELECT,INSERT ON app.fiscal_risk_configuration,app.fiscal_risk_supplier,app.fiscal_risk_execution,
  app.fiscal_risk_analysis,app.fiscal_risk_attempt,app.fiscal_risk_event TO contaia_app;
REVOKE UPDATE,DELETE ON app.fiscal_risk_configuration,app.fiscal_risk_supplier,app.fiscal_risk_analysis,
  app.fiscal_risk_attempt,app.fiscal_risk_event,app.fiscal_risk_execution FROM contaia_app;
GRANT UPDATE(estado,tentativas,codigo_erro,atualizado_em) ON app.fiscal_risk_execution TO contaia_app;
