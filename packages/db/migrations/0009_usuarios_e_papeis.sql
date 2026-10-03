-- SPEC-007/F7 — Gestao de usuarios, papeis padrao aditivos, convite e auditoria.
--
-- Mudancas estruturais:
--   * `app.usuario` ganha `estado` (ciclo de vida), telefone e CRC; perde `papel`
--     (um papel so) e `situacao` (ativo/arquivado), que o estado substitui.
--   * Papeis viram vinculo N:N em `app.usuario_papel`. Sem DELETE (I-7): papel
--     removido recebe `removido_em`, e o vigente e `removido_em IS NULL`.
--   * Convite proprio da aplicacao em `app.usuario_convite`: so o hash do token
--     e gravado; uso unico, 48 h, reenvio invalida o anterior.
--   * Auditoria em `app.usuario_evento`, append-only por trigger.
--   * `app.resolver_identidade` passa a devolver os papeis vigentes e so resolve
--     usuario ATIVO; `app.resolver_convite` e o caminho estreito do aceite.

-- 1. Usuario ----------------------------------------------------------------

ALTER TABLE app.usuario
  ADD COLUMN telefone text,
  ADD COLUMN crc text,
  ADD COLUMN estado text;

-- Backfill antes das restricoes: migration que so funciona em tabela vazia nao
-- e migration.
UPDATE app.usuario
   SET estado = CASE situacao WHEN 'ativo' THEN 'ATIVO' ELSE 'ARQUIVADO' END;

ALTER TABLE app.usuario
  ALTER COLUMN estado SET NOT NULL,
  ADD CONSTRAINT usuario_estado_check
    CHECK (estado IN ('CONVIDADO', 'ATIVO', 'SUSPENSO', 'ARQUIVADO'));

-- E-mail unico globalmente, sem distinguir caixa (SPEC-007 secao 3.2): no MVP-1
-- uma identidade pertence a um unico escritorio.
CREATE UNIQUE INDEX usuario_email_unico ON app.usuario (lower(email));

-- 2. Papeis -----------------------------------------------------------------

CREATE TABLE app.usuario_papel (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES app.tenant(id),
  usuario_id uuid NOT NULL,
  papel text NOT NULL CHECK (papel IN (
    'admin_escritorio', 'contador', 'auxiliar', 'auditor_readonly'
  )),
  atribuido_em timestamptz NOT NULL DEFAULT now(),
  removido_em timestamptz,

  CONSTRAINT usuario_papel_usuario_do_tenant
    FOREIGN KEY (usuario_id, tenant_id) REFERENCES app.usuario (id, tenant_id)
);

CREATE INDEX usuario_papel_tenant_id_idx ON app.usuario_papel (tenant_id);

-- Um mesmo papel vigente por usuario; o historico de papeis removidos fica.
CREATE UNIQUE INDEX usuario_papel_vigente_unico
  ON app.usuario_papel (usuario_id, papel)
  WHERE removido_em IS NULL;

INSERT INTO app.usuario_papel (tenant_id, usuario_id, papel)
  SELECT tenant_id, id, papel
    FROM app.usuario
   WHERE papel IN ('admin_escritorio', 'contador', 'auxiliar', 'auditor_readonly');

-- Em vez de mascarar, falha: usuario ativo sem papel padrao depois do backfill
-- (papel legado fora dos quatro do MVP-1) exige decisao do PI, nao um default.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM app.usuario u
     WHERE u.estado = 'ATIVO'
       AND NOT EXISTS (
         SELECT 1 FROM app.usuario_papel p
          WHERE p.usuario_id = u.id AND p.removido_em IS NULL
       )
  ) THEN
    RAISE EXCEPTION 'usuario ativo sem papel padrao apos o backfill de usuario_papel';
  END IF;
END
$$;

-- A resolucao de identidade antiga depende de `papel` e `situacao`.
DROP FUNCTION app.resolver_identidade(text);

ALTER TABLE app.usuario
  DROP COLUMN papel,
  DROP COLUMN situacao;

-- 3. Convite ----------------------------------------------------------------

CREATE TABLE app.usuario_convite (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES app.tenant(id),
  usuario_id uuid NOT NULL,
  -- sha256 hex do token. O token nunca e gravado, listado nem logado.
  token_hash text NOT NULL UNIQUE,
  emitido_em timestamptz NOT NULL DEFAULT now(),
  expira_em timestamptz NOT NULL,
  usado_em timestamptz,
  invalidado_em timestamptz,
  envio_falhou boolean NOT NULL DEFAULT false,

  CONSTRAINT usuario_convite_usuario_do_tenant
    FOREIGN KEY (usuario_id, tenant_id) REFERENCES app.usuario (id, tenant_id)
);

CREATE INDEX usuario_convite_tenant_id_idx ON app.usuario_convite (tenant_id);

-- No maximo um convite pendente (nem usado nem invalidado) por usuario: o
-- reenvio invalida o anterior antes de criar o novo.
CREATE UNIQUE INDEX usuario_convite_vigente_unico
  ON app.usuario_convite (usuario_id)
  WHERE usado_em IS NULL AND invalidado_em IS NULL;

-- 4. Auditoria --------------------------------------------------------------

