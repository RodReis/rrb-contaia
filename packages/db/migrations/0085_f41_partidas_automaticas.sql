-- SPEC-041/F41: regras determinísticas versionadas, geração idempotente e pendências auditáveis.
CREATE TABLE app.accounting_rule (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES app.tenant(id),
  empresa_id uuid NOT NULL,
  nome text NOT NULL CHECK (length(btrim(nome)) BETWEEN 1 AND 160),
  origem text NOT NULL CHECK (origem IN ('DFE','TAX_ASSESSMENT')),
  versao_atual integer NOT NULL DEFAULT 1 CHECK (versao_atual > 0),
  arquivada boolean NOT NULL DEFAULT false,
  criado_por uuid NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (empresa_id,tenant_id) REFERENCES app.empresa(id,tenant_id),
  FOREIGN KEY (criado_por,tenant_id) REFERENCES app.usuario(id,tenant_id),
  UNIQUE (id,tenant_id,empresa_id)
);
CREATE INDEX accounting_rule_scope_idx ON app.accounting_rule(tenant_id,empresa_id,origem,arquivada);
CREATE INDEX accounting_rule_empresa_idx ON app.accounting_rule(empresa_id);

CREATE TABLE app.accounting_rule_version (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL,
  empresa_id uuid NOT NULL,
  regra_id uuid NOT NULL,
  versao integer NOT NULL CHECK (versao > 0),
  estado text NOT NULL DEFAULT 'DRAFT' CHECK (estado IN ('DRAFT','PUBLISHED','SUPERSEDED','ARCHIVED')),
  vigencia_inicio date NOT NULL,
  vigencia_fim date,
  publicado_por uuid,
  publicado_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (regra_id,tenant_id,empresa_id) REFERENCES app.accounting_rule(id,tenant_id,empresa_id),
  FOREIGN KEY (empresa_id,tenant_id) REFERENCES app.empresa(id,tenant_id),
  FOREIGN KEY (publicado_por,tenant_id) REFERENCES app.usuario(id,tenant_id),
  UNIQUE(regra_id,versao), UNIQUE(id,tenant_id,empresa_id),
  CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio),
  CHECK ((estado='DRAFT') = (publicado_em IS NULL))
);
CREATE INDEX accounting_rule_version_select_idx ON app.accounting_rule_version(tenant_id,empresa_id,estado,vigencia_inicio,vigencia_fim);
CREATE INDEX accounting_rule_version_empresa_idx ON app.accounting_rule_version(empresa_id);

CREATE TABLE app.accounting_rule_criterion (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(), tenant_id uuid NOT NULL, empresa_id uuid NOT NULL,
  rule_version_id uuid NOT NULL, campo text NOT NULL CHECK (campo ~ '^[a-z][a-zA-Z0-9.]{0,119}$'),
  operador text NOT NULL CHECK (operador IN ('EQ','IN','GTE','LTE','EXPLICIT_ANY')),
  valor jsonb, posicao integer NOT NULL CHECK (posicao >= 0),
  FOREIGN KEY(rule_version_id,tenant_id,empresa_id) REFERENCES app.accounting_rule_version(id,tenant_id,empresa_id),
  UNIQUE(rule_version_id,posicao), UNIQUE(id,tenant_id,empresa_id)
);
CREATE INDEX accounting_rule_criterion_empresa_idx ON app.accounting_rule_criterion(empresa_id);
CREATE INDEX accounting_rule_criterion_tenant_idx ON app.accounting_rule_criterion(tenant_id);

CREATE TABLE app.accounting_rule_line (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(), tenant_id uuid NOT NULL, empresa_id uuid NOT NULL,
  rule_version_id uuid NOT NULL, conta_id uuid NOT NULL, lado text NOT NULL CHECK(lado IN ('DEBIT','CREDIT')),
  expressao_valor text NOT NULL CHECK(length(expressao_valor) BETWEEN 1 AND 160), posicao integer NOT NULL CHECK(posicao>=0),
  FOREIGN KEY(rule_version_id,tenant_id,empresa_id) REFERENCES app.accounting_rule_version(id,tenant_id,empresa_id),
  FOREIGN KEY(conta_id,empresa_id,tenant_id) REFERENCES app.conta_contabil(id,empresa_id,tenant_id),
  UNIQUE(rule_version_id,posicao), UNIQUE(id,tenant_id,empresa_id)
);
CREATE INDEX accounting_rule_line_empresa_idx ON app.accounting_rule_line(empresa_id);
CREATE INDEX accounting_rule_line_tenant_idx ON app.accounting_rule_line(tenant_id);

