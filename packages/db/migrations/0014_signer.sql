-- SPEC-012/F12 — Signer isolado: operacoes, trilha, estado por finalidade, monitor e alertas.
--
-- O banco guarda SO metadados e resultado sanitizado. Nenhuma coluna aqui recebe XML, resposta
-- do duble, PKCS#12, senha, chave privada, token ou certificado de servico (SPEC-012 §3.11, §6.3).
-- A chave idempotente existe apenas como HMAC-SHA256 hexadecimal (representacao protegida).
--
-- Tres classes (SPEC-010 §3.5):
--   * empresa  signer_operacao e signer_evento (append-only, I-6). O estado corrente de cada
--              finalidade NAO tem tabela: deriva do ultimo evento de SUCESSO/FALHA da empresa;
--   * tenant   signer_notificacao (alerta individual do administrador, como carteira_notificacao);
--   * global   signer_verificacao e signer_incidente_evento (append-only): o monitor do Signer e
--              UM so para todos os escritorios. A aplicacao NAO tem privilegio direto nelas — so
--              as funcoes SECURITY DEFINER abaixo, que exigem o contexto de servico
--              `MONITORAMENTO_DO_SIGNER` (sem tenant, empresa nem usuario).

-- 1. Operacao (idempotencia) -----------------------------------------------------------------

CREATE TABLE app.signer_operacao (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES app.tenant(id),
  empresa_id uuid NOT NULL,

  finalidade text NOT NULL CHECK (finalidade IN ('DFE_TESTE', 'ESOCIAL_TESTE')),
  tipo text NOT NULL CHECK (tipo IN ('ASSINATURA', 'MTLS', 'DIAGNOSTICO')),
  -- HMAC-SHA256 hex da chave idempotente: nunca a chave em claro.
  chave_hmac text NOT NULL CHECK (chave_hmac ~ '^[0-9a-f]{64}$'),
  -- SHA-256 hex do conteudo (XML): identifica o pedido sem guarda-lo.
  hash_conteudo text NOT NULL CHECK (hash_conteudo ~ '^[0-9a-f]{64}$'),

  -- Versao EXATA do certificado usada (SPEC-012 §3.5): referencia opaca, nunca o segredo.
  certificado_id uuid NOT NULL,
  referencia_segredo uuid NOT NULL,

  estado text NOT NULL DEFAULT 'EM_ANDAMENTO'
    CHECK (estado IN ('EM_ANDAMENTO', 'CONCLUIDA', 'RECUSADA', 'FALHA_TRANSITORIA')),
  resultado_codigo text,
  tentativas integer NOT NULL DEFAULT 1 CHECK (tentativas > 0),

  identidade_tecnica text NOT NULL,
  usuario_originador_id uuid,
  correlation_id text NOT NULL,

  iniciado_em timestamptz NOT NULL DEFAULT now(),
  finalizado_em timestamptz,
  sequencia bigint NOT NULL GENERATED ALWAYS AS IDENTITY,

  CONSTRAINT signer_operacao_escopo UNIQUE (id, empresa_id, tenant_id),
  -- Mesma chave com tenant, empresa, finalidade ou conteudo diferentes e CONFLITO (§3.8): por isso
  -- a unicidade e global. A RLS esconde a linha alheia; a colisao chega como 23505 e o Signer a
  -- traduz em 409 sem revelar nada da outra operacao.
  CONSTRAINT signer_operacao_chave_unica UNIQUE (chave_hmac),
  CONSTRAINT signer_operacao_andamento_condizente CHECK ((estado = 'EM_ANDAMENTO') = (finalizado_em IS NULL)),
  CONSTRAINT signer_operacao_recusa_com_codigo CHECK (
    estado NOT IN ('RECUSADA', 'FALHA_TRANSITORIA') OR resultado_codigo IS NOT NULL
  ),
  CONSTRAINT signer_operacao_empresa_do_tenant
    FOREIGN KEY (empresa_id, tenant_id) REFERENCES app.empresa (id, tenant_id),
  CONSTRAINT signer_operacao_certificado_da_empresa
    FOREIGN KEY (certificado_id, empresa_id, tenant_id)
    REFERENCES app.empresa_certificado (id, empresa_id, tenant_id),
  CONSTRAINT signer_operacao_originador_do_tenant
    FOREIGN KEY (usuario_originador_id, tenant_id) REFERENCES app.usuario (id, tenant_id)
);

