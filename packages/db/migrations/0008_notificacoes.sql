-- SPEC-006/F6 — Notificacoes de pendencias.
--
-- Mesma dualidade de F5: `empresa_notificacao` guarda o estado atual (lida ou
-- nao), `empresa_evento_de_notificacao` e o historico append-only. A
-- notificacao em si NAO e append-only por UPDATE de `lida`/`lida_em` — mas o
-- historico do "quando foi lida, por quem" mora no evento, nunca sobrescrito.

-- 1. Notificacao ------------------------------------------------------------

CREATE TABLE app.empresa_notificacao (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES app.tenant(id),
  empresa_id uuid NOT NULL,

  tipo text NOT NULL CHECK (tipo IN (
    'NOVA_PENDENCIA', 'DOCUMENTO_REJEITADO', 'DOCUMENTO_VENCIDO', 'NOVA_EXIGENCIA'
  )),

  -- Identificador estavel da causa (mesma chave da pendencia que originou a
  -- notificacao, ex. `campo:cnae`, `exigencia:<uuid>`). Usado para nao
  -- duplicar notificacao equivalente em reprocessamento (SPEC-006 secao 2).
  chave text NOT NULL,

  lida boolean NOT NULL DEFAULT false,
  lida_em timestamptz,

  criado_em timestamptz NOT NULL DEFAULT now(),
  sequencia bigint NOT NULL GENERATED ALWAYS AS IDENTITY,

  CONSTRAINT empresa_notificacao_empresa_do_tenant
    FOREIGN KEY (empresa_id, tenant_id) REFERENCES app.empresa (id, tenant_id),
  CONSTRAINT empresa_notificacao_lida_em_condizente CHECK (
    (lida = false AND lida_em IS NULL)
    OR (lida = true AND lida_em IS NOT NULL)
  )
);

CREATE INDEX empresa_notificacao_tenant_id_idx
  ON app.empresa_notificacao (tenant_id);
CREATE INDEX empresa_notificacao_empresa_id_idx
  ON app.empresa_notificacao (empresa_id);

-- Painel: 15 mais recentes do tenant, mais antiga->recente por sequencia
-- (desempate estavel quando `criado_em` colide no mesmo milissegundo).
CREATE INDEX empresa_notificacao_painel_idx
  ON app.empresa_notificacao (tenant_id, criado_em DESC, sequencia DESC);

-- Contador do badge: soh nao lidas, por tenant.
CREATE INDEX empresa_notificacao_nao_lidas_idx
  ON app.empresa_notificacao (tenant_id)
  WHERE lida = false;

-- Mesma causa nao duplica notificacao equivalente (secao 2): indice parcial
-- unico sobre nao lidas — uma nova notificacao da MESMA causa soh nasce depois
-- que a anterior foi lida (mesmo espirito de `empresa_pendencia_causa_aberta_unica_idx`,
-- adaptado: aqui nao ha "resolucao" da notificacao, soh leitura).
--
-- Inclui `tipo`: `chave` sozinha (ex. `exigencia:<id>`) e identica entre as
-- causas PENDENTE (-> NOVA_PENDENCIA), REJEITADO (-> DOCUMENTO_REJEITADO) e
-- vencida (-> DOCUMENTO_VENCIDO) da MESMA exigencia. Sem `tipo` no indice, uma
-- NOVA_PENDENCIA nao lida bloquearia silenciosamente a DOCUMENTO_REJEITADO/
-- DOCUMENTO_VENCIDO da mesma exigencia via `on conflict ... do nothing`
-- (achado C1 da revisao final).
CREATE UNIQUE INDEX empresa_notificacao_causa_nao_lida_unica_idx
  ON app.empresa_notificacao (empresa_id, chave, tipo)
  WHERE lida = false;

ALTER TABLE app.empresa_notificacao ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.empresa_notificacao FORCE ROW LEVEL SECURITY;

CREATE POLICY empresa_notificacao_isolamento ON app.empresa_notificacao
  USING (tenant_id = app.tenant_atual())
  WITH CHECK (tenant_id = app.tenant_atual());

-- 2. Evento de notificacao (historico append-only) --------------------------

CREATE TABLE app.empresa_evento_de_notificacao (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES app.tenant(id),
  empresa_id uuid NOT NULL,
  notificacao_id uuid NOT NULL REFERENCES app.empresa_notificacao(id),

  acao text NOT NULL CHECK (acao IN ('CRIACAO', 'LEITURA')),
  usuario_id uuid,

  criado_em timestamptz NOT NULL DEFAULT now(),
  sequencia bigint NOT NULL GENERATED ALWAYS AS IDENTITY,

  CONSTRAINT empresa_evento_de_notificacao_empresa_do_tenant
    FOREIGN KEY (empresa_id, tenant_id) REFERENCES app.empresa (id, tenant_id),
  CONSTRAINT empresa_evento_de_notificacao_autor_do_tenant
    FOREIGN KEY (usuario_id, tenant_id) REFERENCES app.usuario (id, tenant_id)
);

CREATE INDEX empresa_evento_de_notificacao_notificacao_id_idx
  ON app.empresa_evento_de_notificacao (notificacao_id);
CREATE INDEX empresa_evento_de_notificacao_tenant_id_idx
  ON app.empresa_evento_de_notificacao (tenant_id);

ALTER TABLE app.empresa_evento_de_notificacao ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.empresa_evento_de_notificacao FORCE ROW LEVEL SECURITY;

CREATE POLICY empresa_evento_de_notificacao_isolamento ON app.empresa_evento_de_notificacao
  USING (tenant_id = app.tenant_atual())
  WITH CHECK (tenant_id = app.tenant_atual());

CREATE TRIGGER empresa_evento_de_notificacao_append_only
  BEFORE UPDATE OR DELETE ON app.empresa_evento_de_notificacao
  FOR EACH ROW EXECUTE FUNCTION app.rejeitar_escrita_em_historico();

-- 3. Privilegios --------------------------------------------------------

GRANT SELECT, INSERT, UPDATE ON app.empresa_notificacao TO contaia_app;
REVOKE DELETE ON app.empresa_notificacao FROM contaia_app;

GRANT SELECT, INSERT ON app.empresa_evento_de_notificacao TO contaia_app;
REVOKE UPDATE, DELETE ON app.empresa_evento_de_notificacao FROM contaia_app;

-- O `pg_default_acl` do schema volta a conceder DELETE a cada tabela nova (ver
-- comentario extenso em 0004): o revoke precisa alcancar o default e o que ja
-- existe, em toda migration que cria tabela.
ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE DELETE ON TABLES FROM contaia_app;
REVOKE DELETE ON ALL TABLES IN SCHEMA app FROM contaia_app;
REVOKE UPDATE ON app.empresa_evento_de_notificacao FROM contaia_app;