CREATE TABLE app.accounting_rule_allocation (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(), tenant_id uuid NOT NULL, empresa_id uuid NOT NULL,
  rule_line_id uuid NOT NULL, centro_custo_id uuid NOT NULL, percentual_bp integer NOT NULL CHECK(percentual_bp BETWEEN 1 AND 10000),
  posicao integer NOT NULL CHECK(posicao>=0),
  FOREIGN KEY(rule_line_id,tenant_id,empresa_id) REFERENCES app.accounting_rule_line(id,tenant_id,empresa_id),
  FOREIGN KEY(centro_custo_id,empresa_id,tenant_id) REFERENCES app.centro_custo(id,empresa_id,tenant_id),
  UNIQUE(rule_line_id,posicao)
);
CREATE INDEX accounting_rule_allocation_empresa_idx ON app.accounting_rule_allocation(empresa_id);
CREATE INDEX accounting_rule_allocation_tenant_idx ON app.accounting_rule_allocation(tenant_id);

CREATE TABLE app.accounting_generation (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(), tenant_id uuid NOT NULL REFERENCES app.tenant(id), empresa_id uuid NOT NULL,
  origem text NOT NULL CHECK(origem IN ('DFE','TAX_ASSESSMENT')), origem_id uuid NOT NULL,
  origem_versao integer NOT NULL CHECK(origem_versao>0), chave_idempotente text NOT NULL CHECK(chave_idempotente ~ '^[0-9a-f]{64}$'),
  rule_version_id uuid, resultado text NOT NULL CHECK(resultado IN ('DRAFT_GENERATED','NO_MATCH','AMBIGUOUS_MATCH','INVALID_CONFIGURATION')),
  lancamento_id uuid, detalhes jsonb NOT NULL DEFAULT '{}'::jsonb, correlation_id text NOT NULL,
  criado_por uuid NOT NULL, criado_em timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(empresa_id,tenant_id) REFERENCES app.empresa(id,tenant_id),
  FOREIGN KEY(rule_version_id,tenant_id,empresa_id) REFERENCES app.accounting_rule_version(id,tenant_id,empresa_id),
  FOREIGN KEY(lancamento_id,tenant_id,empresa_id) REFERENCES app.lancamento_contabil(id,tenant_id,empresa_id),
  FOREIGN KEY(criado_por,tenant_id) REFERENCES app.usuario(id,tenant_id),
  UNIQUE(tenant_id,empresa_id,chave_idempotente), UNIQUE(id,tenant_id,empresa_id),
  CHECK((resultado='DRAFT_GENERATED')=(lancamento_id IS NOT NULL))
);
CREATE INDEX accounting_generation_origin_idx ON app.accounting_generation(tenant_id,empresa_id,origem,origem_id,origem_versao,criado_em DESC);
CREATE INDEX accounting_generation_empresa_idx ON app.accounting_generation(empresa_id);

CREATE TABLE app.accounting_generation_pending (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(), tenant_id uuid NOT NULL, empresa_id uuid NOT NULL,
  generation_id uuid NOT NULL, status text NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','RESOLVED')),
  motivo text NOT NULL CHECK(motivo IN ('NO_MATCH','AMBIGUOUS_MATCH','INVALID_CONFIGURATION')),
  diagnostico jsonb NOT NULL DEFAULT '{}'::jsonb, criado_em timestamptz NOT NULL DEFAULT now(), resolvido_em timestamptz,
  FOREIGN KEY(generation_id,tenant_id,empresa_id) REFERENCES app.accounting_generation(id,tenant_id,empresa_id),
  CHECK((status='RESOLVED')=(resolvido_em IS NOT NULL)), UNIQUE(generation_id), UNIQUE(id,tenant_id,empresa_id)
);
CREATE INDEX accounting_generation_pending_idx ON app.accounting_generation_pending(tenant_id,empresa_id,status,criado_em DESC);
CREATE INDEX accounting_generation_pending_empresa_idx ON app.accounting_generation_pending(empresa_id);

CREATE TABLE app.accounting_rule_event (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(), tenant_id uuid NOT NULL, empresa_id uuid NOT NULL,
  rule_id uuid, rule_version_id uuid, generation_id uuid, pending_id uuid,
  acao text NOT NULL CHECK(acao IN ('CREATED','EDITED','SIMULATED','PUBLISHED','SUPERSEDED','ARCHIVED','GENERATED','PENDING','REPROCESSED','DENIED')),
  resultado text, ator_id uuid NOT NULL, correlation_id text NOT NULL, detalhes jsonb NOT NULL DEFAULT '{}'::jsonb,
  ocorrido_em timestamptz NOT NULL DEFAULT now(), sequencia bigint GENERATED ALWAYS AS IDENTITY,
  FOREIGN KEY(empresa_id,tenant_id) REFERENCES app.empresa(id,tenant_id),
  FOREIGN KEY(rule_id,tenant_id,empresa_id) REFERENCES app.accounting_rule(id,tenant_id,empresa_id),
  FOREIGN KEY(rule_version_id,tenant_id,empresa_id) REFERENCES app.accounting_rule_version(id,tenant_id,empresa_id),
  FOREIGN KEY(generation_id,tenant_id,empresa_id) REFERENCES app.accounting_generation(id,tenant_id,empresa_id),
  FOREIGN KEY(pending_id,tenant_id,empresa_id) REFERENCES app.accounting_generation_pending(id,tenant_id,empresa_id),
  FOREIGN KEY(ator_id,tenant_id) REFERENCES app.usuario(id,tenant_id)
);
CREATE INDEX accounting_rule_event_scope_idx ON app.accounting_rule_event(tenant_id,empresa_id,ocorrido_em,sequencia);
CREATE INDEX accounting_rule_event_empresa_idx ON app.accounting_rule_event(empresa_id);

