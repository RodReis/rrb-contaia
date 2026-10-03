-- SPEC-009/F9 — Carteira do colaborador e isolamento por empresa.
--
-- Modelo:
--   * `app.carteira_vinculo` liga colaborador e empresa. Sem DELETE (I-7): o
--     vinculo encerrado recebe `encerrado_em` e o motivo. Um vinculo ativo por
--     par (indice unico parcial); reatribuir depois de encerrar abre vinculo novo,
--     nunca reativa o antigo (nao ha restauracao automatica).
--   * `app.usuario.revisao_carteira` e a revisao monotonica da carteira do
--     usuario; sobe so quando o conjunto de empresas muda (controle concorrente).
--   * `app.carteira_evento` e o historico global append-only (I-6): um evento por
--     operacao, com autor, origem, afetados e as empresas adicionadas/removidas.
--   * `app.carteira_notificacao` e a notificacao consolidada por colaborador
--     afetado (uma por operacao, nunca uma por vinculo), com destinatario proprio.
--
-- Vinculo, evento e notificacao sao gravados na mesma transacao do caso de uso.
-- A RLS por empresa e da capacidade seguinte; aqui `tenant_id` e `empresa_id`
-- obrigatorios e indexados deixam o vinculo pronto para ela (I-1).

-- 1. Revisao da carteira ----------------------------------------------------

ALTER TABLE app.usuario
  ADD COLUMN revisao_carteira bigint NOT NULL DEFAULT 0 CHECK (revisao_carteira >= 0);

-- 2. Vinculo ----------------------------------------------------------------

CREATE TABLE app.carteira_vinculo (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES app.tenant(id),
  usuario_id uuid NOT NULL,
  empresa_id uuid NOT NULL,
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  encerrado_em timestamptz,
  encerrado_por uuid,
  encerrado_motivo text CHECK (encerrado_motivo IN (
    'REMOCAO', 'ARQUIVAMENTO_USUARIO', 'ARQUIVAMENTO_EMPRESA'
  )),

  CONSTRAINT carteira_vinculo_usuario_do_tenant
    FOREIGN KEY (usuario_id, tenant_id) REFERENCES app.usuario (id, tenant_id),
  CONSTRAINT carteira_vinculo_empresa_do_tenant
    FOREIGN KEY (empresa_id, tenant_id) REFERENCES app.empresa (id, tenant_id),
  CONSTRAINT carteira_vinculo_criador_do_tenant
    FOREIGN KEY (criado_por, tenant_id) REFERENCES app.usuario (id, tenant_id),
  CONSTRAINT carteira_vinculo_encerrador_do_tenant
    FOREIGN KEY (encerrado_por, tenant_id) REFERENCES app.usuario (id, tenant_id),
  CONSTRAINT carteira_vinculo_encerramento_condizente CHECK (
    (encerrado_em IS NULL AND encerrado_motivo IS NULL)
    OR (encerrado_em IS NOT NULL AND encerrado_motivo IS NOT NULL)
  )
);

CREATE INDEX carteira_vinculo_tenant_id_idx ON app.carteira_vinculo (tenant_id);

-- Um vinculo ativo por colaborador e empresa; empresa compartilhada entre
-- colaboradores continua possivel, porque o par inclui o usuario.
CREATE UNIQUE INDEX carteira_vinculo_ativo_unico
  ON app.carteira_vinculo (usuario_id, empresa_id)
  WHERE encerrado_em IS NULL;

-- Decisao de acesso por empresa e listagem das empresas da carteira.
CREATE INDEX carteira_vinculo_empresa_ativo_idx
  ON app.carteira_vinculo (tenant_id, empresa_id)
  WHERE encerrado_em IS NULL;

-- O vinculo so muda de ativo para encerrado; identidade e criacao sao imutaveis.
CREATE OR REPLACE FUNCTION app.proteger_vinculo_de_carteira()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.encerrado_em IS NOT NULL THEN
    RAISE EXCEPTION 'vinculo de carteira encerrado nao se altera'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.id <> OLD.id
     OR NEW.tenant_id <> OLD.tenant_id
     OR NEW.usuario_id <> OLD.usuario_id
     OR NEW.empresa_id <> OLD.empresa_id
     OR NEW.criado_em <> OLD.criado_em
     OR NEW.criado_por IS DISTINCT FROM OLD.criado_por THEN
    RAISE EXCEPTION 'identidade do vinculo de carteira e imutavel'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER carteira_vinculo_protegido
  BEFORE UPDATE ON app.carteira_vinculo
  FOR EACH ROW EXECUTE FUNCTION app.proteger_vinculo_de_carteira();

-- 3. Evento (historico global append-only) ----------------------------------