CREATE INDEX signer_operacao_tenant_id_idx ON app.signer_operacao (tenant_id);
CREATE INDEX signer_operacao_empresa_id_idx ON app.signer_operacao (empresa_id);

-- Resultado terminal nao muda mais: repeticao identica reutiliza o que foi registrado (I-9).
-- `restrict_violation` (23001), como o escopo imutavel. As demais colunas ja sao imutaveis por
-- privilegio de coluna (ver §6).
CREATE OR REPLACE FUNCTION app.proteger_signer_operacao() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW IS NOT DISTINCT FROM OLD THEN
    RETURN NEW;
  END IF;

  IF OLD.estado IN ('CONCLUIDA', 'RECUSADA') THEN
    RAISE EXCEPTION 'resultado terminal do signer nao se altera' USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER signer_operacao_protegida
  BEFORE UPDATE ON app.signer_operacao
  FOR EACH ROW EXECUTE FUNCTION app.proteger_signer_operacao();

-- 2. Evento (trilha append-only) ------------------------------------------------------------

CREATE TABLE app.signer_evento (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES app.tenant(id),
  empresa_id uuid NOT NULL,
  -- Nulo na recusa que nao chegou a criar operacao (contexto, finalidade, certificado).
  operacao_id uuid,

  finalidade text NOT NULL CHECK (finalidade IN ('DFE_TESTE', 'ESOCIAL_TESTE')),
  -- Versao do certificado usada, quando houve; nunca o segredo.
  referencia_segredo uuid,
  identidade_tecnica text NOT NULL,
  usuario_originador_id uuid,
  hash_conteudo text CHECK (hash_conteudo IS NULL OR hash_conteudo ~ '^[0-9a-f]{64}$'),
  chave_hmac text CHECK (chave_hmac IS NULL OR chave_hmac ~ '^[0-9a-f]{64}$'),

  iniciado_em timestamptz NOT NULL,
  finalizado_em timestamptz NOT NULL,
  latencia_ms integer NOT NULL CHECK (latencia_ms >= 0),

  resultado text NOT NULL CHECK (resultado IN ('SUCESSO', 'FALHA', 'RECUSA')),
  -- Codigo estavel (SIGNER_*). Nulo so no sucesso. Nunca detalhe criptografico.
  codigo text,
  correlation_id text NOT NULL,
  -- Reutilizacao idempotente: nao assinou nem chamou o duble outra vez.
  reutilizado boolean NOT NULL DEFAULT false,
  -- Preenchido no diagnostico: quem o disparou (o autor tecnico automatico e `sistema`).
  origem_diagnostico text CHECK (origem_diagnostico IS NULL OR origem_diagnostico IN ('AUTOMATICO', 'MANUAL')),
  sequencia bigint NOT NULL GENERATED ALWAYS AS IDENTITY,

  CONSTRAINT signer_evento_codigo_condizente CHECK ((resultado = 'SUCESSO') = (codigo IS NULL)),
  CONSTRAINT signer_evento_empresa_do_tenant
    FOREIGN KEY (empresa_id, tenant_id) REFERENCES app.empresa (id, tenant_id),
  CONSTRAINT signer_evento_operacao_da_empresa
    FOREIGN KEY (operacao_id, empresa_id, tenant_id)
    REFERENCES app.signer_operacao (id, empresa_id, tenant_id),
  CONSTRAINT signer_evento_originador_do_tenant
    FOREIGN KEY (usuario_originador_id, tenant_id) REFERENCES app.usuario (id, tenant_id)
);

CREATE INDEX signer_evento_tenant_id_idx ON app.signer_evento (tenant_id);
CREATE INDEX signer_evento_empresa_id_idx ON app.signer_evento (empresa_id);
-- Historico do painel: mais recente primeiro, 15 por pagina, filtro por finalidade e resultado.
CREATE INDEX signer_evento_historico_idx
  ON app.signer_evento (empresa_id, iniciado_em DESC, sequencia DESC);

-- Estado corrente por finalidade = ultimo evento de SUCESSO/FALHA da empresa (RECUSA e erro do
-- chamador e nao altera a saude do servico). DF-e e eSocial tem estados independentes (§3.3).
CREATE INDEX signer_evento_estado_idx
  ON app.signer_evento (empresa_id, finalidade, iniciado_em DESC, sequencia DESC)
  WHERE resultado IN ('SUCESSO', 'FALHA');

