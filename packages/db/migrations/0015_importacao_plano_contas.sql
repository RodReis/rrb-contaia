-- SPEC-013/F13 — Importação do plano de contas por CSV.
--
-- Tres classes de dados (SPEC-010 §3.5):
--   * empresa  conta_contabil, importacao_plano_contas (tentativa), importacao_plano_contas_linha
--              (staging/rejeicoes), importacao_plano_contas_evento (append-only, I-6).
--   * tenant   importacao_plano_contas_notificacao (conclusão individual para quem iniciou, F6).
--   * global   (nenhuma tabela global nova nesta fatia).
--
-- O plano de contas e as tentativas sao por empresa. O arquivo original e o relatorio ficam no
-- object storage local (MinIO); o banco guarda so metadados, hashes e resultado sanitizado.

-- 1. Plano de contas vigente da empresa ---------------------------------------------------------

CREATE TABLE app.conta_contabil (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES app.tenant(id),
  empresa_id uuid NOT NULL,

  codigo text NOT NULL CHECK (codigo ~ '^[0-9A-Za-z.\-_]{1,64}$'),
  nome text NOT NULL CHECK (char_length(nome) BETWEEN 1 AND 255),
  tipo text NOT NULL CHECK (tipo IN ('analitica', 'sintetica')),
  natureza text NOT NULL CHECK (natureza IN ('devedora', 'credora')),
  conta_pai text CHECK (conta_pai ~ '^[0-9A-Za-z.\-_]{1,64}$'),

  -- Auditoria: codigo nunca muda (chave natural), as demais colunas podem.
  versao bigint NOT NULL DEFAULT 1 CHECK (versao > 0),
  arquivada boolean NOT NULL DEFAULT false,
  arquivada_em timestamptz,
  arquivada_por uuid,

  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  sequencia bigint NOT NULL GENERATED ALWAYS AS IDENTITY,

  CONSTRAINT conta_contabil_chave_natural UNIQUE (empresa_id, codigo),
  CONSTRAINT conta_contabil_empresa_do_tenant
    FOREIGN KEY (empresa_id, tenant_id) REFERENCES app.empresa (id, tenant_id),
  CONSTRAINT conta_contabil_pai_da_mesma_empresa
    FOREIGN KEY (empresa_id, conta_pai) REFERENCES app.conta_contabil (empresa_id, codigo)
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT conta_contabil_arquivada_com_por
    CHECK ((arquivada = false AND arquivada_em IS NULL AND arquivada_por IS NULL)
        OR (arquivada = true AND arquivada_em IS NOT NULL AND arquivada_por IS NOT NULL))
);

CREATE INDEX conta_contabil_empresa_id_idx ON app.conta_contabil (empresa_id);
CREATE INDEX conta_contabil_conta_pai_idx ON app.conta_contabil (empresa_id, conta_pai);

-- Estado corrente imutavel por privilegio de coluna: so arquivo/muda-versao, nao codigo.
CREATE OR REPLACE FUNCTION app.proteger_conta_contabil() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW IS NOT DISTINCT FROM OLD THEN
    RETURN NEW;
  END IF;

  -- Codigo, tenant e empresa sao imutaveis (chave natural + escopo).
  IF NEW.codigo IS DISTINCT FROM OLD.codigo
     OR NEW.empresa_id IS DISTINCT FROM OLD.empresa_id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'chave natural e escopo da conta contabil sao imutaveis'
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- Arquivada so transiciona false -> true, com responsavel e timestamp.
  IF NEW.arquivada = true AND OLD.arquivada = false THEN
    IF NEW.arquivada_por IS NULL OR NEW.arquivada_em IS NULL THEN
      RAISE EXCEPTION 'arquivamento exige responsavel e timestamp' USING ERRCODE = 'restrict_violation';
    END IF;
  ELSIF NEW.arquivada = false AND OLD.arquivada = true THEN
    RAISE EXCEPTION 'reativacao de conta contabil nao e permitida pela importacao; use fluxo proprio'
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- Versao otimista: toda atualizacao legitima incrementa.
  IF NEW.versao = OLD.versao THEN
    NEW.versao := OLD.versao + 1;
  END IF;

  NEW.atualizado_em := now();

  RETURN NEW;
