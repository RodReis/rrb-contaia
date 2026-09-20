-- SPEC-002/F2 — cadastro e ativacao da empresa cliente.
--
-- Isolamento: `tenant_id` sob RLS lida de `app.tenant_id`, como toda tabela do
-- schema (ARCHITECTURE.md 5.1). A empresa e o primeiro registro de negocio do
-- produto: as fatias seguintes penduram documento, pendencia e lancamento nela.

CREATE TABLE app.empresa (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES app.tenant(id),
  status text NOT NULL DEFAULT 'CADASTRO_INCOMPLETO'
    CHECK (status IN ('CADASTRO_INCOMPLETO', 'ATIVA')),

  -- Identificacao (etapa 1). O CNPJ chega na criacao; o resto pode vir depois,
  -- por isso so ele e NOT NULL.
  cnpj text NOT NULL CHECK (cnpj ~ '^[0-9A-Z]{14}$'),
  razao_social text,
  nome_fantasia text,
  logo_arquivo_id uuid REFERENCES app.escritorio_arquivo(id),
  telefone text CHECK (telefone IS NULL OR telefone ~ '^[0-9]{10,11}$'),
  email text,

  -- Dados fiscais (etapa 2).
  regime_tributario text CHECK (regime_tributario IN (
    'SIMPLES_NACIONAL', 'LUCRO_PRESUMIDO', 'LUCRO_REAL'
  )),
  enquadramento_simples text CHECK (enquadramento_simples IN ('MEI', 'NAO_MEI')),
  cnae_principal text,
  inscricao_estadual_situacao text CHECK (inscricao_estadual_situacao IN (
    'POSSUI', 'ISENTO', 'NAO_SE_APLICA'
  )),
  inscricao_estadual_numero text,
  inscricao_municipal_situacao text CHECK (inscricao_municipal_situacao IN (
    'POSSUI', 'ISENTO', 'NAO_SE_APLICA'
  )),
  inscricao_municipal_numero text,

  -- Procedencia da consulta externa (SPEC-002 secao 3.3 e secao 4.4). A situacao
  -- cadastral vem da CNPJa e, quando diferente de `Ativa`, exige confirmacao
  -- explicita antes da ativacao — mas nao bloqueia.
  situacao_cadastral_externa text,
  validado_por_fonte_externa boolean NOT NULL DEFAULT false,

  situacao text NOT NULL DEFAULT 'ativo' CHECK (situacao IN ('ativo', 'arquivado')),
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  versao integer NOT NULL DEFAULT 0,

  -- Enquadramento so existe dentro do Simples: regime diferente nao carrega MEI
  -- (SPEC-002 secao 4.3, decisao do PI "MEI e enquadramento, nao regime").
  CONSTRAINT empresa_enquadramento_apenas_no_simples CHECK (
    enquadramento_simples IS NULL OR regime_tributario = 'SIMPLES_NACIONAL'
  ),
  -- Numero de inscricao so faz sentido com situacao `POSSUI`; `ISENTO` e
  -- `NAO_SE_APLICA` nao carregam numero (SPEC-002 secao 4.3).
  CONSTRAINT empresa_inscricao_estadual_numero_coerente CHECK (
    inscricao_estadual_situacao = 'POSSUI' OR inscricao_estadual_numero IS NULL
  ),
  CONSTRAINT empresa_inscricao_municipal_numero_coerente CHECK (
    inscricao_municipal_situacao = 'POSSUI' OR inscricao_municipal_numero IS NULL
  )
);

CREATE INDEX empresa_tenant_id_idx ON app.empresa (tenant_id);

COMMENT ON COLUMN app.empresa.cnpj IS
  'Somente digitos ou alfanumerico maiusculo, sem mascara; unico por tenant (SPEC-002 secao 4.5).';

-- Unicidade POR TENANT, nao global (SPEC-002 secao 4.5): dois escritorios podem
-- atender a mesma empresa, e um nao pode descobrir o outro por colisao de chave.
-- Difere de `app.tenant.cnpj`, que e global porque o escritorio e a raiz.
CREATE UNIQUE INDEX empresa_cnpj_por_tenant_idx
  ON app.empresa (tenant_id, cnpj)
  WHERE situacao = 'ativo';