CREATE TRIGGER signer_evento_append_only
  BEFORE UPDATE OR DELETE ON app.signer_evento
  FOR EACH ROW EXECUTE FUNCTION app.rejeitar_escrita_em_historico();

-- 3. Alerta individual de incidente (tenant) -----------------------------------------------------

CREATE TABLE app.signer_notificacao (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES app.tenant(id),
  usuario_id uuid NOT NULL,
  -- Incidente global do monitor; sem FK (a tabela global e de outra classe).
  incidente_id uuid NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('INDISPONIBILIDADE', 'RECUPERACAO')),
  duracao_ms bigint CHECK (duracao_ms IS NULL OR duracao_ms >= 0),
  lida boolean NOT NULL DEFAULT false,
  lida_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now(),
  sequencia bigint NOT NULL GENERATED ALWAYS AS IDENTITY,

  -- Uma notificacao por administrador, incidente e tipo: reprocessar nao duplica.
  CONSTRAINT signer_notificacao_unica UNIQUE (incidente_id, usuario_id, tipo),
  CONSTRAINT signer_notificacao_duracao_condizente CHECK ((tipo = 'RECUPERACAO') = (duracao_ms IS NOT NULL)),
  CONSTRAINT signer_notificacao_lida_condizente CHECK (
    (lida = false AND lida_em IS NULL) OR (lida = true AND lida_em IS NOT NULL)
  ),
  CONSTRAINT signer_notificacao_usuario_do_tenant
    FOREIGN KEY (usuario_id, tenant_id) REFERENCES app.usuario (id, tenant_id)
);

CREATE INDEX signer_notificacao_tenant_id_idx ON app.signer_notificacao (tenant_id);
CREATE INDEX signer_notificacao_painel_idx
  ON app.signer_notificacao (usuario_id, criado_em DESC, sequencia DESC);
CREATE INDEX signer_notificacao_nao_lidas_idx
  ON app.signer_notificacao (usuario_id) WHERE lida = false;

-- 4. Monitor global (append-only; sem acesso direto da aplicacao) -------------------------------

CREATE TABLE app.signer_verificacao (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  resultado text NOT NULL CHECK (resultado IN ('OK', 'FALHA')),
  latencia_ms integer CHECK (latencia_ms IS NULL OR latencia_ms >= 0),
  correlation_id text NOT NULL,
  verificado_em timestamptz NOT NULL DEFAULT now(),
  sequencia bigint NOT NULL GENERATED ALWAYS AS IDENTITY
);

CREATE INDEX signer_verificacao_ordem_idx ON app.signer_verificacao (sequencia DESC);
CREATE INDEX signer_verificacao_ok_idx ON app.signer_verificacao (sequencia DESC) WHERE resultado = 'OK';

CREATE TRIGGER signer_verificacao_append_only
  BEFORE UPDATE OR DELETE ON app.signer_verificacao
  FOR EACH ROW EXECUTE FUNCTION app.rejeitar_escrita_em_historico();

CREATE TABLE app.signer_incidente_evento (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  incidente_id uuid NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('ABERTO', 'ENCERRADO')),
  duracao_ms bigint CHECK (duracao_ms IS NULL OR duracao_ms >= 0),
  ocorrido_em timestamptz NOT NULL DEFAULT now(),
  sequencia bigint NOT NULL GENERATED ALWAYS AS IDENTITY,

  -- Um incidente abre uma vez e encerra uma vez.
  CONSTRAINT signer_incidente_evento_unico UNIQUE (incidente_id, tipo),
  CONSTRAINT signer_incidente_evento_duracao_condizente CHECK ((tipo = 'ENCERRADO') = (duracao_ms IS NOT NULL))
);

CREATE TRIGGER signer_incidente_evento_append_only
  BEFORE UPDATE OR DELETE ON app.signer_incidente_evento
  FOR EACH ROW EXECUTE FUNCTION app.rejeitar_escrita_em_historico();

-- 5. RLS e escopo ------------------------------------------------------------------------------

ALTER TABLE app.signer_operacao ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.signer_evento ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.signer_notificacao ENABLE ROW LEVEL SECURITY;

ALTER TABLE app.signer_operacao FORCE ROW LEVEL SECURITY;
ALTER TABLE app.signer_evento FORCE ROW LEVEL SECURITY;
ALTER TABLE app.signer_notificacao FORCE ROW LEVEL SECURITY;

-- Classe `empresa`: tenant + empresa autorizada (carteira do humano ou a empresa exata do job tecnico).
DO $$
DECLARE
  alvo record;
  comando text;