END;
$$;

CREATE TRIGGER conta_contabil_protegida
  BEFORE UPDATE ON app.conta_contabil
  FOR EACH ROW EXECUTE FUNCTION app.proteger_conta_contabil();

-- 2. Tentativa de importacao (idempotencia + estado) --------------------------------------------

CREATE TABLE app.importacao_plano_contas (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES app.tenant(id),
  empresa_id uuid NOT NULL,

  -- Identidade idempotente: hash do arquivo + mapeamento confirmado (SPEC-013 §3.7).
  hash_arquivo text NOT NULL CHECK (hash_arquivo ~ '^[0-9a-f]{64}$'),
  mapeamento jsonb NOT NULL,

  arquivo_nome text NOT NULL CHECK (char_length(arquivo_nome) BETWEEN 1 AND 255),
  arquivo_tamanho bigint NOT NULL CHECK (arquivo_tamanho >= 0 AND arquivo_tamanho <= 10485760),

  estado text NOT NULL DEFAULT 'RECEBIDA'
    CHECK (estado IN (
      'RECEBIDA', 'VALIDANDO', 'AGUARDANDO_CONFIRMACAO', 'APLICANDO',
      'CONCLUIDA', 'CONCLUIDA_COM_REJEICOES', 'REJEITADA', 'CANCELADA', 'FALHA'
    )),

  -- Versao otimista do plano vigente no momento da validacao (SPEC-013 §3.6).
  plano_versao_na_validacao bigint NOT NULL DEFAULT 0 CHECK (plano_versao_na_validacao >= 0),

  totais jsonb NOT NULL DEFAULT '{"lidas":0,"novas":0,"atualizadas":0,"rejeitadas":0}'::jsonb,

  usuario_iniciador_id uuid NOT NULL,
  usuario_confirmador_ou_cancelador_id uuid,

  iniciado_em timestamptz NOT NULL DEFAULT now(),
  finalizado_em timestamptz,
  correlation_id text NOT NULL,
  reutilizada_por_idempotencia boolean NOT NULL DEFAULT false,
  sequencia bigint NOT NULL GENERATED ALWAYS AS IDENTITY,

  CONSTRAINT importacao_plano_contas_empresa_do_tenant
    FOREIGN KEY (empresa_id, tenant_id) REFERENCES app.empresa (id, tenant_id),
  CONSTRAINT importacao_plano_contas_iniciador_do_tenant
    FOREIGN KEY (usuario_iniciador_id, tenant_id) REFERENCES app.usuario (id, tenant_id),
  CONSTRAINT importacao_plano_contas_confirmador_do_tenant
    FOREIGN KEY (usuario_confirmador_ou_cancelador_id, tenant_id)
    REFERENCES app.usuario (id, tenant_id),
  -- Idempotencia: mesma empresa, mesmo arquivo, mesmo mapeamento = mesma tentativa.
  CONSTRAINT importacao_plano_contas_idempotente UNIQUE (empresa_id, tenant_id, hash_arquivo, mapeamento)
);

CREATE INDEX importacao_plano_contas_empresa_id_idx ON app.importacao_plano_contas (empresa_id);
CREATE INDEX importacao_plano_contas_historico_idx
  ON app.importacao_plano_contas (empresa_id, iniciado_em DESC, sequencia DESC);

