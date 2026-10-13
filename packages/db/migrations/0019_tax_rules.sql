-- SPEC-016/F16 — Catalogo tributario global versionado.
--
-- Tres tabelas GLOBAIS (classe `global`, origem SPEC-016 §3.7: o catalogo nao pertence a tenant nem
-- a empresa; nao ha tenant_id nem empresa_id):
--   * tax_rule              identidade da regra: tributo + regime + tipo de operacao;
--   * tax_rule_version      versoes da regra (vigencia, base reduzida, aliquota, ciclo de vida);
--   * tax_rule_audit_event  trilha append-only de criacao, edicao, publicacao e arquivamento (I-6).
--
-- A aplicacao NAO tem privilegio algum nas tabelas. Ela so as alcanca pelas funcoes SECURITY DEFINER
-- `app.tax_rule_*`, que exigem o contexto de servico `CATALOGO_TRIBUTARIO` (sem tenant, empresa nem
-- usuario). Quem autoriza o ator (super-admin, papeis de escritorio) e a API; o ator entra como
-- parametro so para a auditoria.
--
-- Integridade no banco, inclusive contra o superusuario das migrations:
--   * versao publicada nao muda de conteudo nem volta a rascunho; so PUBLISHED -> ARCHIVED (I-7);
--   * nenhuma versao e apagada;
--   * duas versoes PUBLICADAS da mesma identidade nao tem vigencias sobrepostas (limites
--     inclusivos). Arquivar libera o intervalo para uma versao substituta (I-8).
--
-- Plano de rollback (sem migration "down" no runner: aplicar a mao, numa transacao). Apaga o catalogo
-- e a auditoria por completo — so use antes de qualquer regra publicada ter sido usada. O bloco
-- abaixo e executado pelo teste de banco.
-- ROLLBACK:INICIO
-- DROP FUNCTION app.tax_rule_find_applicable(text, text, text, date);
-- DROP FUNCTION app.tax_rule_count(text, text, text, text, date);
-- DROP FUNCTION app.tax_rule_list(text, text, text, text, date, integer, integer);
-- DROP FUNCTION app.tax_rule_archive(uuid, timestamptz, text, uuid, integer);
-- DROP FUNCTION app.tax_rule_publish(uuid, timestamptz, text, uuid, integer);
-- DROP FUNCTION app.tax_rule_update_draft(uuid, timestamptz, text, uuid, integer, date, date, integer, integer, text, text);
-- DROP FUNCTION app.tax_rule_create_draft(uuid, timestamptz, text, text, text, text, date, date, integer, integer, text, text);
-- DROP FUNCTION app.tax_rule_lock_for_command(uuid, text, integer);
-- DROP FUNCTION app.tax_rule_get(uuid);
-- DROP FUNCTION app.tax_rule_row_of(uuid);
-- DROP FUNCTION app.tax_rule_write_audit(uuid, text, uuid, timestamptz, integer, integer, text);
-- DROP FUNCTION app.exigir_contexto_do_catalogo_tributario();
-- DROP FUNCTION app.contexto_do_catalogo_tributario();
-- DROP TABLE app.tax_rule_audit_event;
-- DROP TABLE app.tax_rule_version;
-- DROP TABLE app.tax_rule;
-- DROP FUNCTION app.proteger_tax_rule_version();
-- DROP TYPE app.tax_rule_version_row;
-- ROLLBACK:FIM

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- 1. Tabelas -------------------------------------------------------------------------------------

