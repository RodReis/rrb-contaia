-- SPEC-039/F39: classificar contas F13 e manter centros de custo por empresa.
ALTER TABLE app.importacao_plano_contas_linha ADD COLUMN classe_contabil text;
ALTER TABLE app.conta_contabil
  ADD COLUMN classe_contabil text CHECK (classe_contabil IN ('ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE','COMPENSATION','OTHER')),
  ADD COLUMN politica_centro_custo text CHECK (politica_centro_custo IN ('REQUIRED','OPTIONAL','FORBIDDEN'));
ALTER TABLE app.conta_contabil DISABLE TRIGGER conta_contabil_protegida;
REVOKE UPDATE ON app.conta_contabil FROM contaia_app;
GRANT UPDATE (nome, tipo, natureza, conta_pai, arquivada, arquivada_em, atualizado_em, classe_contabil, politica_centro_custo)
  ON app.conta_contabil TO contaia_app;
UPDATE app.conta_contabil SET politica_centro_custo='FORBIDDEN' WHERE tipo='sintetica' AND politica_centro_custo IS DISTINCT FROM 'FORBIDDEN' AND NOT arquivada;
ALTER TABLE app.conta_contabil ADD CONSTRAINT conta_contabil_politica_sintetica CHECK (tipo <> 'sintetica' OR politica_centro_custo='FORBIDDEN' OR arquivada);
ALTER TABLE app.conta_contabil ENABLE TRIGGER conta_contabil_protegida;
CREATE UNIQUE INDEX conta_contabil_codigo_normalizado_unico ON app.conta_contabil(empresa_id, lower(btrim(codigo)));

CREATE OR REPLACE FUNCTION app.proteger_conta_contabil() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
  IF NEW.codigo IS DISTINCT FROM OLD.codigo THEN
    RAISE EXCEPTION 'ACCOUNTING_CATALOG_CODE_IMMUTABLE' USING ERRCODE='restrict_violation';
  END IF;
  IF OLD.arquivada AND NOT NEW.arquivada AND current_setting('app.catalogo_contabil_transicao', true) IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'ACCOUNTING_CATALOG_ARCHIVE_REQUIRES_COMMAND' USING ERRCODE='restrict_violation';
  END IF;
  IF OLD.arquivada AND NEW.arquivada THEN
    RAISE EXCEPTION 'ACCOUNTING_CATALOG_ARCHIVED' USING ERRCODE='restrict_violation';
  END IF;
  IF NEW.tipo='sintetica' THEN NEW.politica_centro_custo := 'FORBIDDEN'; END IF;
  NEW.versao := OLD.versao + 1;
  RETURN NEW;
END;
$$;

CREATE TABLE app.centro_custo (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES app.tenant(id),
  empresa_id uuid NOT NULL,
  codigo text NOT NULL CHECK (btrim(codigo) <> ''),
  nome text NOT NULL CHECK (btrim(nome) <> ''),
  tipo text NOT NULL CHECK (tipo IN ('analitica','sintetica')),
  centro_pai text,
  arquivada boolean NOT NULL DEFAULT false,
  arquivada_em timestamptz,
  versao bigint NOT NULL DEFAULT 1 CHECK (versao > 0),
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT centro_custo_empresa_codigo UNIQUE (empresa_id,codigo),
  CONSTRAINT centro_custo_arquivo CHECK (arquivada = (arquivada_em IS NOT NULL)),
  CONSTRAINT centro_custo_sem_ciclo_direto CHECK (centro_pai IS NULL OR centro_pai <> codigo),
  CONSTRAINT centro_custo_empresa_tenant FOREIGN KEY (empresa_id,tenant_id) REFERENCES app.empresa(id,tenant_id),
  CONSTRAINT centro_custo_pai_mesma_empresa FOREIGN KEY (empresa_id,centro_pai) REFERENCES app.centro_custo(empresa_id,codigo) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX centro_custo_tenant_idx ON app.centro_custo(tenant_id);
CREATE INDEX centro_custo_empresa_idx ON app.centro_custo(empresa_id);
CREATE INDEX centro_custo_pai_idx ON app.centro_custo(empresa_id,centro_pai);
CREATE UNIQUE INDEX centro_custo_codigo_normalizado_unico ON app.centro_custo(empresa_id,lower(btrim(codigo)));
CREATE OR REPLACE FUNCTION app.proteger_centro_custo() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
  IF NEW.codigo IS DISTINCT FROM OLD.codigo THEN RAISE EXCEPTION 'ACCOUNTING_CATALOG_CODE_IMMUTABLE' USING ERRCODE='restrict_violation'; END IF;
  IF OLD.arquivada AND NOT NEW.arquivada AND current_setting('app.catalogo_contabil_transicao', true) IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'ACCOUNTING_CATALOG_ARCHIVE_REQUIRES_COMMAND' USING ERRCODE='restrict_violation'; END IF;
  IF OLD.arquivada AND NEW.arquivada THEN RAISE EXCEPTION 'ACCOUNTING_CATALOG_ARCHIVED' USING ERRCODE='restrict_violation'; END IF;
  NEW.versao := OLD.versao + 1;
  RETURN NEW;
END;
$$;
CREATE TRIGGER centro_custo_protegido BEFORE UPDATE ON app.centro_custo FOR EACH ROW EXECUTE FUNCTION app.proteger_centro_custo();
ALTER TABLE app.centro_custo ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.centro_custo FORCE ROW LEVEL SECURITY;
CREATE POLICY centro_custo_select ON app.centro_custo FOR SELECT USING (tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id));
CREATE POLICY centro_custo_insert ON app.centro_custo FOR INSERT WITH CHECK (tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id));
CREATE POLICY centro_custo_update ON app.centro_custo FOR UPDATE USING (tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id)) WITH CHECK (tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id));
CREATE TRIGGER centro_custo_escopo_imutavel BEFORE UPDATE ON app.centro_custo FOR EACH ROW EXECUTE FUNCTION app.proteger_escopo_empresa();