-- Trilha append-only da tentativa.
CREATE TABLE app.importacao_plano_contas_evento (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES app.tenant(id),
  empresa_id uuid NOT NULL,
  tentativa_id uuid NOT NULL,

  -- Estado antes / depois do evento.
  estado_anterior text
    CHECK (estado_anterior IS NULL OR estado_anterior IN (
      'RECEBIDA', 'VALIDANDO', 'AGUARDANDO_CONFIRMACAO', 'APLICANDO',
      'CONCLUIDA', 'CONCLUIDA_COM_REJEICOES', 'REJEITADA', 'CANCELADA', 'FALHA'
    )),
  estado_novo text NOT NULL
    CHECK (estado_novo IN (
      'RECEBIDA', 'VALIDANDO', 'AGUARDANDO_CONFIRMACAO', 'APLICANDO',
      'CONCLUIDA', 'CONCLUIDA_COM_REJEICOES', 'REJEITADA', 'CANCELADA', 'FALHA'
    )),

  -- Quando houve aplicacao das linhas validas.
  linhas_incluidas integer,
  linhas_atualizadas integer,
  linhas_rejeitadas integer,

  iniciado_em timestamptz NOT NULL,
  finalizado_em timestamptz NOT NULL,
  correlation_id text NOT NULL,
  sequencia bigint NOT NULL GENERATED ALWAYS AS IDENTITY,

  CONSTRAINT importacao_plano_contas_evento_tentativa_da_empresa
    FOREIGN KEY (tentativa_id, empresa_id, tenant_id)
    REFERENCES app.importacao_plano_contas (id, empresa_id, tenant_id),
  CONSTRAINT importacao_plano_contas_evento_progressive
    CHECK (iniciado_em <= finalizado_em)
);

CREATE INDEX importacao_plano_contas_evento_empresa_id_idx ON app.importacao_plano_contas_evento (empresa_id);
CREATE INDEX importacao_plano_contas_evento_tentativa_id_idx ON app.importacao_plano_contas_evento (tentativa_id);

CREATE TRIGGER importacao_plano_contas_evento_append_only
  BEFORE UPDATE OR DELETE ON app.importacao_plano_contas_evento
  FOR EACH ROW EXECUTE FUNCTION app.rejeitar_escrita_em_historico();

-- 3. Linhas de staging (rejeicoes persistidas, para relatorio) ----------------------------------

CREATE TABLE app.importacao_plano_contas_linha (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES app.tenant(id),
  empresa_id uuid NOT NULL,
  tentativa_id uuid NOT NULL,

  numero_da_linha integer NOT NULL CHECK (numero_da_linha > 0),
  codigo text NOT NULL CHECK (char_length(codigo) BETWEEN 1 AND 64),
  nome text NOT NULL CHECK (char_length(nome) BETWEEN 1 AND 255),
  tipo text NOT NULL CHECK (tipo IN ('analitica', 'sintetica')),
  natureza text NOT NULL CHECK (natureza IN ('devedora', 'credora')),
  conta_pai text CHECK (conta_pai ~ '^[0-9A-Za-z.\-_]{1,64}$'),

  aceita boolean NOT NULL DEFAULT false,
  codigo_erro text
    CHECK (codigo_erro IS NULL OR codigo_erro IN (
      'CAMPO_OBRIGATORIO_AUSENTE',
      'VALOR_FORA_DO_DOMINIO',
      'CODIGO_DUPLICADO_NO_ARQUIVO',
      'CONTA_PAI_INEXISTENTE',
      'CONTA_PAI_REJEITADA',
      'CICLO_HIERARQUICO',
      'SINTETICA_COM_FILHAS_NAO_PODE_VIRAR_ANALITICA',
      'CONTA_ARQUIVADA'
    )),
  campo_erro text CHECK (campo_erro IS NULL OR char_length(campo_erro) <= 64),

  sequencia bigint NOT NULL GENERATED ALWAYS AS IDENTITY,

  CONSTRAINT importacao_plano_contas_linha_tentativa_da_empresa
    FOREIGN KEY (tentativa_id, empresa_id, tenant_id)
    REFERENCES app.importacao_plano_contas (id, empresa_id, tenant_id)
);

