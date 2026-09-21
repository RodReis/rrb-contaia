-- SPEC-004/F4 — documentos da empresa cliente.
--
-- Tres tabelas: a exigencia (o que o escritorio cobra), a versao do arquivo (o
-- que foi entregue, com no maximo uma vigente) e o evento documental, que e
-- append-only como o historico da F3.
--
-- O conteudo do arquivo nao mora aqui: o banco guarda metadado e chave do
-- storage, que e privado e so e lido pela aplicacao depois de autorizar
-- (SPEC-004 secao 3.2). Guardar bytes em coluna transformaria todo backup do
-- banco em copia de documento de cliente.

-- 0. Chaves compostas de tenant ----------------------------------------------
--
-- Achado desta fatia: uma FK simples para `app.empresa(id)` nao impede que um
-- escritorio grave uma linha apontando para a empresa de outro. A RLS confere o
-- `tenant_id` da propria linha — que o atacante preenche com o dele — e nada
-- confere que a empresa referenciada pertence a esse tenant. O mesmo vale para
-- `usuario_id` no evento: sem isso, o autor auditado poderia ser de outro
-- escritorio.
--
-- A correcao e estrutural: as tabelas desta fatia referenciam o par
-- (tenant_id, empresa_id) e (tenant_id, usuario_id), e o banco recusa o
-- cruzamento. Exige uma UNIQUE sobre o par na tabela alvo, criada aqui.
ALTER TABLE app.empresa
  ADD CONSTRAINT empresa_id_tenant_unico UNIQUE (id, tenant_id);

ALTER TABLE app.usuario
  ADD CONSTRAINT usuario_id_tenant_unico UNIQUE (id, tenant_id);

-- 1. Exigencia documental ----------------------------------------------------
--
-- Uma linha por exigencia da empresa, seja do checklist padrao (secao 2.1) ou
-- especifica do escritorio. `codigo` identifica a do checklist e e nulo na
-- especifica: e o que permite reconciliar a exigencia quando a aplicabilidade
-- muda na F3 sem depender de casar pelo nome, que o usuario pode reescrever.
CREATE TABLE app.empresa_exigencia_documental (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES app.tenant(id),
  empresa_id uuid NOT NULL,

  codigo text CHECK (codigo IN (
    'CONTRATO_SOCIAL', 'CARTAO_CNPJ', 'INSCRICAO_ESTADUAL', 'INSCRICAO_MUNICIPAL',
    'ALVARA_DE_FUNCIONAMENTO', 'DOCUMENTO_DO_RESPONSAVEL', 'COMPROVANTE_DE_ENDERECO'
  )),
  nome text NOT NULL,
  descricao text,
  -- Data-limite opcional da exigencia especifica (secao 2.1). E prazo para
  -- entregar, diferente da `validade`, que e prazo do arquivo entregue.
  data_limite date,

  estado text NOT NULL DEFAULT 'PENDENTE' CHECK (estado IN (
    'PENDENTE', 'ENVIADO', 'APROVADO', 'REJEITADO', 'DISPENSADO', 'VENCIDO'
  )),
  -- Justificativa vigente de rejeicao ou dispensa (secao 2.4). O historico
  -- guarda todas; esta coluna guarda a que a tela precisa mostrar agora.
  justificativa text,

  -- `NAO_SE_APLICA` na F3 torna a exigencia inaplicavel sem apagar o que ja foi
  -- enviado (secao 2.2): a linha e as versoes continuam, fora do checklist ativo.
  aplicavel boolean NOT NULL DEFAULT true,

  situacao text NOT NULL DEFAULT 'ativo' CHECK (situacao IN ('ativo', 'arquivado')),
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  versao integer NOT NULL DEFAULT 0,

  -- Justificativa acompanha rejeicao e dispensa (secao 2.4). O CHECK impede o
  -- estado sem o porque; o caminho inverso (justificativa sobrando em estado
  -- que nao a exige) e limpo pelo caso de uso na transicao.
  CONSTRAINT empresa_exigencia_justificativa_quando_exigida CHECK (
    estado NOT IN ('REJEITADO', 'DISPENSADO') OR justificativa IS NOT NULL
  ),
  -- A empresa referenciada precisa ser do mesmo tenant da exigencia (I-1).
  CONSTRAINT empresa_exigencia_documental_empresa_do_tenant
    FOREIGN KEY (empresa_id, tenant_id) REFERENCES app.empresa (id, tenant_id)
);

CREATE INDEX empresa_exigencia_documental_tenant_id_idx
  ON app.empresa_exigencia_documental (tenant_id);
CREATE INDEX empresa_exigencia_documental_empresa_id_idx
  ON app.empresa_exigencia_documental (empresa_id);

