-- SPEC-005/F5 — Central de Pendencias cadastrais.
--
-- Duas tabelas: o estado atual da pendencia (uma linha por causa, aberta ou
-- resolvida) e o evento, append-only como o historico de F3/F4. A pendencia
-- em si NAO e append-only — ela transita ABERTA -> RESOLVIDA e o estado atual
-- e o que a lista e os indicadores consultam; o *porque* de cada transicao
-- mora no evento.

-- 1. Pendencia -----------------------------------------------------------

CREATE TABLE app.empresa_pendencia (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES app.tenant(id),
  empresa_id uuid NOT NULL,

  origem text NOT NULL CHECK (origem IN ('CADASTRAL', 'DOCUMENTAL')),
  tipo text NOT NULL CHECK (tipo IN (
    'CAMPO_AUSENTE', 'CAMPO_INVALIDO', 'DOCUMENTO_AUSENTE',
    'DOCUMENTO_REJEITADO', 'DOCUMENTO_VENCIDO', 'EXIGENCIA_ESPECIFICA'
  )),

  -- Identificador estavel da causa dentro da empresa (ex.: `campo:cnae`,
  -- `exigencia:<uuid>`). E o que a reconciliacao usa para reconhecer "mesma
  -- causa" e nao duplicar pendencia aberta equivalente (SPEC-005 secao 2).
  chave text NOT NULL,

  estado text NOT NULL DEFAULT 'ABERTA' CHECK (estado IN ('ABERTA', 'RESOLVIDA')),
  data_limite date,

  criado_em timestamptz NOT NULL DEFAULT now(),
  resolvido_em timestamptz,

  CONSTRAINT empresa_pendencia_empresa_do_tenant
    FOREIGN KEY (empresa_id, tenant_id) REFERENCES app.empresa (id, tenant_id),
  -- Resolvida carrega quando; aberta nao — o par (estado, resolvido_em)
  -- inconsistente seria um estado que a interface nao sabe explicar.
  CONSTRAINT empresa_pendencia_resolvido_em_condizente CHECK (
    (estado = 'ABERTA' AND resolvido_em IS NULL)
    OR (estado = 'RESOLVIDA' AND resolvido_em IS NOT NULL)
  )
);

CREATE INDEX empresa_pendencia_tenant_id_idx
  ON app.empresa_pendencia (tenant_id);
CREATE INDEX empresa_pendencia_empresa_id_idx
  ON app.empresa_pendencia (empresa_id);
-- Contagem de pendencias abertas por empresa (indicador da lista, SPEC-005
-- secao 3): filtra por empresa e estado, sem tocar nas resolvidas.
CREATE INDEX empresa_pendencia_empresa_abertas_idx
  ON app.empresa_pendencia (empresa_id)
  WHERE estado = 'ABERTA';
-- A Central ordena por prioridade (calculada na consulta) e depois por
-- criado_em; este indice cobre o desempate e o filtro por tenant+estado.
CREATE INDEX empresa_pendencia_consulta_idx
  ON app.empresa_pendencia (tenant_id, estado, criado_em);

-- Mesma causa nao duplica pendencia ABERTA equivalente (secao 2): indice
-- parcial unico, nao CHECK — CHECK so enxerga a propria linha.
CREATE UNIQUE INDEX empresa_pendencia_causa_aberta_unica_idx
  ON app.empresa_pendencia (empresa_id, chave)
  WHERE estado = 'ABERTA';

ALTER TABLE app.empresa_pendencia ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.empresa_pendencia FORCE ROW LEVEL SECURITY;

CREATE POLICY empresa_pendencia_isolamento ON app.empresa_pendencia
  USING (tenant_id = app.tenant_atual())
  WITH CHECK (tenant_id = app.tenant_atual());

-- 2. Evento de pendencia (historico append-only) --------------------------

CREATE TABLE app.empresa_evento_de_pendencia (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES app.tenant(id),
  empresa_id uuid NOT NULL,
  pendencia_id uuid NOT NULL REFERENCES app.empresa_pendencia(id),

  acao text NOT NULL CHECK (acao IN ('CRIACAO', 'RESOLUCAO', 'DISPENSA')),
  justificativa text,

  -- Reconciliacao automatica (correcao de campo, aprovacao ou vencimento) nao
  -- tem usuario humano por tras; dispensa e resolucao manual sempre tem.
  usuario_id uuid,
  ocorrido_em timestamptz NOT NULL DEFAULT now(),
  sequencia bigint NOT NULL GENERATED ALWAYS AS IDENTITY,

  CONSTRAINT empresa_evento_de_pendencia_justificativa_na_dispensa CHECK (
    acao <> 'DISPENSA' OR justificativa IS NOT NULL
  ),
  CONSTRAINT empresa_evento_de_pendencia_empresa_do_tenant
    FOREIGN KEY (empresa_id, tenant_id) REFERENCES app.empresa (id, tenant_id),
  CONSTRAINT empresa_evento_de_pendencia_autor_do_tenant
    FOREIGN KEY (usuario_id, tenant_id) REFERENCES app.usuario (id, tenant_id)
);

CREATE INDEX empresa_evento_de_pendencia_tenant_id_idx
  ON app.empresa_evento_de_pendencia (tenant_id);
CREATE INDEX empresa_evento_de_pendencia_pendencia_idx
  ON app.empresa_evento_de_pendencia (pendencia_id, ocorrido_em DESC, sequencia DESC);

ALTER TABLE app.empresa_evento_de_pendencia ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.empresa_evento_de_pendencia FORCE ROW LEVEL SECURITY;

CREATE POLICY empresa_evento_de_pendencia_isolamento ON app.empresa_evento_de_pendencia
  USING (tenant_id = app.tenant_atual())
  WITH CHECK (tenant_id = app.tenant_atual());

CREATE TRIGGER empresa_evento_de_pendencia_append_only
  BEFORE UPDATE OR DELETE ON app.empresa_evento_de_pendencia
  FOR EACH ROW EXECUTE FUNCTION app.rejeitar_escrita_em_historico();

-- 3. Privilegios ------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE ON app.empresa_pendencia TO contaia_app;
GRANT SELECT, INSERT ON app.empresa_evento_de_pendencia TO contaia_app;

-- O `pg_default_acl` do schema volta a conceder DELETE a cada tabela nova (ver
-- comentario extenso em 0004): o revoke precisa alcancar o default e o que ja
-- existe, em toda migration que cria tabela.
ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE DELETE ON TABLES FROM contaia_app;
REVOKE DELETE ON ALL TABLES IN SCHEMA app FROM contaia_app;
REVOKE UPDATE ON app.empresa_evento_de_pendencia FROM contaia_app;