CREATE TABLE app.usuario_evento (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES app.tenant(id),
  -- `ocorrido_em` empata dentro da transacao e o sufixo do uuid v7 e aleatorio:
  -- `sequencia` e o que ordena dois eventos salvos juntos.
  sequencia bigint NOT NULL GENERATED ALWAYS AS IDENTITY,
  ocorrido_em timestamptz NOT NULL DEFAULT now(),
  tipo text NOT NULL CHECK (tipo IN (
    'CONVITE_CRIADO', 'CONVITE_REENVIADO', 'CONVITE_ACEITO', 'CONVITE_EXPIRADO',
    'EMAIL_DE_CONVITE_CORRIGIDO', 'DADOS_E_PAPEIS_ALTERADOS', 'SUSPENSO',
    'REATIVADO', 'ARQUIVADO', 'NOVO_CONVITE_INICIADO'
  )),
  usuario_afetado_id uuid NOT NULL,
  -- NULL = sistema (ex.: expiracao do convite, que nao tem autor humano).
  autor_id uuid,
  antes jsonb,
  depois jsonb,

  CONSTRAINT usuario_evento_afetado_do_tenant
    FOREIGN KEY (usuario_afetado_id, tenant_id) REFERENCES app.usuario (id, tenant_id),
  CONSTRAINT usuario_evento_autor_do_tenant
    FOREIGN KEY (autor_id, tenant_id) REFERENCES app.usuario (id, tenant_id)
);

CREATE INDEX usuario_evento_tenant_id_idx
  ON app.usuario_evento (tenant_id, sequencia DESC);
CREATE INDEX usuario_evento_afetado_idx
  ON app.usuario_evento (usuario_afetado_id);

-- Expiracao e preguicosa (sem worker): o evento nasce na primeira observacao e
-- este indice garante um unico evento por convite, mesmo sob concorrencia.
CREATE UNIQUE INDEX usuario_evento_expiracao_unica
  ON app.usuario_evento ((depois ->> 'conviteId'))
  WHERE tipo = 'CONVITE_EXPIRADO';

CREATE TRIGGER usuario_evento_append_only
  BEFORE UPDATE OR DELETE ON app.usuario_evento
  FOR EACH ROW EXECUTE FUNCTION app.rejeitar_escrita_em_historico();

-- 5. RLS --------------------------------------------------------------------

ALTER TABLE app.usuario_papel ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.usuario_convite ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.usuario_evento ENABLE ROW LEVEL SECURITY;

ALTER TABLE app.usuario_papel FORCE ROW LEVEL SECURITY;
ALTER TABLE app.usuario_convite FORCE ROW LEVEL SECURITY;
ALTER TABLE app.usuario_evento FORCE ROW LEVEL SECURITY;

CREATE POLICY usuario_papel_isolamento ON app.usuario_papel
  USING (tenant_id = app.tenant_atual())
  WITH CHECK (tenant_id = app.tenant_atual());

CREATE POLICY usuario_convite_isolamento ON app.usuario_convite
  USING (tenant_id = app.tenant_atual())
  WITH CHECK (tenant_id = app.tenant_atual());

CREATE POLICY usuario_evento_isolamento ON app.usuario_evento
  USING (tenant_id = app.tenant_atual())
  WITH CHECK (tenant_id = app.tenant_atual());

-- 6. Resolucao de identidade e de convite -----------------------------------
--
-- Mesmo caminho estreito de 0002: SECURITY DEFINER, `search_path` fixo, aceita
-- um unico valor e devolve so o que o chamador precisa para descobrir o tenant.

CREATE FUNCTION app.resolver_identidade(p_sub text)
RETURNS TABLE (
  usuario_id uuid,
  tenant_id uuid,
  papeis text[],
  tenant_status text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = app, pg_catalog
AS $$
  SELECT u.id,
         u.tenant_id,
         COALESCE(
           array_agg(p.papel ORDER BY p.papel) FILTER (WHERE p.papel IS NOT NULL),
           ARRAY[]::text[]
         ),
         t.status
    FROM app.usuario u
    JOIN app.tenant t ON t.id = u.tenant_id
    LEFT JOIN app.usuario_papel p
      ON p.usuario_id = u.id AND p.removido_em IS NULL
   WHERE u.sub_oidc = p_sub
     AND u.estado = 'ATIVO'
   GROUP BY u.id, u.tenant_id, t.status;
$$;

REVOKE ALL ON FUNCTION app.resolver_identidade(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.resolver_identidade(text) TO contaia_app;

CREATE FUNCTION app.resolver_convite(p_token_hash text)
RETURNS TABLE (
  convite_id uuid,
  tenant_id uuid,
  usuario_id uuid,
  usuario_estado text,
  expira_em timestamptz,
  usado_em timestamptz,
  invalidado_em timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = app, pg_catalog
AS $$
  SELECT c.id, c.tenant_id, c.usuario_id, u.estado,
         c.expira_em, c.usado_em, c.invalidado_em
    FROM app.usuario_convite c
    JOIN app.usuario u ON u.id = c.usuario_id AND u.tenant_id = c.tenant_id
   WHERE c.token_hash = p_token_hash;
$$;

REVOKE ALL ON FUNCTION app.resolver_convite(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.resolver_convite(text) TO contaia_app;

-- 7. Privilegios ------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE ON app.usuario_papel TO contaia_app;
GRANT SELECT, INSERT, UPDATE ON app.usuario_convite TO contaia_app;
GRANT SELECT, INSERT ON app.usuario_evento TO contaia_app;
REVOKE UPDATE, DELETE ON app.usuario_evento FROM contaia_app;

-- O `pg_default_acl` do schema volta a conceder DELETE a cada tabela nova (ver
-- comentario extenso em 0004): o revoke precisa alcancar o default e o que ja
-- existe, em toda migration que cria tabela.
ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE DELETE ON TABLES FROM contaia_app;
REVOKE DELETE ON ALL TABLES IN SCHEMA app FROM contaia_app;
REVOKE UPDATE ON app.usuario_evento FROM contaia_app;
