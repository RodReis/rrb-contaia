-- SPEC-008/F8 — Papeis personalizados, matriz de permissoes por revisao e auditoria.
--
-- Modelo:
--   * `app.papel_personalizado` guarda identidade e estado do papel. O nome pode
--     mudar; a unicidade no tenant ignora caixa e espacos (coluna gerada).
--   * `app.papel_personalizado_revisao` e o snapshot integral da matriz em cada
--     revisao. Append-only (I-6): a matriz vigente e a linha cuja `revisao` e a
--     `papel_personalizado.revisao`. Toda mudanca bem-sucedida abre uma revisao.
--   * `app.usuario_papel_personalizado` vincula usuario e papel. Sem DELETE
--     (I-7): vinculo removido recebe `removido_em`.
--   * A auditoria reaproveita `app.usuario_evento` (a aba "Usuarios e acessos"
--     e uma so), que passa a aceitar evento de papel (sem usuario afetado).
--   * `app.resolver_identidade` devolve tambem as permissoes dos papeis
--     personalizados ATIVOS do usuario, na revisao vigente: a mudanca vale na
--     proxima requisicao, sem cache no token.

-- 1. Papel ------------------------------------------------------------------

CREATE TABLE app.papel_personalizado (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES app.tenant(id),
  nome text NOT NULL CHECK (btrim(nome) <> '' AND char_length(nome) <= 80),
  -- Chave de unicidade: sem diferenciar maiusculas, minusculas nem espacos repetidos.
  nome_normalizado text GENERATED ALWAYS AS (
    lower(regexp_replace(btrim(nome), '\s+', ' ', 'g'))
  ) STORED,
  descricao text CHECK (descricao IS NULL OR char_length(descricao) <= 300),
  papel_base text NOT NULL CHECK (papel_base IN (
    'admin_escritorio', 'contador', 'auxiliar', 'auditor_readonly'
  )),
  estado text NOT NULL DEFAULT 'ATIVO' CHECK (estado IN ('ATIVO', 'ARQUIVADO')),
  revisao integer NOT NULL DEFAULT 1 CHECK (revisao >= 1),
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT papel_personalizado_do_tenant UNIQUE (id, tenant_id)
);

CREATE INDEX papel_personalizado_tenant_id_idx ON app.papel_personalizado (tenant_id);

CREATE UNIQUE INDEX papel_personalizado_nome_unico
  ON app.papel_personalizado (tenant_id, nome_normalizado);

-- 2. Revisao (snapshot da matriz) -------------------------------------------

CREATE TABLE app.papel_personalizado_revisao (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES app.tenant(id),
  papel_id uuid NOT NULL,
  revisao integer NOT NULL CHECK (revisao >= 1),
  -- Chaves estaveis do catalogo (`modulo.funcionalidade.acao`), conjunto integral.
  permissoes text[] NOT NULL CHECK (cardinality(permissoes) > 0),
  autor_id uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT papel_revisao_unica UNIQUE (papel_id, revisao),
  CONSTRAINT papel_revisao_papel_do_tenant
    FOREIGN KEY (papel_id, tenant_id) REFERENCES app.papel_personalizado (id, tenant_id),
  CONSTRAINT papel_revisao_autor_do_tenant
    FOREIGN KEY (autor_id, tenant_id) REFERENCES app.usuario (id, tenant_id)
);

CREATE INDEX papel_revisao_tenant_id_idx ON app.papel_personalizado_revisao (tenant_id);

CREATE TRIGGER papel_personalizado_revisao_append_only
  BEFORE UPDATE OR DELETE ON app.papel_personalizado_revisao
  FOR EACH ROW EXECUTE FUNCTION app.rejeitar_escrita_em_historico();

-- 3. Vinculo usuario x papel personalizado ----------------------------------

CREATE TABLE app.usuario_papel_personalizado (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES app.tenant(id),
  usuario_id uuid NOT NULL,
  papel_id uuid NOT NULL,
  atribuido_em timestamptz NOT NULL DEFAULT now(),
  removido_em timestamptz,

  CONSTRAINT usuario_papel_pers_usuario_do_tenant
    FOREIGN KEY (usuario_id, tenant_id) REFERENCES app.usuario (id, tenant_id),
  CONSTRAINT usuario_papel_pers_papel_do_tenant
    FOREIGN KEY (papel_id, tenant_id) REFERENCES app.papel_personalizado (id, tenant_id)
);

CREATE INDEX usuario_papel_pers_tenant_id_idx ON app.usuario_papel_personalizado (tenant_id);
CREATE INDEX usuario_papel_pers_papel_idx ON app.usuario_papel_personalizado (papel_id);

-- Um mesmo papel vigente por usuario; o historico de vinculos removidos fica.
CREATE UNIQUE INDEX usuario_papel_pers_vigente_unico
  ON app.usuario_papel_personalizado (usuario_id, papel_id)
  WHERE removido_em IS NULL;

-- 4. Auditoria: evento de papel na mesma trilha ------------------------------

ALTER TABLE app.usuario_evento
  DROP CONSTRAINT usuario_evento_tipo_check,
  ALTER COLUMN usuario_afetado_id DROP NOT NULL,
  ADD COLUMN papel_id uuid,
  ADD COLUMN revisao integer;