-- Cada exigencia do checklist padrao existe uma vez por empresa: a
-- reconciliacao da F3 faz UPDATE nesta linha em vez de criar a segunda.
CREATE UNIQUE INDEX empresa_exigencia_documental_codigo_unico_idx
  ON app.empresa_exigencia_documental (empresa_id, codigo)
  WHERE codigo IS NOT NULL AND situacao = 'ativo';

ALTER TABLE app.empresa_exigencia_documental ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.empresa_exigencia_documental FORCE ROW LEVEL SECURITY;

CREATE POLICY empresa_exigencia_documental_isolamento ON app.empresa_exigencia_documental
  USING (tenant_id = app.tenant_atual())
  WITH CHECK (tenant_id = app.tenant_atual());

-- 2. Versao do arquivo -------------------------------------------------------
--
-- Append de versoes: substituir nao sobrescreve, cria linha nova e arquiva a
-- anterior (secao 2.3). A versao anterior e somente leitura e nao pode ser
-- excluida pela interface (secao 3.2).
CREATE TABLE app.empresa_documento_versao (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES app.tenant(id),
  empresa_id uuid NOT NULL,
  exigencia_id uuid NOT NULL REFERENCES app.empresa_exigencia_documental(id),

  -- Ordem da versao dentro da exigencia. Comeca em 1 e e o que a tela mostra;
  -- nao e derivavel de `criado_em`, que empata dentro da transacao.
  numero integer NOT NULL CHECK (numero >= 1),

  -- Metadado do arquivo. `chave_storage` e opaca e carrega o tenant no prefixo:
  -- o isolamento nao depende so do banco (StorageService da F1).
  chave_storage text NOT NULL,
  nome_original text NOT NULL,
  tipo_conteudo text NOT NULL CHECK (tipo_conteudo IN (
    'application/pdf', 'image/png', 'image/jpeg'
  )),
  tamanho_bytes bigint NOT NULL CHECK (tamanho_bytes > 0 AND tamanho_bytes <= 20971520),

  -- Validade do documento entregue (secao 2.4). Opcional; ultrapassada, o
  -- estado da exigencia passa a `VENCIDO`.
  validade date,

  vigente boolean NOT NULL DEFAULT true,
  enviado_por uuid NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  versao integer NOT NULL DEFAULT 0,

  CONSTRAINT empresa_documento_versao_empresa_do_tenant
    FOREIGN KEY (empresa_id, tenant_id) REFERENCES app.empresa (id, tenant_id),
  -- Quem enviou tem de ser usuario do mesmo escritorio: autor auditado de
  -- outro tenant seria trilha falsa.
  CONSTRAINT empresa_documento_versao_autor_do_tenant
    FOREIGN KEY (enviado_por, tenant_id) REFERENCES app.usuario (id, tenant_id)
);

CREATE INDEX empresa_documento_versao_tenant_id_idx
  ON app.empresa_documento_versao (tenant_id);
CREATE INDEX empresa_documento_versao_empresa_id_idx
  ON app.empresa_documento_versao (empresa_id);
-- A aba lista as versoes da exigencia da mais recente para a mais antiga.
CREATE INDEX empresa_documento_versao_exigencia_idx
  ON app.empresa_documento_versao (exigencia_id, numero DESC);

-- No maximo um arquivo vigente por exigencia (secao 2.3). Indice parcial unico
-- em vez de CHECK: o CHECK so enxerga a propria linha e nao impede a segunda.
CREATE UNIQUE INDEX empresa_documento_versao_uma_vigente_idx
  ON app.empresa_documento_versao (exigencia_id)
  WHERE vigente;

CREATE UNIQUE INDEX empresa_documento_versao_numero_unico_idx
  ON app.empresa_documento_versao (exigencia_id, numero);

ALTER TABLE app.empresa_documento_versao ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.empresa_documento_versao FORCE ROW LEVEL SECURITY;

CREATE POLICY empresa_documento_versao_isolamento ON app.empresa_documento_versao
  USING (tenant_id = app.tenant_atual())
  WITH CHECK (tenant_id = app.tenant_atual());

-- Metadado do arquivo nao se corrige depois de gravado: o UPDATE permitido e
-- estritamente o de arquivar a versao (`vigente` true -> false). Qualquer outra
-- alteracao reescreveria o que ja foi auditado (secao 3.2).
CREATE OR REPLACE FUNCTION app.proteger_versao_documental()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'versao documental nao e excluida: arquive-a'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW.vigente IS DISTINCT FROM OLD.vigente AND OLD.vigente AND NOT NEW.vigente THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'versao documental e somente leitura: apenas o arquivamento e permitido'
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER empresa_documento_versao_somente_leitura
  BEFORE UPDATE OR DELETE ON app.empresa_documento_versao
  FOR EACH ROW EXECUTE FUNCTION app.proteger_versao_documental();

