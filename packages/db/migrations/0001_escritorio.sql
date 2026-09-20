-- SPEC-001/F1 — cadastro do escritorio (tenant), usuario, enderecos e arquivos.
--
-- Isolamento: todas as tabelas desta fatia carregam `tenant_id` sob RLS lida de
-- `app.tenant_id` (ARCHITECTURE.md 5.1). `empresa_id` nao existe aqui porque
-- nenhuma destas tabelas e transacional de empresa cliente — a coluna chega com
-- a fatia que especifica empresa. O anti-drift abaixo cobre as duas situacoes.

-- UUID v7 (CONVENTION.md secao 9). O PostgreSQL 17 nao traz `uuidv7()` nativo
-- (chegou no 18): geramos aqui, mantendo a ordenacao temporal da chave.
CREATE OR REPLACE FUNCTION app.uuid_v7() RETURNS uuid
LANGUAGE sql VOLATILE PARALLEL SAFE AS $$
  SELECT encode(
    overlay(
      overlay(
        -- 16 bytes aleatorios: os 6 primeiros viram timestamp em milissegundos.
        gen_random_bytes(16)
        PLACING substring(int8send((extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3 FOR 6)
        FROM 1 FOR 6
      )
      -- versao 7 no nibble alto do byte 7, variante RFC 4122 no byte 9.
      PLACING set_byte(
        set_byte('\x0000'::bytea, 0, (get_byte(gen_random_bytes(1), 0) & 15) | 112),
        1, (get_byte(gen_random_bytes(1), 0) & 63) | 128
      ) FROM 7 FOR 2
    ),
    'hex'
  )::uuid;
$$;

-- Contexto de tenant da requisicao. `NULLIF` porque `current_setting` devolve
-- string vazia quando a variavel nunca foi definida: consulta sem contexto
-- precisa resultar em NULL e nao retornar nada (invariante I-2).
CREATE OR REPLACE FUNCTION app.tenant_atual() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid;
$$;

CREATE TABLE app.tenant (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  status text NOT NULL DEFAULT 'CADASTRO_INCOMPLETO'
    CHECK (status IN ('CADASTRO_INCOMPLETO', 'ATIVO')),
  -- Identificacao (etapa 1). Nula enquanto a etapa nao foi salva.
  cnpj text UNIQUE CHECK (cnpj ~ '^[0-9A-Z]{14}$'),
  razao_social text,
  logo_arquivo_id uuid,
  -- Responsavel tecnico (etapa 2).
  responsavel_nome text,
  responsavel_cpf text CHECK (responsavel_cpf ~ '^[0-9]{11}$'),
  responsavel_crc text,
  responsavel_email text,
  responsavel_telefone text CHECK (responsavel_telefone ~ '^[0-9]{10,11}$'),
  situacao text NOT NULL DEFAULT 'ativo' CHECK (situacao IN ('ativo', 'arquivado')),
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  versao integer NOT NULL DEFAULT 0
);

COMMENT ON COLUMN app.tenant.cnpj IS
  'Somente digitos ou alfanumerico maiusculo, sem mascara; unico globalmente (SPEC-001 secao 4.2).';

CREATE TABLE app.usuario (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES app.tenant(id),
  -- `sub` do OIDC: a identidade mora no Keycloak, a associacao mora aqui (ADR-011).
  sub_oidc text NOT NULL UNIQUE,
  email text NOT NULL,
  nome text NOT NULL,
  papel text NOT NULL CHECK (papel IN (
    'admin_escritorio', 'contador', 'auxiliar', 'gestor_financeiro',
    'dp', 'cliente_portal', 'auditor_readonly'
  )),
  situacao text NOT NULL DEFAULT 'ativo' CHECK (situacao IN ('ativo', 'arquivado')),
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  versao integer NOT NULL DEFAULT 0
);

CREATE INDEX usuario_tenant_id_idx ON app.usuario (tenant_id);

CREATE TABLE app.escritorio_endereco (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES app.tenant(id),
  principal boolean NOT NULL DEFAULT false,
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

CREATE INDEX escritorio_endereco_tenant_id_idx ON app.escritorio_endereco (tenant_id);

-- Exatamente um endereco principal ativo por tenant (SPEC-001 secao 3.3).
CREATE UNIQUE INDEX escritorio_endereco_principal_unico_idx
  ON app.escritorio_endereco (tenant_id)
  WHERE principal AND situacao = 'ativo';

CREATE TABLE app.escritorio_arquivo (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES app.tenant(id),
  tipo text NOT NULL CHECK (tipo IN ('LOGO', 'DOCUMENTO')),
  chave_storage text NOT NULL,
  nome_original text NOT NULL,
  tipo_conteudo text NOT NULL,
  tamanho_bytes bigint NOT NULL CHECK (tamanho_bytes > 0),
  situacao text NOT NULL DEFAULT 'ativo' CHECK (situacao IN ('ativo', 'arquivado')),
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  versao integer NOT NULL DEFAULT 0
);

CREATE INDEX escritorio_arquivo_tenant_id_idx ON app.escritorio_arquivo (tenant_id);
CREATE UNIQUE INDEX escritorio_arquivo_chave_storage_idx ON app.escritorio_arquivo (chave_storage);

ALTER TABLE app.tenant ADD CONSTRAINT tenant_logo_arquivo_fk
  FOREIGN KEY (logo_arquivo_id) REFERENCES app.escritorio_arquivo(id);

-- RLS: sem contexto nao retorna nada; com contexto, so o proprio tenant.
ALTER TABLE app.tenant ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.usuario ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.escritorio_endereco ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.escritorio_arquivo ENABLE ROW LEVEL SECURITY;

ALTER TABLE app.tenant FORCE ROW LEVEL SECURITY;
ALTER TABLE app.usuario FORCE ROW LEVEL SECURITY;
ALTER TABLE app.escritorio_endereco FORCE ROW LEVEL SECURITY;
ALTER TABLE app.escritorio_arquivo FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolamento ON app.tenant
  USING (id = app.tenant_atual())
  WITH CHECK (id = app.tenant_atual());

CREATE POLICY usuario_isolamento ON app.usuario
  USING (tenant_id = app.tenant_atual())
  WITH CHECK (tenant_id = app.tenant_atual());

CREATE POLICY escritorio_endereco_isolamento ON app.escritorio_endereco
  USING (tenant_id = app.tenant_atual())
  WITH CHECK (tenant_id = app.tenant_atual());

CREATE POLICY escritorio_arquivo_isolamento ON app.escritorio_arquivo
  USING (tenant_id = app.tenant_atual())
  WITH CHECK (tenant_id = app.tenant_atual());

GRANT SELECT, INSERT, UPDATE ON app.tenant, app.usuario,
  app.escritorio_endereco, app.escritorio_arquivo TO contaia_app;
GRANT EXECUTE ON FUNCTION app.uuid_v7(), app.tenant_atual() TO contaia_app;

-- I-7: registro fiscal, contabil ou trabalhista nao se apaga, arquiva-se.
-- O bootstrap concedeu DELETE por `ALTER DEFAULT PRIVILEGES`, o que daria a
-- aplicacao um caminho de exclusao fisica em toda tabela nova do schema.
-- Revogamos no default e nas tabelas ja criadas; o anti-drift vigia daqui pra frente.
ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE DELETE ON TABLES FROM contaia_app;
REVOKE DELETE ON ALL TABLES IN SCHEMA app FROM contaia_app;