CREATE INDEX importacao_plano_contas_linha_tentativa_idx
  ON app.importacao_plano_contas_linha (tentativa_id, numero_da_linha);
CREATE INDEX importacao_plano_contas_linha_rejeicoes_idx
  ON app.importacao_plano_contas_linha (tentativa_id, aceita, sequencia) WHERE aceita = false;

-- 4. Notificacao individual de conclusao (classe tenant, como carteira_notificacao) ------------

CREATE TABLE app.importacao_plano_contas_notificacao (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES app.tenant(id),
  usuario_id uuid NOT NULL,
  tentativa_id uuid NOT NULL,

  tipo text NOT NULL CHECK (tipo IN ('CONCLUIDA', 'CONCLUIDA_COM_REJEICOES', 'REJEITADA', 'FALHA')),
  estado text NOT NULL CHECK (estado IN (
    'CONCLUIDA', 'CONCLUIDA_COM_REJEICOES', 'REJEITADA', 'FALHA', 'CANCELADA'
  )),
  totais jsonb NOT NULL,
  lida boolean NOT NULL DEFAULT false,
  lida_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now(),
  sequencia bigint NOT NULL GENERATED ALWAYS AS IDENTITY,

  -- Uma notificacao por usuario, tentativa e tipo: reprocessar nao duplica.
  CONSTRAINT importacao_plano_contas_notificacao_unica UNIQUE (tentativa_id, usuario_id, tipo),
  CONSTRAINT importacao_plano_contas_notificacao_lida_condizente CHECK (
    (lida = false AND lida_em IS NULL) OR (lida = true AND lida_em IS NOT NULL)
  ),
  CONSTRAINT importacao_plano_contas_notificacao_tentativa_da_empresa
    FOREIGN KEY (tentativa_id, empresa_id, tenant_id)
    REFERENCES app.importacao_plano_contas (id, empresa_id, tenant_id),
  CONSTRAINT importacao_plano_contas_notificacao_usuario_do_tenant
    FOREIGN KEY (usuario_id, tenant_id) REFERENCES app.usuario (id, tenant_id)
);

CREATE INDEX importacao_plano_contas_notificacao_tenant_id_idx
  ON app.importacao_plano_contas_notificacao (tenant_id);
CREATE INDEX importacao_plano_contas_notificacao_painel_idx
  ON app.importacao_plano_contas_notificacao (usuario_id, criado_em DESC, sequencia DESC);
CREATE INDEX importacao_plano_contas_notificacao_nao_lidas_idx
  ON app.importacao_plano_contas_notificacao (usuario_id) WHERE lida = false;

-- 5. RLS e escopo -------------------------------------------------------------------------------

ALTER TABLE app.conta_contabil ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.importacao_plano_contas ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.importacao_plano_contas_linha ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.importacao_plano_contas_evento ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.importacao_plano_contas_notificacao ENABLE ROW LEVEL SECURITY;

ALTER TABLE app.conta_contabil FORCE ROW LEVEL SECURITY;
ALTER TABLE app.importacao_plano_contas FORCE ROW LEVEL SECURITY;
ALTER TABLE app.importacao_plano_contas_linha FORCE ROW LEVEL SECURITY;
ALTER TABLE app.importacao_plano_contas_evento FORCE ROW LEVEL SECURITY;
ALTER TABLE app.importacao_plano_contas_notificacao FORCE ROW LEVEL SECURITY;

-- Classe `empresa`: tenant + empresa autorizada (carteira do humano ou empresa exata do job tecnico).
DO $$
DECLARE
  alvo record;
  comando text;