CREATE OR REPLACE FUNCTION app.proteger_versao_regra_contabil() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'ACCOUNTING_RULE_IMMUTABLE' USING ERRCODE='restrict_violation';
  END IF;
  IF OLD.estado <> 'DRAFT' AND NOT (
    (OLD.estado='PUBLISHED' AND NEW.estado IN ('SUPERSEDED','ARCHIVED')) AND
    (to_jsonb(NEW)-'estado' IS NOT DISTINCT FROM to_jsonb(OLD)-'estado')
  ) THEN RAISE EXCEPTION 'ACCOUNTING_RULE_IMMUTABLE' USING ERRCODE='restrict_violation'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER accounting_rule_version_draft_only BEFORE UPDATE OR DELETE ON app.accounting_rule_version
  FOR EACH ROW EXECUTE FUNCTION app.proteger_versao_regra_contabil();

CREATE OR REPLACE FUNCTION app.proteger_conteudo_regra_publicada() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE alvo uuid;
BEGIN
  alvo:=CASE WHEN TG_OP='DELETE' THEN OLD.rule_version_id ELSE NEW.rule_version_id END;
  IF EXISTS(SELECT 1 FROM app.accounting_rule_version WHERE id=alvo AND estado<>'DRAFT') THEN
    RAISE EXCEPTION 'ACCOUNTING_RULE_IMMUTABLE' USING ERRCODE='restrict_violation';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END; $$;
CREATE TRIGGER accounting_rule_criterion_draft_only BEFORE INSERT OR UPDATE OR DELETE ON app.accounting_rule_criterion FOR EACH ROW EXECUTE FUNCTION app.proteger_conteudo_regra_publicada();
CREATE TRIGGER accounting_rule_line_draft_only BEFORE INSERT OR UPDATE OR DELETE ON app.accounting_rule_line FOR EACH ROW EXECUTE FUNCTION app.proteger_conteudo_regra_publicada();

CREATE OR REPLACE FUNCTION app.proteger_rateio_regra_publicada() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE alvo uuid;
BEGIN
  alvo:=CASE WHEN TG_OP='DELETE' THEN OLD.rule_line_id ELSE NEW.rule_line_id END;
  IF EXISTS(SELECT 1 FROM app.accounting_rule_line l JOIN app.accounting_rule_version v ON v.id=l.rule_version_id WHERE l.id=alvo AND v.estado<>'DRAFT') THEN
    RAISE EXCEPTION 'ACCOUNTING_RULE_IMMUTABLE' USING ERRCODE='restrict_violation';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END; $$;
CREATE TRIGGER accounting_rule_allocation_draft_only BEFORE INSERT OR UPDATE OR DELETE ON app.accounting_rule_allocation FOR EACH ROW EXECUTE FUNCTION app.proteger_rateio_regra_publicada();