CREATE TABLE app.empresa_cnae_secundario (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES app.tenant(id),
  empresa_id uuid NOT NULL REFERENCES app.empresa(id),
  codigo text NOT NULL,
  situacao text NOT NULL DEFAULT 'ativo' CHECK (situacao IN ('ativo', 'arquivado')),
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  versao integer NOT NULL DEFAULT 0
);

CREATE INDEX empresa_cnae_secundario_tenant_id_idx
  ON app.empresa_cnae_secundario (tenant_id);
CREATE INDEX empresa_cnae_secundario_empresa_id_idx
  ON app.empresa_cnae_secundario (empresa_id);
CREATE UNIQUE INDEX empresa_cnae_secundario_unico_idx
  ON app.empresa_cnae_secundario (empresa_id, codigo)
  WHERE situacao = 'ativo';

CREATE TABLE app.empresa_endereco (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES app.tenant(id),
  empresa_id uuid NOT NULL REFERENCES app.empresa(id),
  principal boolean NOT NULL DEFAULT true,
  cep text NOT NULL CHECK (cep ~ '^[0-9]{8}$'),
  logradouro text NOT NULL,
  numero text NOT NULL,
  complemento text,
  bairro text NOT NULL,
  municipio text NOT NULL,
  uf text NOT NULL CHECK (uf ~ '^[A-Z]{2}$'),
  situacao text NOT NULL DEFAULT 'ativo' CHECK (situacao IN ('ativo', 'arquivado')),
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  versao integer NOT NULL DEFAULT 0
);

CREATE INDEX empresa_endereco_tenant_id_idx ON app.empresa_endereco (tenant_id);
CREATE INDEX empresa_endereco_empresa_id_idx ON app.empresa_endereco (empresa_id);

-- Nesta fatia a empresa tem exatamente um endereco principal (SPEC-002 secao 4.4);
-- multiplos enderecos chegam na F3.
CREATE UNIQUE INDEX empresa_endereco_principal_unico_idx
  ON app.empresa_endereco (empresa_id)
  WHERE principal AND situacao = 'ativo';

-- RLS: sem contexto nao retorna nada; com contexto, so o proprio tenant.
ALTER TABLE app.empresa ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.empresa_cnae_secundario ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.empresa_endereco ENABLE ROW LEVEL SECURITY;

ALTER TABLE app.empresa FORCE ROW LEVEL SECURITY;
ALTER TABLE app.empresa_cnae_secundario FORCE ROW LEVEL SECURITY;
ALTER TABLE app.empresa_endereco FORCE ROW LEVEL SECURITY;

CREATE POLICY empresa_isolamento ON app.empresa
  USING (tenant_id = app.tenant_atual())
  WITH CHECK (tenant_id = app.tenant_atual());

CREATE POLICY empresa_cnae_secundario_isolamento ON app.empresa_cnae_secundario
  USING (tenant_id = app.tenant_atual())
  WITH CHECK (tenant_id = app.tenant_atual());

CREATE POLICY empresa_endereco_isolamento ON app.empresa_endereco
  USING (tenant_id = app.tenant_atual())
  WITH CHECK (tenant_id = app.tenant_atual());

-- Sem DELETE: registro de valor fiscal arquiva-se (I-7).
GRANT SELECT, INSERT, UPDATE ON app.empresa, app.empresa_cnae_secundario,
  app.empresa_endereco TO contaia_app;

-- O `ALTER DEFAULT PRIVILEGES ... REVOKE DELETE` do 0001 nao e suficiente
-- sozinho: `pg_default_acl` do schema `app` continuou com `arwd` para
-- `contaia_app`, e toda tabela criada depois nasceu com DELETE — foi o que o
-- anti-drift acusou nas tres tabelas desta fatia. O revoke nao pode ficar
-- apenas no default: precisa alcancar tambem o que ja existe, senao a proxima
-- fatia recria o problema. Repetimos o revoke no default (idempotente) e o
-- aplicamos a todas as tabelas do schema, cobrindo as desta fatia e as do F1.
ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE DELETE ON TABLES FROM contaia_app;
REVOKE DELETE ON ALL TABLES IN SCHEMA app FROM contaia_app;