CREATE TABLE app.tax_rule (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tax_type text NOT NULL CHECK (tax_type IN ('ICMS', 'PIS', 'COFINS', 'IBS_UF', 'IBS_MUN', 'CBS')),
  regime text NOT NULL CHECK (regime IN ('SIMPLES_NACIONAL', 'LUCRO_PRESUMIDO', 'LUCRO_REAL')),
  operation_type text NOT NULL CHECK (operation_type ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT tax_rule_identity_unique UNIQUE (tax_type, regime, operation_type)
);

CREATE TABLE app.tax_rule_version (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tax_rule_id uuid NOT NULL REFERENCES app.tax_rule (id),
  version_number integer NOT NULL CHECK (version_number >= 1),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
  -- Datas civis (I-11), sem hora nem fuso. `valid_until` ausente = intervalo aberto.
  valid_from date NOT NULL,
  valid_until date,
  -- Centesimos de ponto percentual: 10000 = 100% (I-3). Sem float.
  base_reduction_basis_points integer CHECK (base_reduction_basis_points BETWEEN 0 AND 10000),
  rate_basis_points integer NOT NULL CHECK (rate_basis_points BETWEEN 0 AND 10000),
  source text NOT NULL CHECK (length(btrim(source)) BETWEEN 1 AND 500),
  fixture_note text NOT NULL CHECK (length(fixture_note) <= 500),
  -- Versao otimista: sobe a cada comando aceito.
  lock_version integer NOT NULL DEFAULT 1 CHECK (lock_version >= 1),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL,
  published_by uuid,
  published_at timestamptz,
  archived_by uuid,
  archived_at timestamptz,

  CONSTRAINT tax_rule_version_number_unique UNIQUE (tax_rule_id, version_number),
  CONSTRAINT tax_rule_version_validity_order CHECK (valid_until IS NULL OR valid_until >= valid_from),
  CONSTRAINT tax_rule_version_lifecycle CHECK (
    (status = 'DRAFT'
      AND published_at IS NULL AND published_by IS NULL AND archived_at IS NULL AND archived_by IS NULL)
    OR (status = 'PUBLISHED'
      AND published_at IS NOT NULL AND published_by IS NOT NULL AND archived_at IS NULL AND archived_by IS NULL)
    OR (status = 'ARCHIVED'
      AND published_at IS NOT NULL AND published_by IS NOT NULL AND archived_at IS NOT NULL AND archived_by IS NOT NULL)
  ),
  -- Limites inclusivos: '[]'. Sem `valid_until`, o intervalo e aberto a direita.
  CONSTRAINT tax_rule_version_no_overlap EXCLUDE USING gist (
    tax_rule_id WITH =,
    daterange(valid_from, valid_until, '[]') WITH &&
  ) WHERE (status = 'PUBLISHED')
);

CREATE INDEX tax_rule_version_rule_idx ON app.tax_rule_version (tax_rule_id, version_number DESC);
CREATE INDEX tax_rule_version_applicable_idx
  ON app.tax_rule_version (tax_rule_id, valid_from) WHERE status = 'PUBLISHED';

CREATE TABLE app.tax_rule_audit_event (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  sequence bigint NOT NULL GENERATED ALWAYS AS IDENTITY,
  tax_rule_version_id uuid NOT NULL REFERENCES app.tax_rule_version (id),
  action text NOT NULL CHECK (action IN ('CREATED', 'UPDATED', 'PUBLISHED', 'ARCHIVED')),
  actor_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL,
  previous_lock_version integer CHECK (previous_lock_version >= 1),
  resulting_lock_version integer NOT NULL CHECK (resulting_lock_version >= 1),
  correlation_id text NOT NULL CHECK (length(btrim(correlation_id)) > 0),
  -- Conteudo da versao no instante do evento (nunca XML nem documento fiscal).
  content jsonb NOT NULL,

  CONSTRAINT tax_rule_audit_previous_consistent CHECK ((action = 'CREATED') = (previous_lock_version IS NULL))
);

CREATE INDEX tax_rule_audit_event_version_idx ON app.tax_rule_audit_event (tax_rule_version_id, sequence);

CREATE TRIGGER tax_rule_audit_event_append_only
  BEFORE UPDATE OR DELETE ON app.tax_rule_audit_event
  FOR EACH ROW EXECUTE FUNCTION app.rejeitar_escrita_em_historico();

-- 2. Imutabilidade da versao (I-7) ---------------------------------------------------------------

-- O conteudo de uma versao publicada ou arquivada nunca muda; so PUBLISHED -> ARCHIVED, e so os
-- campos do arquivamento. Nada volta a rascunho e nada e apagado (nem rascunho).
CREATE OR REPLACE FUNCTION app.proteger_tax_rule_version() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  muda_o_conteudo boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'TAX_RULE_IMMUTABLE: versao de regra tributaria nao e apagada'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW.id <> OLD.id OR NEW.tax_rule_id <> OLD.tax_rule_id OR NEW.version_number <> OLD.version_number
     OR NEW.created_by <> OLD.created_by OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'TAX_RULE_IMMUTABLE: identidade e autoria da versao nao mudam'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF OLD.status = 'ARCHIVED' THEN
    RAISE EXCEPTION 'TAX_RULE_IMMUTABLE: versao arquivada nao muda'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF OLD.status = 'PUBLISHED' AND NEW.status <> 'ARCHIVED' THEN
    RAISE EXCEPTION 'TAX_RULE_IMMUTABLE: versao publicada so pode ser arquivada'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF OLD.status = 'DRAFT' AND NEW.status = 'ARCHIVED' THEN
    RAISE EXCEPTION 'TAX_RULE_IMMUTABLE: rascunho nao e arquivado'
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- Publicar e arquivar nao tocam o conteudo; so a edicao de rascunho (DRAFT -> DRAFT) o muda.
  IF NEW.status <> OLD.status THEN
    muda_o_conteudo :=
      (to_jsonb(NEW) - 'status' - 'lock_version' - 'published_by' - 'published_at' - 'archived_by' - 'archived_at')
      IS DISTINCT FROM
      (to_jsonb(OLD) - 'status' - 'lock_version' - 'published_by' - 'published_at' - 'archived_by' - 'archived_at');

    IF muda_o_conteudo THEN
      RAISE EXCEPTION 'TAX_RULE_IMMUTABLE: publicar ou arquivar nao altera o conteudo'
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER tax_rule_version_protegida
  BEFORE UPDATE OR DELETE ON app.tax_rule_version
  FOR EACH ROW EXECUTE FUNCTION app.proteger_tax_rule_version();

-- 3. Contexto de servico do catalogo -------------------------------------------------------------

-- Servico valido: identidade fixa, finalidade unica, correlationId — e NENHUM tenant, empresa ou
-- usuario. Nao abre tabela de tenant alguma.
CREATE OR REPLACE FUNCTION app.contexto_do_catalogo_tributario() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app.origem_atual() = 'SERVICO'
     AND app.finalidade_atual() = 'CATALOGO_TRIBUTARIO'
     AND app.tenant_atual() IS NULL
     AND app.empresa_tecnica_atual() IS NULL
     AND app.usuario_atual() IS NULL
     AND NULLIF(current_setting('app.identidade_tecnica', true), '') = 'api-catalogo-tributario'
     AND NULLIF(current_setting('app.correlation_id', true), '') IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION app.exigir_contexto_do_catalogo_tributario() RETURNS void
LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF NOT app.contexto_do_catalogo_tributario() THEN
    RAISE EXCEPTION 'contexto de servico do catalogo tributario exigido' USING ERRCODE = 'insufficient_privilege';
  END IF;
END;
$$;

-- 4. Funcoes do catalogo -------------------------------------------------------------------------

-- Forma publica de uma versao: datas civis em texto aaaa-mm-dd (sem fuso), identidade junto.
CREATE TYPE app.tax_rule_version_row AS (
  id uuid,
  tax_rule_id uuid,
  version_number integer,
  status text,
  tax_type text,
  regime text,
  operation_type text,
  valid_from text,
  valid_until text,
  base_reduction_basis_points integer,
  rate_basis_points integer,
  source text,
  fixture_note text,
  lock_version integer,
  created_by uuid,
  created_at timestamptz,
  published_by uuid,
  published_at timestamptz,
  archived_by uuid,
  archived_at timestamptz
);

CREATE OR REPLACE FUNCTION app.tax_rule_row_of(p_id uuid) RETURNS app.tax_rule_version_row
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = app, public, pg_temp AS $$
DECLARE
  linha app.tax_rule_version_row;
BEGIN
  PERFORM app.exigir_contexto_do_catalogo_tributario();

  SELECT v.id, v.tax_rule_id, v.version_number, v.status, r.tax_type, r.regime, r.operation_type,
         to_char(v.valid_from, 'YYYY-MM-DD'), to_char(v.valid_until, 'YYYY-MM-DD'),
         v.base_reduction_basis_points, v.rate_basis_points, v.source, v.fixture_note, v.lock_version,
         v.created_by, v.created_at, v.published_by, v.published_at, v.archived_by, v.archived_at
    INTO linha
    FROM app.tax_rule_version v
    JOIN app.tax_rule r ON r.id = v.tax_rule_id
   WHERE v.id = p_id;

  IF linha.id IS NULL THEN
    RAISE EXCEPTION 'TAX_RULE_NOT_FOUND: versao de regra tributaria inexistente';
  END IF;

  RETURN linha;
END;
$$;

CREATE OR REPLACE FUNCTION app.tax_rule_get(p_id uuid) RETURNS app.tax_rule_version_row
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = app, public, pg_temp AS $$
BEGIN
  PERFORM app.exigir_contexto_do_catalogo_tributario();
  RETURN app.tax_rule_row_of(p_id);
END;
$$;

CREATE OR REPLACE FUNCTION app.tax_rule_write_audit(
  p_version_id uuid, p_action text, p_actor uuid, p_now timestamptz,
  p_previous_lock_version integer, p_resulting_lock_version integer, p_correlation_id text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, public, pg_temp AS $$
BEGIN
  PERFORM app.exigir_contexto_do_catalogo_tributario();

  INSERT INTO app.tax_rule_audit_event
    (tax_rule_version_id, action, actor_id, occurred_at, previous_lock_version, resulting_lock_version,
     correlation_id, content)
  VALUES
    (p_version_id, p_action, p_actor, p_now, p_previous_lock_version, p_resulting_lock_version,
     p_correlation_id, to_jsonb(app.tax_rule_row_of(p_version_id)));
END;
$$;

CREATE OR REPLACE FUNCTION app.tax_rule_create_draft(
  p_actor uuid, p_now timestamptz, p_correlation_id text,
  p_tax_type text, p_regime text, p_operation_type text,
  p_valid_from date, p_valid_until date, p_base_reduction integer, p_rate integer,
  p_source text, p_fixture_note text
) RETURNS app.tax_rule_version_row
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, public, pg_temp AS $$
DECLARE
  v_rule_id uuid;
  v_number integer;
  v_id uuid;
BEGIN
  PERFORM app.exigir_contexto_do_catalogo_tributario();

  INSERT INTO app.tax_rule (tax_type, regime, operation_type)
  VALUES (p_tax_type, p_regime, p_operation_type)
  ON CONFLICT (tax_type, regime, operation_type) DO NOTHING;

  -- Trava a identidade: duas criacoes concorrentes numeram as versoes em fila.
  SELECT id INTO v_rule_id FROM app.tax_rule
   WHERE tax_type = p_tax_type AND regime = p_regime AND operation_type = p_operation_type
   FOR UPDATE;

  SELECT COALESCE(max(version_number), 0) + 1 INTO v_number
    FROM app.tax_rule_version WHERE tax_rule_id = v_rule_id;

  INSERT INTO app.tax_rule_version
    (tax_rule_id, version_number, valid_from, valid_until, base_reduction_basis_points, rate_basis_points,
     source, fixture_note, created_by, created_at)
  VALUES
    (v_rule_id, v_number, p_valid_from, p_valid_until, p_base_reduction, p_rate,
     p_source, p_fixture_note, p_actor, p_now)
  RETURNING id INTO v_id;

  PERFORM app.tax_rule_write_audit(v_id, 'CREATED', p_actor, p_now, NULL, 1, p_correlation_id);

  RETURN app.tax_rule_row_of(v_id);
END;
$$;

-- Trava a versao e confere existencia, estado esperado e versao otimista, nessa ordem: um comando
-- fora do ciclo de vida e IMUTAVEL antes de ser CONFLITO.
CREATE OR REPLACE FUNCTION app.tax_rule_lock_for_command(
  p_id uuid, p_expected_status text, p_expected_lock_version integer
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, public, pg_temp AS $$
DECLARE
  v_status text;
  v_lock integer;
BEGIN
  PERFORM app.exigir_contexto_do_catalogo_tributario();

  SELECT status, lock_version INTO v_status, v_lock FROM app.tax_rule_version WHERE id = p_id FOR UPDATE;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'TAX_RULE_NOT_FOUND: versao de regra tributaria inexistente';
  END IF;
  IF v_status <> p_expected_status THEN
    RAISE EXCEPTION 'TAX_RULE_IMMUTABLE: comando fora do ciclo de vida da versao (%)', v_status;
  END IF;
  IF v_lock <> p_expected_lock_version THEN
    RAISE EXCEPTION 'TAX_RULE_VERSION_CONFLICT: a versao foi alterada por outra pessoa';
  END IF;

  RETURN v_lock;
END;
$$;

CREATE OR REPLACE FUNCTION app.tax_rule_update_draft(
  p_actor uuid, p_now timestamptz, p_correlation_id text, p_id uuid, p_expected_lock_version integer,
  p_valid_from date, p_valid_until date, p_base_reduction integer, p_rate integer,
  p_source text, p_fixture_note text
) RETURNS app.tax_rule_version_row
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, public, pg_temp AS $$
DECLARE
  v_lock integer;
BEGIN
  v_lock := app.tax_rule_lock_for_command(p_id, 'DRAFT', p_expected_lock_version);

  UPDATE app.tax_rule_version
     SET valid_from = p_valid_from, valid_until = p_valid_until,
         base_reduction_basis_points = p_base_reduction, rate_basis_points = p_rate,
         source = p_source, fixture_note = p_fixture_note, lock_version = v_lock + 1
   WHERE id = p_id;

  PERFORM app.tax_rule_write_audit(p_id, 'UPDATED', p_actor, p_now, v_lock, v_lock + 1, p_correlation_id);

  RETURN app.tax_rule_row_of(p_id);
END;
$$;

CREATE OR REPLACE FUNCTION app.tax_rule_publish(
  p_actor uuid, p_now timestamptz, p_correlation_id text, p_id uuid, p_expected_lock_version integer
) RETURNS app.tax_rule_version_row
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, public, pg_temp AS $$
DECLARE
  v_lock integer;
BEGIN
  v_lock := app.tax_rule_lock_for_command(p_id, 'DRAFT', p_expected_lock_version);

  -- A restricao de exclusao rejeita a sobreposicao (23P01); a excecao desfaz tudo.
  UPDATE app.tax_rule_version
     SET status = 'PUBLISHED', published_by = p_actor, published_at = p_now, lock_version = v_lock + 1
   WHERE id = p_id;

  PERFORM app.tax_rule_write_audit(p_id, 'PUBLISHED', p_actor, p_now, v_lock, v_lock + 1, p_correlation_id);

  RETURN app.tax_rule_row_of(p_id);
END;
$$;

CREATE OR REPLACE FUNCTION app.tax_rule_archive(
  p_actor uuid, p_now timestamptz, p_correlation_id text, p_id uuid, p_expected_lock_version integer
) RETURNS app.tax_rule_version_row
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, public, pg_temp AS $$
DECLARE
  v_lock integer;
BEGIN
  v_lock := app.tax_rule_lock_for_command(p_id, 'PUBLISHED', p_expected_lock_version);

  UPDATE app.tax_rule_version
     SET status = 'ARCHIVED', archived_by = p_actor, archived_at = p_now, lock_version = v_lock + 1
   WHERE id = p_id;

  PERFORM app.tax_rule_write_audit(p_id, 'ARCHIVED', p_actor, p_now, v_lock, v_lock + 1, p_correlation_id);

  RETURN app.tax_rule_row_of(p_id);
END;
$$;

CREATE OR REPLACE FUNCTION app.tax_rule_list(
  p_tax_type text, p_regime text, p_operation_type text, p_status text, p_valid_on date,
  p_limit integer, p_offset integer
) RETURNS SETOF app.tax_rule_version_row
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = app, public, pg_temp AS $$
BEGIN
  PERFORM app.exigir_contexto_do_catalogo_tributario();

  RETURN QUERY
  SELECT v.id, v.tax_rule_id, v.version_number, v.status, r.tax_type, r.regime, r.operation_type,
         to_char(v.valid_from, 'YYYY-MM-DD'), to_char(v.valid_until, 'YYYY-MM-DD'),
         v.base_reduction_basis_points, v.rate_basis_points, v.source, v.fixture_note, v.lock_version,
         v.created_by, v.created_at, v.published_by, v.published_at, v.archived_by, v.archived_at
    FROM app.tax_rule_version v
    JOIN app.tax_rule r ON r.id = v.tax_rule_id
   WHERE (p_tax_type IS NULL OR r.tax_type = p_tax_type)
     AND (p_regime IS NULL OR r.regime = p_regime)
     AND (p_operation_type IS NULL OR r.operation_type = p_operation_type)
     AND (p_status IS NULL OR v.status = p_status)
     AND (p_valid_on IS NULL OR (v.valid_from <= p_valid_on AND (v.valid_until IS NULL OR p_valid_on <= v.valid_until)))
   ORDER BY v.valid_from DESC, v.version_number DESC, v.id DESC
   LIMIT p_limit OFFSET p_offset;
END;
$$;

CREATE OR REPLACE FUNCTION app.tax_rule_count(
  p_tax_type text, p_regime text, p_operation_type text, p_status text, p_valid_on date
) RETURNS bigint
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = app, public, pg_temp AS $$
DECLARE
  v_total bigint;
BEGIN
  PERFORM app.exigir_contexto_do_catalogo_tributario();

  SELECT count(*) INTO v_total
    FROM app.tax_rule_version v
    JOIN app.tax_rule r ON r.id = v.tax_rule_id
   WHERE (p_tax_type IS NULL OR r.tax_type = p_tax_type)
     AND (p_regime IS NULL OR r.regime = p_regime)
     AND (p_operation_type IS NULL OR r.operation_type = p_operation_type)
     AND (p_status IS NULL OR v.status = p_status)
     AND (p_valid_on IS NULL OR (v.valid_from <= p_valid_on AND (v.valid_until IS NULL OR p_valid_on <= v.valid_until)));

  RETURN v_total;
END;
$$;

-- Candidatas publicadas e vigentes na data do fato (I-8). No maximo duas: com uma so a regra e
-- unica; com duas, o dominio responde "ambigua" — nunca ha precedencia por data de criacao.
CREATE OR REPLACE FUNCTION app.tax_rule_find_applicable(
  p_tax_type text, p_regime text, p_operation_type text, p_fact_date date
) RETURNS SETOF app.tax_rule_version_row
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = app, public, pg_temp AS $$
BEGIN
  PERFORM app.exigir_contexto_do_catalogo_tributario();

  RETURN QUERY
  SELECT v.id, v.tax_rule_id, v.version_number, v.status, r.tax_type, r.regime, r.operation_type,
         to_char(v.valid_from, 'YYYY-MM-DD'), to_char(v.valid_until, 'YYYY-MM-DD'),
         v.base_reduction_basis_points, v.rate_basis_points, v.source, v.fixture_note, v.lock_version,
         v.created_by, v.created_at, v.published_by, v.published_at, v.archived_by, v.archived_at
    FROM app.tax_rule_version v
    JOIN app.tax_rule r ON r.id = v.tax_rule_id
   WHERE r.tax_type = p_tax_type AND r.regime = p_regime AND r.operation_type = p_operation_type
     AND v.status = 'PUBLISHED'
     AND v.valid_from <= p_fact_date AND (v.valid_until IS NULL OR p_fact_date <= v.valid_until)
   ORDER BY v.valid_from DESC, v.version_number DESC
   LIMIT 2;
END;
$$;

-- 5. Privilegios ---------------------------------------------------------------------------------

-- Global: a aplicacao nao tem privilegio algum; so as funcoes SECURITY DEFINER acima.
REVOKE ALL ON app.tax_rule, app.tax_rule_version, app.tax_rule_audit_event FROM contaia_app;

REVOKE ALL ON FUNCTION
  app.contexto_do_catalogo_tributario(), app.exigir_contexto_do_catalogo_tributario(),
  app.tax_rule_row_of(uuid), app.tax_rule_get(uuid),
  app.tax_rule_write_audit(uuid, text, uuid, timestamptz, integer, integer, text),
  app.tax_rule_lock_for_command(uuid, text, integer),
  app.tax_rule_create_draft(uuid, timestamptz, text, text, text, text, date, date, integer, integer, text, text),
  app.tax_rule_update_draft(uuid, timestamptz, text, uuid, integer, date, date, integer, integer, text, text),
  app.tax_rule_publish(uuid, timestamptz, text, uuid, integer),
  app.tax_rule_archive(uuid, timestamptz, text, uuid, integer),
  app.tax_rule_list(text, text, text, text, date, integer, integer),
  app.tax_rule_count(text, text, text, text, date),
  app.tax_rule_find_applicable(text, text, text, date)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
  app.contexto_do_catalogo_tributario(), app.exigir_contexto_do_catalogo_tributario(),
  app.tax_rule_get(uuid),
  app.tax_rule_create_draft(uuid, timestamptz, text, text, text, text, date, date, integer, integer, text, text),
  app.tax_rule_update_draft(uuid, timestamptz, text, uuid, integer, date, date, integer, integer, text, text),
  app.tax_rule_publish(uuid, timestamptz, text, uuid, integer),
  app.tax_rule_archive(uuid, timestamptz, text, uuid, integer),
  app.tax_rule_list(text, text, text, text, date, integer, integer),
  app.tax_rule_count(text, text, text, text, date),
  app.tax_rule_find_applicable(text, text, text, date)
TO contaia_app;

-- O `pg_default_acl` do schema volta a conceder DELETE a cada tabela nova (ver 0004).
ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE DELETE ON TABLES FROM contaia_app;
REVOKE DELETE ON ALL TABLES IN SCHEMA app FROM contaia_app;