CREATE OR REPLACE FUNCTION app.limpar_conteudo_regra_rascunho(p_tenant uuid,p_empresa uuid,p_versao uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
BEGIN
  IF p_tenant IS DISTINCT FROM app.tenant_atual() OR NOT app.empresa_autorizada(p_empresa) OR NOT EXISTS(
    SELECT 1 FROM app.accounting_rule_version v WHERE v.id=p_versao AND v.tenant_id=p_tenant AND v.empresa_id=p_empresa AND v.estado='DRAFT'
  ) THEN RAISE EXCEPTION 'ACCOUNTING_RULE_IMMUTABLE' USING ERRCODE='restrict_violation'; END IF;
  DELETE FROM app.accounting_rule_allocation a USING app.accounting_rule_line l WHERE a.rule_line_id=l.id AND l.rule_version_id=p_versao AND l.tenant_id=p_tenant AND l.empresa_id=p_empresa;
  DELETE FROM app.accounting_rule_line WHERE rule_version_id=p_versao AND tenant_id=p_tenant AND empresa_id=p_empresa;
  DELETE FROM app.accounting_rule_criterion WHERE rule_version_id=p_versao AND tenant_id=p_tenant AND empresa_id=p_empresa;
END $$;
REVOKE ALL ON FUNCTION app.limpar_conteudo_regra_rascunho(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.limpar_conteudo_regra_rascunho(uuid,uuid,uuid) TO contaia_app;

CREATE OR REPLACE FUNCTION app.proteger_evento_accounting_rule() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'ACCOUNTING_RULE_EVENT_APPEND_ONLY' USING ERRCODE='restrict_violation'; END; $$;
CREATE OR REPLACE FUNCTION app.proteger_reprocessamento_pendente() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR OLD.status<>'OPEN' OR NEW.status<>'RESOLVED' OR NEW.id IS DISTINCT FROM OLD.id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.empresa_id IS DISTINCT FROM OLD.empresa_id OR NEW.generation_id IS DISTINCT FROM OLD.generation_id OR NEW.motivo IS DISTINCT FROM OLD.motivo OR NEW.diagnostico IS DISTINCT FROM OLD.diagnostico OR NEW.criado_em IS DISTINCT FROM OLD.criado_em OR NEW.resolvido_em IS NULL THEN
    RAISE EXCEPTION 'ACCOUNTING_PENDING_APPEND_ONLY' USING ERRCODE='restrict_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER accounting_generation_append_only BEFORE UPDATE OR DELETE ON app.accounting_generation FOR EACH ROW EXECUTE FUNCTION app.rejeitar_escrita_em_historico();
CREATE TRIGGER accounting_generation_no_truncate BEFORE TRUNCATE ON app.accounting_generation FOR EACH STATEMENT EXECUTE FUNCTION app.rejeitar_truncate_tax_resolution();
CREATE TRIGGER accounting_rule_event_append_only BEFORE UPDATE OR DELETE ON app.accounting_rule_event FOR EACH ROW EXECUTE FUNCTION app.proteger_evento_accounting_rule();
CREATE TRIGGER accounting_rule_event_no_truncate BEFORE TRUNCATE ON app.accounting_rule_event FOR EACH STATEMENT EXECUTE FUNCTION app.rejeitar_truncate_tax_resolution();

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['accounting_rule','accounting_rule_version','accounting_rule_criterion','accounting_rule_line','accounting_rule_allocation','accounting_generation','accounting_generation_pending','accounting_rule_event'] LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY %I ON app.%I FOR SELECT USING (tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id))',t||'_select',t);
    EXECUTE format('CREATE POLICY %I ON app.%I FOR INSERT WITH CHECK (tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id))',t||'_insert',t);
    IF t IN ('accounting_rule','accounting_rule_version','accounting_generation_pending') THEN
      EXECUTE format('CREATE POLICY %I ON app.%I FOR UPDATE USING (tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id)) WITH CHECK (tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id))',t||'_update',t);
    END IF;
    IF t IN ('accounting_rule_criterion','accounting_rule_line','accounting_rule_allocation') THEN
      EXECUTE format('CREATE POLICY %I ON app.%I FOR UPDATE USING (tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id)) WITH CHECK (tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id))',t||'_update',t);
    END IF;
    EXECUTE format('CREATE TRIGGER escopo_imutavel BEFORE UPDATE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.proteger_escopo_empresa()',t);
    IF t='accounting_rule_event' THEN EXECUTE format('REVOKE UPDATE,DELETE,TRUNCATE ON app.%I FROM PUBLIC,contaia_app',t); END IF;
    IF t='accounting_generation' THEN
      EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.proteger_escopo_empresa()',t||'_scope_guard',t);
      EXECUTE format('REVOKE UPDATE,DELETE,TRUNCATE ON app.%I FROM PUBLIC,contaia_app',t);
    END IF;
    IF t='accounting_generation_pending' THEN
      EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.proteger_reprocessamento_pendente()',t||'_append_only_guard',t);
    END IF;
  END LOOP;
END $$;
REVOKE ALL ON app.accounting_rule,app.accounting_rule_version,app.accounting_rule_criterion,app.accounting_rule_line,app.accounting_rule_allocation,app.accounting_generation,app.accounting_generation_pending,app.accounting_rule_event FROM PUBLIC,contaia_app;
GRANT SELECT,INSERT,UPDATE ON app.accounting_rule,app.accounting_rule_version TO contaia_app;
GRANT SELECT,INSERT,UPDATE ON app.accounting_generation_pending TO contaia_app;
GRANT SELECT,INSERT,UPDATE ON app.accounting_rule_criterion,app.accounting_rule_line,app.accounting_rule_allocation TO contaia_app;
GRANT SELECT,INSERT ON app.accounting_generation,app.accounting_rule_event TO contaia_app;
REVOKE DELETE ON app.accounting_rule_criterion,app.accounting_rule_line,app.accounting_rule_allocation FROM contaia_app;
GRANT USAGE,SELECT ON SEQUENCE app.accounting_rule_event_sequencia_seq TO contaia_app;