CREATE TABLE app.catalogo_contabil_evento (
  id uuid NOT NULL DEFAULT app.uuid_v7(), tenant_id uuid NOT NULL REFERENCES app.tenant(id), empresa_id uuid NOT NULL,
  catalogo text NOT NULL CHECK (catalogo IN ('CONTA','CENTRO_CUSTO')), item_id uuid,
  codigo_item text NOT NULL, acao text NOT NULL, resultado text NOT NULL CHECK (resultado IN ('SUCESSO','RECUSADO')),
  codigo_erro text, versao_anterior bigint, versao_nova bigint, usuario_id uuid NOT NULL,
  correlation_id text NOT NULL, ocorrido_em timestamptz NOT NULL DEFAULT now(), sequencia bigint GENERATED ALWAYS AS IDENTITY,
  CONSTRAINT catalogo_evento_empresa_tenant FOREIGN KEY (empresa_id,tenant_id) REFERENCES app.empresa(id,tenant_id),
  CONSTRAINT catalogo_evento_usuario FOREIGN KEY (usuario_id,tenant_id) REFERENCES app.usuario(id,tenant_id),
  CONSTRAINT catalogo_evento_id_tenant_empresa UNIQUE (id,tenant_id,empresa_id)
);
ALTER TABLE app.catalogo_contabil_evento ADD CONSTRAINT catalogo_evento_pk PRIMARY KEY(id);
CREATE INDEX catalogo_evento_tenant_idx ON app.catalogo_contabil_evento(tenant_id);
CREATE INDEX catalogo_evento_empresa_idx ON app.catalogo_contabil_evento(empresa_id);
CREATE INDEX catalogo_evento_item_idx ON app.catalogo_contabil_evento(empresa_id,catalogo,codigo_item,ocorrido_em DESC,sequencia DESC);
ALTER TABLE app.catalogo_contabil_evento ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.catalogo_contabil_evento FORCE ROW LEVEL SECURITY;
CREATE POLICY catalogo_evento_select ON app.catalogo_contabil_evento FOR SELECT USING (tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id));
CREATE POLICY catalogo_evento_insert ON app.catalogo_contabil_evento FOR INSERT WITH CHECK (tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id));
CREATE POLICY catalogo_evento_negacao_tenant ON app.catalogo_contabil_evento FOR INSERT WITH CHECK (tenant_id=app.tenant_atual() AND app.contexto_humano());
CREATE TRIGGER catalogo_evento_append_only BEFORE UPDATE OR DELETE ON app.catalogo_contabil_evento FOR EACH ROW EXECUTE FUNCTION app.rejeitar_escrita_em_historico();
CREATE TRIGGER catalogo_evento_escopo_imutavel BEFORE UPDATE ON app.catalogo_contabil_evento FOR EACH ROW EXECUTE FUNCTION app.proteger_escopo_empresa();

GRANT SELECT,INSERT,UPDATE ON app.centro_custo TO contaia_app;
GRANT SELECT ON app.catalogo_contabil_evento TO contaia_app;
REVOKE UPDATE,DELETE ON app.catalogo_contabil_evento FROM contaia_app;
GRANT USAGE,SELECT ON SEQUENCE app.catalogo_contabil_evento_sequencia_seq TO contaia_app;

-- Auditoria genérica da API cobre negações em guards. Autoriza gravação restrita em trilha
-- mesmo quando a pessoa não tem acesso operacional à empresa, sem conceder leitura do catálogo.
GRANT INSERT (id,tenant_id,empresa_id,catalogo,codigo_item,acao,resultado,codigo_erro,usuario_id,correlation_id)
  ON app.catalogo_contabil_evento TO contaia_app;
