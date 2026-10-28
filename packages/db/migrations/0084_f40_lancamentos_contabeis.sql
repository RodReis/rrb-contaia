-- SPEC-040/F40: lançamentos manuais, partidas dobradas, sequência transacional e auditoria.

CREATE UNIQUE INDEX conta_contabil_id_empresa_tenant_unico
  ON app.conta_contabil(id,empresa_id,tenant_id);
CREATE UNIQUE INDEX centro_custo_id_empresa_tenant_unico
  ON app.centro_custo(id,empresa_id,tenant_id);

CREATE TABLE app.lancamento_contabil (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(), tenant_id uuid NOT NULL REFERENCES app.tenant(id), empresa_id uuid NOT NULL,
  exercicio integer NOT NULL CHECK(exercicio BETWEEN 1900 AND 9999), numero bigint CHECK(numero IS NULL OR numero>0),
  data_contabil date NOT NULL, competencia text NOT NULL CHECK(competencia ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  historico text NOT NULL CHECK(length(btrim(historico)) BETWEEN 1 AND 500), referencia_externa text CHECK(referencia_externa IS NULL OR length(btrim(referencia_externa))<=240),
  estado text NOT NULL DEFAULT 'DRAFT' CHECK(estado IN ('DRAFT','POSTED','DISCARDED','CANCELLED','REVERSED')),
  estorno_de_id uuid, versao integer NOT NULL DEFAULT 1 CHECK(versao>0), criado_por uuid NOT NULL, efetivado_por uuid, ocorrido_em timestamptz NOT NULL DEFAULT now(),
  cancelamento_motivo text, criado_em timestamptz NOT NULL DEFAULT now(), atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lancamento_competencia_data CHECK(to_char(data_contabil,'YYYY-MM')=competencia AND extract(year from data_contabil)::integer=exercicio),
  CONSTRAINT lancamento_numero_estado CHECK((estado IN ('DRAFT','DISCARDED') AND numero IS NULL) OR (estado IN ('POSTED','CANCELLED','REVERSED') AND numero IS NOT NULL)),
  CONSTRAINT lancamento_empresa_tenant FOREIGN KEY(empresa_id,tenant_id) REFERENCES app.empresa(id,tenant_id),
  CONSTRAINT lancamento_criador_tenant FOREIGN KEY(criado_por,tenant_id) REFERENCES app.usuario(id,tenant_id),
  CONSTRAINT lancamento_efetivador_tenant FOREIGN KEY(efetivado_por,tenant_id) REFERENCES app.usuario(id,tenant_id),
  CONSTRAINT lancamento_estorno_empresa FOREIGN KEY(estorno_de_id,tenant_id,empresa_id) REFERENCES app.lancamento_contabil(id,tenant_id,empresa_id),
  CONSTRAINT lancamento_id_tenant_empresa UNIQUE(id,tenant_id,empresa_id),
  CONSTRAINT lancamento_numero_unico UNIQUE(tenant_id,empresa_id,exercicio,numero),
  CONSTRAINT lancamento_estorno_unico UNIQUE(estorno_de_id)
);
CREATE INDEX lancamento_scope_idx ON app.lancamento_contabil(tenant_id,empresa_id,exercicio,numero,id);
CREATE INDEX lancamento_empresa_idx ON app.lancamento_contabil(empresa_id);

CREATE TABLE app.lancamento_contabil_partida (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(), tenant_id uuid NOT NULL REFERENCES app.tenant(id), empresa_id uuid NOT NULL, lancamento_id uuid NOT NULL,
  conta_id uuid NOT NULL, centro_custo_id uuid, lado text NOT NULL CHECK(lado IN ('DEBIT','CREDIT')),
  valor_centavos bigint NOT NULL CHECK(valor_centavos BETWEEN 1 AND 9007199254740991), complemento text CHECK(complemento IS NULL OR length(complemento)<=240), posicao integer NOT NULL CHECK(posicao>=0), ativa boolean NOT NULL DEFAULT true,
  FOREIGN KEY(lancamento_id,tenant_id,empresa_id) REFERENCES app.lancamento_contabil(id,tenant_id,empresa_id),
  FOREIGN KEY(conta_id,empresa_id,tenant_id) REFERENCES app.conta_contabil(id,empresa_id,tenant_id),
  FOREIGN KEY(centro_custo_id,empresa_id,tenant_id) REFERENCES app.centro_custo(id,empresa_id,tenant_id),
  FOREIGN KEY(empresa_id,tenant_id) REFERENCES app.empresa(id,tenant_id),
  UNIQUE(id,tenant_id,empresa_id)
);
CREATE UNIQUE INDEX lancamento_partida_posicao_ativa_unica ON app.lancamento_contabil_partida(lancamento_id,posicao) WHERE ativa;
CREATE INDEX lancamento_partida_scope_idx ON app.lancamento_contabil_partida(tenant_id,empresa_id,lancamento_id,posicao);
CREATE INDEX lancamento_partida_empresa_idx ON app.lancamento_contabil_partida(empresa_id);

CREATE TABLE app.lancamento_contabil_sequencia (
  tenant_id uuid NOT NULL, empresa_id uuid NOT NULL, exercicio integer NOT NULL CHECK(exercicio BETWEEN 1900 AND 9999), ultimo_numero bigint NOT NULL CHECK(ultimo_numero>0),
  PRIMARY KEY(tenant_id,empresa_id,exercicio),
  FOREIGN KEY(empresa_id,tenant_id) REFERENCES app.empresa(id,tenant_id)
);
CREATE INDEX lancamento_sequencia_empresa_idx ON app.lancamento_contabil_sequencia(empresa_id);

CREATE TABLE app.lancamento_contabil_evento (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(), tenant_id uuid NOT NULL REFERENCES app.tenant(id), empresa_id uuid NOT NULL, lancamento_id uuid NOT NULL,
  acao text NOT NULL CHECK(acao IN ('CRIADO','EDITADO','DESCARTADO','EFETIVADO','CANCELADO','ESTORNADO','CONFLITO','TENTATIVA_NEGADA')),
  estado_anterior text, estado_novo text, numero bigint, motivo text, codigo_erro text, usuario_id uuid NOT NULL,
  correlation_id text NOT NULL, ocorrido_em timestamptz NOT NULL DEFAULT now(), sequencia bigint GENERATED ALWAYS AS IDENTITY,
  FOREIGN KEY(lancamento_id,tenant_id,empresa_id) REFERENCES app.lancamento_contabil(id,tenant_id,empresa_id),
  FOREIGN KEY(usuario_id,tenant_id) REFERENCES app.usuario(id,tenant_id),
  FOREIGN KEY(empresa_id,tenant_id) REFERENCES app.empresa(id,tenant_id)
);
CREATE INDEX lancamento_evento_scope_idx ON app.lancamento_contabil_evento(tenant_id,empresa_id,lancamento_id,ocorrido_em,sequencia);
CREATE INDEX lancamento_evento_empresa_idx ON app.lancamento_contabil_evento(empresa_id);

CREATE OR REPLACE FUNCTION app.proteger_lancamento_contabil() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.estado<>'DRAFT' OR NEW.numero IS NOT NULL OR NEW.efetivado_por IS NOT NULL THEN
      RAISE EXCEPTION 'ACCOUNTING_ENTRY_IMMUTABLE' USING ERRCODE='restrict_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.estado<>'DRAFT' OR NEW.id IS DISTINCT FROM OLD.id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.empresa_id IS DISTINCT FROM OLD.empresa_id OR NEW.criado_por IS DISTINCT FROM OLD.criado_por OR NEW.estorno_de_id IS DISTINCT FROM OLD.estorno_de_id THEN
    IF current_setting('app.lancamento_contabil_transicao',true) IS DISTINCT FROM 'true' THEN
      RAISE EXCEPTION 'ACCOUNTING_ENTRY_IMMUTABLE' USING ERRCODE='restrict_violation';
    END IF;
  END IF;
  IF OLD.estado='DRAFT' AND NEW.estado='DRAFT' AND (NEW.numero IS NOT NULL OR NEW.efetivado_por IS NOT NULL OR NEW.estorno_de_id IS DISTINCT FROM OLD.estorno_de_id) THEN
    RAISE EXCEPTION 'ACCOUNTING_ENTRY_IMMUTABLE' USING ERRCODE='restrict_violation';
  END IF;
  IF NEW.estado='DRAFT' AND OLD.estado='DRAFT' THEN NEW.versao:=OLD.versao+1; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER lancamento_contabil_protegido BEFORE INSERT OR UPDATE ON app.lancamento_contabil FOR EACH ROW EXECUTE FUNCTION app.proteger_lancamento_contabil();
CREATE OR REPLACE FUNCTION app.proteger_lancamento_efetivado() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.estado<>'DRAFT' AND (NEW.data_contabil IS DISTINCT FROM OLD.data_contabil OR NEW.competencia IS DISTINCT FROM OLD.competencia OR NEW.historico IS DISTINCT FROM OLD.historico OR NEW.referencia_externa IS DISTINCT FROM OLD.referencia_externa OR NEW.exercicio IS DISTINCT FROM OLD.exercicio OR NEW.numero IS DISTINCT FROM OLD.numero OR NEW.versao IS DISTINCT FROM OLD.versao OR NEW.criado_por IS DISTINCT FROM OLD.criado_por OR NEW.efetivado_por IS DISTINCT FROM OLD.efetivado_por OR NEW.estorno_de_id IS DISTINCT FROM OLD.estorno_de_id OR NEW.cancelamento_motivo IS DISTINCT FROM OLD.cancelamento_motivo) THEN
    RAISE EXCEPTION 'ACCOUNTING_ENTRY_IMMUTABLE' USING ERRCODE='restrict_violation';
  END IF;
  IF OLD.estado<>'DRAFT' AND NEW.estado IS DISTINCT FROM OLD.estado AND NOT (OLD.estado='POSTED' AND NEW.estado IN ('CANCELLED','REVERSED')) THEN
    RAISE EXCEPTION 'ACCOUNTING_ENTRY_IMMUTABLE' USING ERRCODE='restrict_violation';
  END IF;
  IF OLD.estado='DRAFT' AND NEW.estado NOT IN ('DRAFT','POSTED','DISCARDED') THEN
    RAISE EXCEPTION 'ACCOUNTING_ENTRY_IMMUTABLE' USING ERRCODE='restrict_violation';
  END IF;
  IF OLD.estado='POSTED' AND NEW.estado='CANCELLED' AND length(btrim(coalesce(NEW.cancelamento_motivo,'')))=0 THEN
    RAISE EXCEPTION 'ACCOUNTING_ENTRY_CANCELLATION_FORBIDDEN' USING ERRCODE='check_violation';
  END IF;
  IF OLD.estado='DRAFT' AND NEW.estado<>'DRAFT' AND current_setting('app.lancamento_contabil_transicao',true) IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'ACCOUNTING_ENTRY_IMMUTABLE' USING ERRCODE='restrict_violation';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER lancamento_efetivado_imutavel BEFORE UPDATE ON app.lancamento_contabil FOR EACH ROW EXECUTE FUNCTION app.proteger_lancamento_efetivado();

CREATE OR REPLACE FUNCTION app.proteger_partida_lancamento() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE estado_atual text; alvo uuid;
BEGIN
  alvo:=CASE WHEN TG_OP='DELETE' THEN OLD.lancamento_id ELSE NEW.lancamento_id END;
  SELECT estado INTO estado_atual FROM app.lancamento_contabil WHERE id=alvo AND tenant_id=coalesce(NEW.tenant_id,OLD.tenant_id) FOR UPDATE;
  IF estado_atual IS DISTINCT FROM 'DRAFT' THEN RAISE EXCEPTION 'ACCOUNTING_ENTRY_IMMUTABLE' USING ERRCODE='restrict_violation'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END; $$;
CREATE TRIGGER partida_lancamento_protegida BEFORE INSERT OR UPDATE OR DELETE ON app.lancamento_contabil_partida FOR EACH ROW EXECUTE FUNCTION app.proteger_partida_lancamento();

CREATE OR REPLACE FUNCTION app.validar_lancamento_efetivado() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE quantidade bigint; debitos numeric; creditos numeric;
BEGIN
  SELECT count(*),coalesce(sum(valor_centavos) FILTER(WHERE lado='DEBIT'),0),coalesce(sum(valor_centavos) FILTER(WHERE lado='CREDIT'),0)
    INTO quantidade,debitos,creditos FROM app.lancamento_contabil_partida WHERE lancamento_id=NEW.id AND ativa;
  IF NEW.estado IN ('POSTED','REVERSED','CANCELLED') AND (quantidade<2 OR debitos=0 OR debitos<>creditos) THEN
    RAISE EXCEPTION 'ACCOUNTING_ENTRY_UNBALANCED' USING ERRCODE='check_violation';
  END IF;
  RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER lancamento_balanceado AFTER INSERT OR UPDATE ON app.lancamento_contabil DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.validar_lancamento_efetivado();

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['lancamento_contabil','lancamento_contabil_partida','lancamento_contabil_sequencia','lancamento_contabil_evento'] LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',t);
    IF t='lancamento_contabil_sequencia' THEN
      EXECUTE format('CREATE POLICY %I ON app.%I FOR SELECT USING (tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id))',t||'_select',t);
      EXECUTE format('CREATE POLICY %I ON app.%I FOR INSERT WITH CHECK (tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id))',t||'_insert',t);
      EXECUTE format('CREATE POLICY %I ON app.%I FOR UPDATE USING (tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id)) WITH CHECK (tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id))',t||'_update',t);
    ELSE
      EXECUTE format('CREATE POLICY %I ON app.%I FOR SELECT USING (tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id))',t||'_select',t);
      EXECUTE format('CREATE POLICY %I ON app.%I FOR INSERT WITH CHECK (tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id))',t||'_insert',t);
      IF t IN ('lancamento_contabil','lancamento_contabil_partida') THEN
        EXECUTE format('CREATE POLICY %I ON app.%I FOR UPDATE USING (tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id)) WITH CHECK (tenant_id=app.tenant_atual() AND app.empresa_autorizada(empresa_id))',t||'_update',t);
      END IF;
    END IF;
    EXECUTE format('CREATE TRIGGER escopo_imutavel BEFORE UPDATE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.proteger_escopo_empresa()',t);
    IF t='lancamento_contabil_evento' THEN
      EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.rejeitar_escrita_em_historico()',t||'_append_only',t);
      EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON app.%I FOR EACH STATEMENT EXECUTE FUNCTION app.rejeitar_truncate_tax_resolution()',t||'_no_truncate',t);
    END IF;
  END LOOP;
END $$;

REVOKE ALL ON app.lancamento_contabil,app.lancamento_contabil_partida,app.lancamento_contabil_sequencia,app.lancamento_contabil_evento FROM PUBLIC,contaia_app;
GRANT SELECT,INSERT,UPDATE ON app.lancamento_contabil TO contaia_app;
GRANT SELECT,INSERT,UPDATE ON app.lancamento_contabil_partida TO contaia_app;
GRANT SELECT,INSERT,UPDATE ON app.lancamento_contabil_sequencia TO contaia_app;
GRANT SELECT,INSERT ON app.lancamento_contabil_evento TO contaia_app;
GRANT USAGE,SELECT ON SEQUENCE app.lancamento_contabil_evento_sequencia_seq TO contaia_app;