BEGIN
  FOR alvo IN
    SELECT * FROM (VALUES
      ('conta_contabil',                  ARRAY['SELECT', 'INSERT', 'UPDATE']),
      ('importacao_plano_contas',         ARRAY['SELECT', 'INSERT', 'UPDATE']),
      ('importacao_plano_contas_linha',   ARRAY['SELECT', 'INSERT']),
      ('importacao_plano_contas_evento',  ARRAY['SELECT', 'INSERT'])
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

CREATE TRIGGER escopo_imutavel BEFORE UPDATE ON app.conta_contabil
  FOR EACH ROW EXECUTE FUNCTION app.proteger_escopo_empresa();
CREATE TRIGGER escopo_imutavel BEFORE UPDATE ON app.importacao_plano_contas
  FOR EACH ROW EXECUTE FUNCTION app.proteger_escopo_empresa();
CREATE TRIGGER escopo_imutavel BEFORE UPDATE ON app.importacao_plano_contas_linha
  FOR EACH ROW EXECUTE FUNCTION app.proteger_escopo_empresa();
CREATE TRIGGER escopo_imutavel BEFORE UPDATE ON app.importacao_plano_contas_evento
  FOR EACH ROW EXECUTE FUNCTION app.proteger_escopo_empresa();

-- Classe `tenant`, leitura `proprio_usuario` (como carteira_notificacao).
DO $$
DECLARE
  gestao text := 'tenant_id = app.tenant_atual() AND app.gestao_de_acesso()';
  dono text := 'tenant_id = app.tenant_atual() AND app.contexto_humano() AND (app.gestao_de_acesso() OR (usuario_id = app.usuario_atual() AND app.usuario_ativo_atual()))';
BEGIN
  EXECUTE format('CREATE POLICY importacao_plano_contas_notificacao_leitura ON app.importacao_plano_contas_notificacao FOR SELECT USING (%s)', dono);
  -- INSERT e' feito pela funcao de conclusao (contexto tecnico da empresa), nao por contexto humano.
  EXECUTE format('CREATE POLICY importacao_plano_contas_notificacao_insercao ON app.importacao_plano_contas_notificacao FOR INSERT WITH CHECK (%s)', gestao);
  EXECUTE format('CREATE POLICY importacao_plano_contas_notificacao_alteracao ON app.importacao_plano_contas_notificacao FOR UPDATE USING (%s) WITH CHECK (%s)', dono, dono);
END
$$;

CREATE TRIGGER escopo_imutavel BEFORE UPDATE ON app.importacao_plano_contas_notificacao
  FOR EACH ROW EXECUTE FUNCTION app.proteger_escopo_tenant();

-- 6. Privilegios --------------------------------------------------------------------------------

-- Plano de contas: codigo imutavel, versao incrementada automaticamente pelo trigger.
REVOKE UPDATE ON app.conta_contabil FROM contaia_app;
GRANT UPDATE (nome, tipo, natureza, conta_pai, arquivada, arquivada_em, arquivada_por)
  ON app.conta_contabil TO contaia_app;

-- Tentativa: so estado, versao do plano, totais, confirmador, fim e reutilizacao mudam.
REVOKE UPDATE ON app.importacao_plano_contas FROM contaia_app;
GRANT UPDATE (estado, plano_versao_na_validacao, totais, usuario_confirmador_ou_cancelador_id, finalizado_em, reutilizada_por_idempotencia)
  ON app.importacao_plano_contas TO contaia_app;

-- Linhas de staging: so INSERT (worker de validacao), sem UPDATE/DELETE.
REVOKE UPDATE, DELETE ON app.importacao_plano_contas_linha FROM contaia_app;

-- Eventos: append-only total.
REVOKE ALL ON app.importacao_plano_contas_evento FROM contaia_app;

-- Notificacao: so lida/lida_em mudam.
REVOKE UPDATE ON app.importacao_plano_contas_notificacao FROM contaia_app;
GRANT UPDATE (lida, lida_em) ON app.importacao_plano_contas_notificacao TO contaia_app;

REVOKE ALL ON FUNCTION
  app.proteger_conta_contabil()
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.proteger_conta_contabil() TO contaia_app;

-- Default: sem DELETE fisico.
ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE DELETE ON TABLES FROM contaia_app;
REVOKE DELETE ON ALL TABLES IN SCHEMA app FROM contaia_app;