-- 3. Evento documental -------------------------------------------------------
--
-- Append-only (I-6), mesma forma do historico da F3: trigger alem do GRANT,
-- porque um GRANT pode escapar numa fatia futura e a trigger vale para qualquer
-- role. Registra upload, substituicao, aprovacao, rejeicao, dispensa,
-- vencimento, visualizacao e download (secao 3.2).
CREATE TABLE app.empresa_evento_documental (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES app.tenant(id),
  empresa_id uuid NOT NULL,
  exigencia_id uuid NOT NULL REFERENCES app.empresa_exigencia_documental(id),
  -- Nulo nas acoes que nao tocam arquivo (criacao da exigencia, dispensa de
  -- exigencia nunca enviada).
  versao_id uuid REFERENCES app.empresa_documento_versao(id),

  acao text NOT NULL CHECK (acao IN (
    'EXIGENCIA_CRIADA', 'ENVIO', 'SUBSTITUICAO', 'APROVACAO', 'REJEICAO',
    'DISPENSA', 'VENCIMENTO', 'VISUALIZACAO', 'DOWNLOAD'
  )),
  estado_anterior text,
  estado_novo text,
  justificativa text,

  -- `VENCIMENTO` e apurado pela aplicacao a partir da data civil, sem usuario
  -- humano por tras; as demais acoes carregam o autor da sessao.
  usuario_id uuid,
  ocorrido_em timestamptz NOT NULL DEFAULT now(),

  -- Mesma razao da F3: `ocorrido_em` empata dentro da transacao e o sufixo do
  -- uuid_v7 e aleatorio, entao dois eventos salvos juntos apareceriam em ordem
  -- arbitraria na auditoria.
  sequencia bigint NOT NULL GENERATED ALWAYS AS IDENTITY,

  CONSTRAINT empresa_evento_documental_autor_exceto_vencimento CHECK (
    acao = 'VENCIMENTO' OR usuario_id IS NOT NULL
  ),
  CONSTRAINT empresa_evento_documental_justificativa_quando_exigida CHECK (
    acao NOT IN ('REJEICAO', 'DISPENSA') OR justificativa IS NOT NULL
  ),
  CONSTRAINT empresa_evento_documental_empresa_do_tenant
    FOREIGN KEY (empresa_id, tenant_id) REFERENCES app.empresa (id, tenant_id),
  -- Autor de outro escritorio nao entra na trilha nem por engano.
  CONSTRAINT empresa_evento_documental_autor_do_tenant
    FOREIGN KEY (usuario_id, tenant_id) REFERENCES app.usuario (id, tenant_id)
);

CREATE INDEX empresa_evento_documental_tenant_id_idx
  ON app.empresa_evento_documental (tenant_id);
CREATE INDEX empresa_evento_documental_empresa_id_idx
  ON app.empresa_evento_documental (empresa_id);
-- O historico documental abre do mais recente para o mais antigo, por empresa.
CREATE INDEX empresa_evento_documental_consulta_idx
  ON app.empresa_evento_documental (empresa_id, ocorrido_em DESC, sequencia DESC);

ALTER TABLE app.empresa_evento_documental ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.empresa_evento_documental FORCE ROW LEVEL SECURITY;

CREATE POLICY empresa_evento_documental_isolamento ON app.empresa_evento_documental
  USING (tenant_id = app.tenant_atual())
  WITH CHECK (tenant_id = app.tenant_atual());

CREATE TRIGGER empresa_evento_documental_append_only
  BEFORE UPDATE OR DELETE ON app.empresa_evento_documental
  FOR EACH ROW EXECUTE FUNCTION app.rejeitar_escrita_em_historico();

-- 4. Privilegios -------------------------------------------------------------
--
-- INSERT e SELECT no evento: historico nao se corrige, se complementa.
GRANT SELECT, INSERT ON app.empresa_evento_documental TO contaia_app;
GRANT SELECT, INSERT, UPDATE ON app.empresa_exigencia_documental TO contaia_app;
GRANT SELECT, INSERT, UPDATE ON app.empresa_documento_versao TO contaia_app;

-- O `pg_default_acl` do schema volta a conceder DELETE a cada tabela nova (ver
-- o comentario extenso em 0004): o revoke precisa alcancar o default e o que ja
-- existe, em toda migration que cria tabela.
ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE DELETE ON TABLES FROM contaia_app;
REVOKE DELETE ON ALL TABLES IN SCHEMA app FROM contaia_app;
REVOKE UPDATE ON app.empresa_evento_documental FROM contaia_app;