CREATE TABLE app.carteira_evento (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES app.tenant(id),
  -- `ocorrido_em` empata dentro da transacao; `sequencia` desempata a ordem.
  ocorrido_em timestamptz NOT NULL DEFAULT now(),
  sequencia bigint NOT NULL GENERATED ALWAYS AS IDENTITY,
  origem text NOT NULL CHECK (origem IN (
    'INDIVIDUAL', 'LOTE', 'AUTOATRIBUICAO', 'ARQUIVAMENTO_USUARIO', 'ARQUIVAMENTO_EMPRESA'
  )),
  autor_id uuid,
  -- Um item por colaborador afetado, com nome e CNPJ do momento, revisao antes
  -- e depois e as empresas adicionadas/removidas.
  afetados jsonb NOT NULL CHECK (jsonb_typeof(afetados) = 'array' AND jsonb_array_length(afetados) > 0),
  -- Colunas derivadas para filtrar o historico sem varrer o jsonb.
  usuarios_afetados uuid[] NOT NULL CHECK (cardinality(usuarios_afetados) > 0),
  empresas_afetadas uuid[] NOT NULL CHECK (cardinality(empresas_afetadas) > 0),

  CONSTRAINT carteira_evento_do_tenant UNIQUE (id, tenant_id),
  CONSTRAINT carteira_evento_autor_do_tenant
    FOREIGN KEY (autor_id, tenant_id) REFERENCES app.usuario (id, tenant_id)
);

CREATE INDEX carteira_evento_tenant_id_idx ON app.carteira_evento (tenant_id);
CREATE INDEX carteira_evento_ordem_idx
  ON app.carteira_evento (tenant_id, ocorrido_em DESC, sequencia DESC);

CREATE TRIGGER carteira_evento_append_only
  BEFORE UPDATE OR DELETE ON app.carteira_evento
  FOR EACH ROW EXECUTE FUNCTION app.rejeitar_escrita_em_historico();

-- 4. Notificacao consolidada por colaborador --------------------------------

CREATE TABLE app.carteira_notificacao (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES app.tenant(id),
  usuario_id uuid NOT NULL,
  evento_id uuid NOT NULL,
  -- Resumo das empresas adicionadas e removidas NESTA operacao ({id,nome,cnpj}).
  adicionadas jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(adicionadas) = 'array'),
  removidas jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(removidas) = 'array'),
  lida boolean NOT NULL DEFAULT false,
  lida_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now(),
  sequencia bigint NOT NULL GENERATED ALWAYS AS IDENTITY,

  CONSTRAINT carteira_notificacao_usuario_do_tenant
    FOREIGN KEY (usuario_id, tenant_id) REFERENCES app.usuario (id, tenant_id),
  CONSTRAINT carteira_notificacao_evento_do_tenant
    FOREIGN KEY (evento_id, tenant_id) REFERENCES app.carteira_evento (id, tenant_id),
  -- Uma notificacao por colaborador e por operacao, nunca uma por vinculo.
  CONSTRAINT carteira_notificacao_uma_por_operacao UNIQUE (evento_id, usuario_id),
  CONSTRAINT carteira_notificacao_lida_condizente CHECK (
    (lida = false AND lida_em IS NULL) OR (lida = true AND lida_em IS NOT NULL)
  ),
  CONSTRAINT carteira_notificacao_nao_vazia CHECK (
    jsonb_array_length(adicionadas) + jsonb_array_length(removidas) > 0
  )
);

CREATE INDEX carteira_notificacao_tenant_id_idx ON app.carteira_notificacao (tenant_id);
CREATE INDEX carteira_notificacao_painel_idx
  ON app.carteira_notificacao (usuario_id, criado_em DESC, sequencia DESC);
CREATE INDEX carteira_notificacao_nao_lidas_idx
  ON app.carteira_notificacao (usuario_id) WHERE lida = false;

-- 5. RLS --------------------------------------------------------------------

ALTER TABLE app.carteira_vinculo ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.carteira_evento ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.carteira_notificacao ENABLE ROW LEVEL SECURITY;

ALTER TABLE app.carteira_vinculo FORCE ROW LEVEL SECURITY;
ALTER TABLE app.carteira_evento FORCE ROW LEVEL SECURITY;
ALTER TABLE app.carteira_notificacao FORCE ROW LEVEL SECURITY;

CREATE POLICY carteira_vinculo_isolamento ON app.carteira_vinculo
  USING (tenant_id = app.tenant_atual())
  WITH CHECK (tenant_id = app.tenant_atual());

CREATE POLICY carteira_evento_isolamento ON app.carteira_evento
  USING (tenant_id = app.tenant_atual())
  WITH CHECK (tenant_id = app.tenant_atual());

CREATE POLICY carteira_notificacao_isolamento ON app.carteira_notificacao
  USING (tenant_id = app.tenant_atual())
  WITH CHECK (tenant_id = app.tenant_atual());

-- 6. Privilegios ------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE ON app.carteira_vinculo TO contaia_app;
GRANT SELECT, INSERT ON app.carteira_evento TO contaia_app;
GRANT SELECT, INSERT, UPDATE ON app.carteira_notificacao TO contaia_app;

-- O `pg_default_acl` do schema volta a conceder DELETE a cada tabela nova (ver
-- o comentario extenso em 0004): o revoke tem de alcancar o default e o que ja
-- existe, em toda migration que cria tabela.
ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE DELETE ON TABLES FROM contaia_app;
REVOKE DELETE ON ALL TABLES IN SCHEMA app FROM contaia_app;
REVOKE UPDATE ON app.carteira_evento FROM contaia_app;