ALTER TABLE app.usuario_evento
  ADD CONSTRAINT usuario_evento_tipo_check CHECK (tipo IN (
    'CONVITE_CRIADO', 'CONVITE_REENVIADO', 'CONVITE_ACEITO', 'CONVITE_EXPIRADO',
    'EMAIL_DE_CONVITE_CORRIGIDO', 'DADOS_E_PAPEIS_ALTERADOS', 'SUSPENSO',
    'REATIVADO', 'ARQUIVADO', 'NOVO_CONVITE_INICIADO',
    'PAPEL_CRIADO', 'PAPEL_DADOS_ALTERADOS', 'PAPEL_MATRIZ_ALTERADA',
    'PAPEL_ARQUIVADO', 'PAPEL_REATIVADO'
  )),
  -- Evento de usuario nomeia o usuario afetado; evento de papel nomeia o papel e a revisao.
  ADD CONSTRAINT usuario_evento_alvo_check CHECK (
    (tipo LIKE 'PAPEL\_%' AND papel_id IS NOT NULL AND revisao IS NOT NULL
       AND usuario_afetado_id IS NULL)
    OR
    (tipo NOT LIKE 'PAPEL\_%' AND papel_id IS NULL AND usuario_afetado_id IS NOT NULL)
  ),
  ADD CONSTRAINT usuario_evento_papel_do_tenant
    FOREIGN KEY (papel_id, tenant_id) REFERENCES app.papel_personalizado (id, tenant_id);

CREATE INDEX usuario_evento_papel_idx ON app.usuario_evento (papel_id) WHERE papel_id IS NOT NULL;

-- 5. RLS --------------------------------------------------------------------

ALTER TABLE app.papel_personalizado ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.papel_personalizado_revisao ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.usuario_papel_personalizado ENABLE ROW LEVEL SECURITY;

ALTER TABLE app.papel_personalizado FORCE ROW LEVEL SECURITY;
ALTER TABLE app.papel_personalizado_revisao FORCE ROW LEVEL SECURITY;
ALTER TABLE app.usuario_papel_personalizado FORCE ROW LEVEL SECURITY;

CREATE POLICY papel_personalizado_isolamento ON app.papel_personalizado
  USING (tenant_id = app.tenant_atual())
  WITH CHECK (tenant_id = app.tenant_atual());

CREATE POLICY papel_personalizado_revisao_isolamento ON app.papel_personalizado_revisao
  USING (tenant_id = app.tenant_atual())
  WITH CHECK (tenant_id = app.tenant_atual());

CREATE POLICY usuario_papel_personalizado_isolamento ON app.usuario_papel_personalizado
  USING (tenant_id = app.tenant_atual())
  WITH CHECK (tenant_id = app.tenant_atual());

-- 6. Resolucao de identidade ------------------------------------------------
--
-- Mesmo caminho estreito de 0002/0009 (SECURITY DEFINER, `search_path` fixo, um
-- unico valor de entrada). Acrescenta as permissoes dos papeis personalizados
-- ATIVOS do usuario na revisao vigente. Papel arquivado nao concede nada.

DROP FUNCTION app.resolver_identidade(text);

CREATE FUNCTION app.resolver_identidade(p_sub text)
RETURNS TABLE (
  usuario_id uuid,
  tenant_id uuid,
  papeis text[],
  permissoes_personalizadas text[],
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
           (SELECT array_agg(p.papel ORDER BY p.papel)
              FROM app.usuario_papel p
             WHERE p.usuario_id = u.id AND p.tenant_id = u.tenant_id
               AND p.removido_em IS NULL),
           ARRAY[]::text[]
         ),
         COALESCE(
           (SELECT array_agg(DISTINCT permissao ORDER BY permissao)
              FROM app.usuario_papel_personalizado v
              JOIN app.papel_personalizado pp
                ON pp.id = v.papel_id AND pp.tenant_id = v.tenant_id AND pp.estado = 'ATIVO'
              JOIN app.papel_personalizado_revisao r
                ON r.papel_id = pp.id AND r.tenant_id = pp.tenant_id AND r.revisao = pp.revisao
             CROSS JOIN LATERAL unnest(r.permissoes) AS permissao
             WHERE v.usuario_id = u.id AND v.tenant_id = u.tenant_id
               AND v.removido_em IS NULL),
           ARRAY[]::text[]
         ),
         t.status
    FROM app.usuario u
    JOIN app.tenant t ON t.id = u.tenant_id
   WHERE u.sub_oidc = p_sub
     AND u.estado = 'ATIVO';
$$;

REVOKE ALL ON FUNCTION app.resolver_identidade(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.resolver_identidade(text) TO contaia_app;

-- 7. Privilegios ------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE ON app.papel_personalizado TO contaia_app;
GRANT SELECT, INSERT ON app.papel_personalizado_revisao TO contaia_app;
GRANT SELECT, INSERT, UPDATE ON app.usuario_papel_personalizado TO contaia_app;

-- O `pg_default_acl` do schema volta a conceder DELETE a cada tabela nova (ver
-- comentario extenso em 0004): o revoke precisa alcancar o default e o que ja
-- existe, em toda migration que cria tabela.
ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE DELETE ON TABLES FROM contaia_app;
REVOKE DELETE ON ALL TABLES IN SCHEMA app FROM contaia_app;
REVOKE UPDATE ON app.papel_personalizado_revisao FROM contaia_app;