BEGIN
  FOR alvo IN
    SELECT * FROM (VALUES
      ('signer_operacao',          ARRAY['SELECT', 'INSERT', 'UPDATE']),
      -- Append-only: sem politica de UPDATE/DELETE, a RLS forcada nega.
      ('signer_evento',            ARRAY['SELECT', 'INSERT'])
    ) AS t(tabela, comandos)
  LOOP
    FOREACH comando IN ARRAY alvo.comandos LOOP
      IF comando = 'SELECT' THEN
        EXECUTE format(
          'CREATE POLICY %I ON app.%I FOR SELECT USING (tenant_id = app.tenant_atual() AND app.empresa_autorizada(empresa_id))',
          alvo.tabela || '_select', alvo.tabela);
      ELSIF comando = 'INSERT' THEN
        EXECUTE format(
          'CREATE POLICY %I ON app.%I FOR INSERT WITH CHECK (tenant_id = app.tenant_atual() AND app.empresa_autorizada(empresa_id))',
          alvo.tabela || '_insert', alvo.tabela);
      ELSE
        EXECUTE format(
          'CREATE POLICY %I ON app.%I FOR UPDATE USING (tenant_id = app.tenant_atual() AND app.empresa_autorizada(empresa_id)) WITH CHECK (tenant_id = app.tenant_atual() AND app.empresa_autorizada(empresa_id))',
          alvo.tabela || '_update', alvo.tabela);
      END IF;
    END LOOP;
  END LOOP;
END
$$;

CREATE TRIGGER escopo_imutavel BEFORE UPDATE ON app.signer_operacao
  FOR EACH ROW EXECUTE FUNCTION app.proteger_escopo_empresa();
CREATE TRIGGER escopo_imutavel BEFORE UPDATE ON app.signer_evento
  FOR EACH ROW EXECUTE FUNCTION app.proteger_escopo_empresa();

-- Classe `tenant`, leitura `proprio_usuario` e escrita `dono_ou_admin` (como carteira_notificacao):
-- o destinatario le e marca como lida a sua; a gestao de acesso le e grava todas. O INSERT dos
-- alertas e da funcao SECURITY DEFINER do monitor, nao de contexto humano.
DO $$
DECLARE
  gestao text := 'tenant_id = app.tenant_atual() AND app.gestao_de_acesso()';
  dono text := 'tenant_id = app.tenant_atual() AND app.contexto_humano() AND (app.gestao_de_acesso() OR (usuario_id = app.usuario_atual() AND app.usuario_ativo_atual()))';
BEGIN
  EXECUTE format('CREATE POLICY signer_notificacao_leitura ON app.signer_notificacao FOR SELECT USING (%s)', dono);
  EXECUTE format('CREATE POLICY signer_notificacao_insercao ON app.signer_notificacao FOR INSERT WITH CHECK (%s)', gestao);
  EXECUTE format('CREATE POLICY signer_notificacao_alteracao ON app.signer_notificacao FOR UPDATE USING (%s) WITH CHECK (%s)', dono, dono);
END
$$;

-- 6. Contexto de servico e funcoes do monitor ----------------------------------------------------

-- Servico valido: identidade fixa, finalidade unica, correlationId — e NENHUM tenant, empresa ou
-- usuario. Nao e contexto humano nem tecnico: nao abre tabela de tenant alguma.
CREATE OR REPLACE FUNCTION app.contexto_de_servico() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app.origem_atual() = 'SERVICO'
     AND app.finalidade_atual() = 'MONITORAMENTO_DO_SIGNER'
     AND app.tenant_atual() IS NULL
     AND app.empresa_tecnica_atual() IS NULL
     AND app.usuario_atual() IS NULL
     AND NULLIF(current_setting('app.identidade_tecnica', true), '') = 'workers-monitor-signer'
     AND NULLIF(current_setting('app.correlation_id', true), '') IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION app.exigir_contexto_de_servico() RETURNS void
LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF NOT app.contexto_de_servico() THEN
    RAISE EXCEPTION 'contexto de servico do monitor do signer exigido' USING ERRCODE = 'insufficient_privilege';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION app.signer_registrar_verificacao(
  p_resultado text, p_latencia_ms integer, p_correlation_id text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, public, pg_temp AS $$
BEGIN
  PERFORM app.exigir_contexto_de_servico();
  INSERT INTO app.signer_verificacao (resultado, latencia_ms, correlation_id)
  VALUES (p_resultado, p_latencia_ms, p_correlation_id);
END;
$$;

-- Estado do monitor, derivado da trilha: falhas desde a ultima verificacao valida e o incidente
-- aberto (ABERTO sem ENCERRADO), se houver.
CREATE OR REPLACE FUNCTION app.signer_estado_do_monitor()
RETURNS TABLE (falhas_consecutivas integer, incidente_id uuid, incidente_aberto_em timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, public, pg_temp AS $$
BEGIN
  PERFORM app.exigir_contexto_de_servico();

  RETURN QUERY
  SELECT
    (SELECT count(*)::integer FROM app.signer_verificacao v
      WHERE v.resultado = 'FALHA'
        AND v.sequencia > COALESCE((SELECT max(o.sequencia) FROM app.signer_verificacao o WHERE o.resultado = 'OK'), 0)),
    aberto.incidente_id,
    aberto.ocorrido_em
  FROM (SELECT 1) AS base
  LEFT JOIN LATERAL (
    SELECT e.incidente_id, e.ocorrido_em
      FROM app.signer_incidente_evento e
     WHERE e.tipo = 'ABERTO'
       AND NOT EXISTS (
         SELECT 1 FROM app.signer_incidente_evento f
          WHERE f.incidente_id = e.incidente_id AND f.tipo = 'ENCERRADO')
     ORDER BY e.sequencia DESC
     LIMIT 1
  ) AS aberto ON true;
END;
$$;

-- Abre o incidente; se ja houver um aberto, devolve esse (nunca dois ao mesmo tempo).
CREATE OR REPLACE FUNCTION app.signer_abrir_incidente() RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, public, pg_temp AS $$
DECLARE
  v_id uuid;
BEGIN
  PERFORM app.exigir_contexto_de_servico();

  SELECT e.incidente_id INTO v_id
    FROM app.signer_incidente_evento e
   WHERE e.tipo = 'ABERTO'
     AND NOT EXISTS (
       SELECT 1 FROM app.signer_incidente_evento f
        WHERE f.incidente_id = e.incidente_id AND f.tipo = 'ENCERRADO')
   ORDER BY e.sequencia DESC
   LIMIT 1;

  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  INSERT INTO app.signer_incidente_evento (incidente_id, tipo)
  VALUES (app.uuid_v7(), 'ABERTO')
  RETURNING incidente_id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION app.signer_encerrar_incidente(p_incidente uuid, p_duracao_ms bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, public, pg_temp AS $$
BEGIN
  PERFORM app.exigir_contexto_de_servico();
  INSERT INTO app.signer_incidente_evento (incidente_id, tipo, duracao_ms)
  VALUES (p_incidente, 'ENCERRADO', p_duracao_ms)
  ON CONFLICT (incidente_id, tipo) DO NOTHING;
END;
$$;

-- Notifica os administradores. INDISPONIBILIDADE: cada admin_escritorio ATIVO de todo tenant com
-- certificado vigente (decisao do PI em 07/10/2026). RECUPERACAO: exatamente os que receberam a
-- indisponibilidade deste incidente. Reprocessar nao duplica (unicidade). Devolve quantas criou.
CREATE OR REPLACE FUNCTION app.signer_notificar_incidente(p_incidente uuid, p_tipo text, p_duracao_ms bigint)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, public, pg_temp AS $$
DECLARE
  v_criadas integer;
BEGIN
  PERFORM app.exigir_contexto_de_servico();

  IF p_tipo = 'INDISPONIBILIDADE' THEN
    INSERT INTO app.signer_notificacao (tenant_id, usuario_id, incidente_id, tipo)
    SELECT DISTINCT u.tenant_id, u.id, p_incidente, 'INDISPONIBILIDADE'
      FROM app.usuario u
      JOIN app.usuario_papel p
        ON p.usuario_id = u.id AND p.tenant_id = u.tenant_id
       AND p.papel = 'admin_escritorio' AND p.removido_em IS NULL
     WHERE u.estado = 'ATIVO'
       AND EXISTS (
         SELECT 1 FROM app.empresa_certificado c
          WHERE c.tenant_id = u.tenant_id AND c.estado = 'VIGENTE')
    ON CONFLICT (incidente_id, usuario_id, tipo) DO NOTHING;
  ELSIF p_tipo = 'RECUPERACAO' THEN
    INSERT INTO app.signer_notificacao (tenant_id, usuario_id, incidente_id, tipo, duracao_ms)
    SELECT n.tenant_id, n.usuario_id, p_incidente, 'RECUPERACAO', p_duracao_ms
      FROM app.signer_notificacao n
     WHERE n.incidente_id = p_incidente AND n.tipo = 'INDISPONIBILIDADE'
    ON CONFLICT (incidente_id, usuario_id, tipo) DO NOTHING;
  ELSE
    RAISE EXCEPTION 'tipo de notificacao do signer invalido' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  GET DIAGNOSTICS v_criadas = ROW_COUNT;

  RETURN v_criadas;
END;
$$;

-- Estado GLOBAL do servico para o cartao do painel (SPEC-012 §5.2). Sem dado de tenant: so a ultima
-- verificacao, a ultima latencia valida e se ha incidente aberto. Qualquer contexto valido (humano da
-- carteira ou tecnico) le; o contexto de servico do monitor e quem ESCREVE, nao quem le o painel.
CREATE OR REPLACE FUNCTION app.signer_estado_do_servico()
RETURNS TABLE (
  ultima_verificacao_em timestamptz, ultimo_resultado text, ultima_latencia_ms integer, incidente_aberto boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = app, public, pg_temp AS $$
BEGIN
  IF NOT app.contexto_valido() THEN
    RAISE EXCEPTION 'contexto de acesso exigido' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  SELECT
    ultima.verificado_em,
    ultima.resultado,
    (SELECT o.latencia_ms FROM app.signer_verificacao o WHERE o.resultado = 'OK' ORDER BY o.sequencia DESC LIMIT 1),
    EXISTS (
      SELECT 1 FROM app.signer_incidente_evento e
       WHERE e.tipo = 'ABERTO'
         AND NOT EXISTS (
           SELECT 1 FROM app.signer_incidente_evento f
            WHERE f.incidente_id = e.incidente_id AND f.tipo = 'ENCERRADO'))
  FROM (SELECT 1) AS base
  LEFT JOIN LATERAL (
    SELECT v.verificado_em, v.resultado FROM app.signer_verificacao v ORDER BY v.sequencia DESC LIMIT 1
  ) AS ultima ON true;
END;
$$;

-- 7. Privilegios -------------------------------------------------------------------------------

-- Operacao: so o estado, o resultado, a contagem de tentativas e o fim mudam; o contexto da
-- operacao (chave, hash, certificado, empresa) e imutavel por privilegio de coluna.
REVOKE UPDATE ON app.signer_operacao FROM contaia_app;
GRANT UPDATE (estado, resultado_codigo, tentativas, finalizado_em) ON app.signer_operacao TO contaia_app;

REVOKE UPDATE ON app.signer_evento FROM contaia_app;

REVOKE UPDATE ON app.signer_notificacao FROM contaia_app;
GRANT UPDATE (lida, lida_em) ON app.signer_notificacao TO contaia_app;

-- Global: a aplicacao nao tem privilegio algum; so as funcoes SECURITY DEFINER acima.
REVOKE ALL ON app.signer_verificacao, app.signer_incidente_evento FROM contaia_app;

REVOKE ALL ON FUNCTION
  app.contexto_de_servico(), app.exigir_contexto_de_servico(),
  app.signer_registrar_verificacao(text, integer, text), app.signer_estado_do_monitor(),
  app.signer_abrir_incidente(), app.signer_encerrar_incidente(uuid, bigint),
  app.signer_notificar_incidente(uuid, text, bigint), app.signer_estado_do_servico()
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
  app.contexto_de_servico(), app.exigir_contexto_de_servico(),
  app.signer_registrar_verificacao(text, integer, text), app.signer_estado_do_monitor(),
  app.signer_abrir_incidente(), app.signer_encerrar_incidente(uuid, bigint),
  app.signer_notificar_incidente(uuid, text, bigint), app.signer_estado_do_servico()
TO contaia_app;

-- O `pg_default_acl` do schema volta a conceder DELETE a cada tabela nova (ver 0004).
ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE DELETE ON TABLES FROM contaia_app;
REVOKE DELETE ON ALL TABLES IN SCHEMA app FROM contaia_app;

-- Escopo imutavel da classe `tenant` (SPEC-010 §3.4): UPDATE nao move o alerta para outro tenant.
CREATE TRIGGER escopo_imutavel BEFORE UPDATE ON app.signer_notificacao
  FOR EACH ROW EXECUTE FUNCTION app.proteger_escopo_tenant();
