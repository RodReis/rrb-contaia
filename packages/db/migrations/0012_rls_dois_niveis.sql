-- SPEC-010/F10 — RLS de dois niveis (tenant x empresa x carteira) e finalidade.
--
-- Contexto (gravado pela aplicacao dentro da transacao, `set_config(..., true)`):
--   app.tenant_id, app.origem (HUMANA|TECNICA), app.usuario_id, app.empresa_id,
--   app.finalidade, app.identidade_tecnica, app.correlation_id.
-- Sem contexto valido toda funcao abaixo devolve NULL/false e nenhuma linha
-- protegida aparece (I-2). Valor adulterado (nao-uuid, finalidade desconhecida)
-- tambem resulta em NULL/false: nunca em acesso ampliado.
--
-- Camadas: o papel define O QUE, a carteira define EM QUAIS empresas e a RLS
-- impede que a persistencia ultrapasse o recorte. As funcoes sao SECURITY
-- INVOKER de proposito: leem `usuario` e `carteira_vinculo` sob a propria RLS,
-- entao nao dependem de o dono da funcao ignorar a RLS.
--
-- Classes de tabela (a lista autoritativa e `packages/db/src/rls/classificacao.ts`,
-- fiscalizada pelo anti-drift):
--   raiz_tenant   app.tenant                        id = tenant
--   raiz_empresa  app.empresa                       tenant_id + id da empresa
--   empresa       demais tabelas com empresa_id     tenant + empresa autorizada
--   vinculo       app.carteira_vinculo              tenant + proprio usuario | finalidade admin
--   tenant        tabelas de gestao do escritorio   tenant + contexto humano

-- 1. Leitura do contexto -----------------------------------------------------

-- `NULLIF` porque `current_setting` devolve '' quando a variavel nunca foi
-- definida; uuid malformado vira NULL em vez de erro.
CREATE OR REPLACE FUNCTION app.uuid_ou_nulo(valor text) RETURNS uuid
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN valor ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN valor::uuid
  END;
$$;

CREATE OR REPLACE FUNCTION app.tenant_atual() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT app.uuid_ou_nulo(NULLIF(current_setting('app.tenant_id', true), ''));
$$;

CREATE OR REPLACE FUNCTION app.usuario_atual() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT app.uuid_ou_nulo(NULLIF(current_setting('app.usuario_id', true), ''));
$$;

CREATE OR REPLACE FUNCTION app.empresa_tecnica_atual() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT app.uuid_ou_nulo(NULLIF(current_setting('app.empresa_id', true), ''));
$$;

CREATE OR REPLACE FUNCTION app.origem_atual() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.origem', true), '');
$$;

CREATE OR REPLACE FUNCTION app.finalidade_atual() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.finalidade', true), '');
$$;

-- Humano valido: tenant, usuario e finalidade humana enumerada.
CREATE OR REPLACE FUNCTION app.contexto_humano() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app.tenant_atual() IS NOT NULL
     AND app.usuario_atual() IS NOT NULL
     AND app.origem_atual() = 'HUMANA'
     AND app.finalidade_atual() IN ('COMUM', 'ADMIN_ACESSO', 'LOCALIZACAO_BASICA_EMPRESA');
$$;

-- Tecnico valido: identidade, finalidade especifica, tenant, empresa e correlationId.
CREATE OR REPLACE FUNCTION app.contexto_tecnico() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app.tenant_atual() IS NOT NULL
     AND app.empresa_tecnica_atual() IS NOT NULL
     AND app.origem_atual() = 'TECNICA'
     AND app.finalidade_atual() IN ('PROCESSAMENTO_DE_EMPRESA')
     AND NULLIF(current_setting('app.identidade_tecnica', true), '') IS NOT NULL
     AND NULLIF(current_setting('app.correlation_id', true), '') IS NOT NULL;
$$;

-- Usuario da sessao existe no tenant e esta ATIVO. Suspenso e arquivado nao
-- alcancam dado empresarial ainda que tenham vinculos preservados (SPEC-010 §3.1).
CREATE OR REPLACE FUNCTION app.usuario_ativo_atual() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM app.usuario u
     WHERE u.id = app.usuario_atual()
       AND u.tenant_id = app.tenant_atual()
       AND u.estado = 'ATIVO'
  );
$$;

-- A excecao da F9: o administrador alcanca empresa ARQUIVADA sem vinculo para
-- poder reativa-la. O papel e conferido no proprio banco, nao no que a API diz.
CREATE OR REPLACE FUNCTION app.usuario_admin_atual() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app.usuario_ativo_atual()
     AND EXISTS (
       SELECT 1 FROM app.usuario_papel p
        WHERE p.usuario_id = app.usuario_atual()
          AND p.tenant_id = app.tenant_atual()
          AND p.papel = 'admin_escritorio'
          AND p.removido_em IS NULL
     );
$$;

-- Dois niveis, parte 1: a empresa esta na carteira ativa do usuario ATIVO
-- (humano COMUM) ou e exatamente a empresa do trabalho (tecnico). Nao le
-- `empresa`: a politica de `empresa` chama esta funcao, e ler `empresa` aqui
-- criaria recursao de politica.
CREATE OR REPLACE FUNCTION app.empresa_na_carteira(p_empresa uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT p_empresa IS NOT NULL
     AND app.tenant_atual() IS NOT NULL
     AND (
       (
         app.contexto_humano()
         AND app.finalidade_atual() = 'COMUM'
         AND app.usuario_ativo_atual()
         AND EXISTS (
           SELECT 1 FROM app.carteira_vinculo v
            WHERE v.tenant_id = app.tenant_atual()
              AND v.usuario_id = app.usuario_atual()
              AND v.empresa_id = p_empresa
              AND v.encerrado_em IS NULL
         )
       )
       OR (app.contexto_tecnico() AND p_empresa = app.empresa_tecnica_atual())
     );
$$;

-- Administrador ativo na finalidade comum: a excecao da F9 vale so para empresa
-- ARQUIVADA, e quem a restringe a arquivada e a politica de cada tabela.
CREATE OR REPLACE FUNCTION app.administrador_comum() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app.contexto_humano()
     AND app.finalidade_atual() = 'COMUM'
     AND app.usuario_admin_atual();
$$;

-- Decisao central, parte 2, para as tabelas filhas: carteira OU (admin + empresa
-- arquivada). Finalidade administrativa NAO abre dado operacional de empresa.
CREATE OR REPLACE FUNCTION app.empresa_autorizada(p_empresa uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT p_empresa IS NOT NULL
     AND app.tenant_atual() IS NOT NULL
     AND (
       app.empresa_na_carteira(p_empresa)
       OR (
         app.administrador_comum()
         AND EXISTS (
           SELECT 1 FROM app.empresa e
            WHERE e.id = p_empresa
              AND e.tenant_id = app.tenant_atual()
              AND e.situacao = 'arquivado'
         )
       )
     );
$$;

-- Qualquer contexto valido, humano ou tecnico.
CREATE OR REPLACE FUNCTION app.contexto_valido() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app.contexto_humano() OR app.contexto_tecnico();
$$;

-- Finalidade administrativa humana (gestao de acesso e localizacao basica).
CREATE OR REPLACE FUNCTION app.finalidade_administrativa() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app.contexto_humano()
     AND app.finalidade_atual() IN ('ADMIN_ACESSO', 'LOCALIZACAO_BASICA_EMPRESA');
$$;

GRANT EXECUTE ON FUNCTION
  app.uuid_ou_nulo(text), app.tenant_atual(), app.usuario_atual(),
  app.empresa_tecnica_atual(), app.origem_atual(), app.finalidade_atual(),
  app.contexto_humano(), app.contexto_tecnico(), app.usuario_ativo_atual(),
  app.usuario_admin_atual(), app.empresa_na_carteira(uuid),
  app.administrador_comum(), app.empresa_autorizada(uuid),
  app.finalidade_administrativa(), app.contexto_valido()
TO contaia_app;

-- 2. Indices por empresa (I-1) --------------------------------------------------

CREATE INDEX IF NOT EXISTS empresa_evento_de_historico_empresa_id_idx
  ON app.empresa_evento_de_historico (empresa_id);
CREATE INDEX IF NOT EXISTS empresa_evento_de_pendencia_empresa_id_idx
  ON app.empresa_evento_de_pendencia (empresa_id);
CREATE INDEX IF NOT EXISTS empresa_evento_de_notificacao_empresa_id_idx
  ON app.empresa_evento_de_notificacao (empresa_id);
-- O indice parcial de vinculo atende a decisao de acesso; a RLS e o anti-drift
-- pedem tambem um indice sem predicado.
CREATE INDEX IF NOT EXISTS carteira_vinculo_empresa_id_idx
  ON app.carteira_vinculo (tenant_id, empresa_id);

-- 3. Politicas ------------------------------------------------------------------

-- 3.1 raiz do tenant: a propria linha e o escritorio.
DROP POLICY IF EXISTS tenant_isolamento ON app.tenant;
CREATE POLICY tenant_isolamento ON app.tenant
  USING (id = app.tenant_atual() AND app.contexto_valido())
  WITH CHECK (id = app.tenant_atual() AND app.contexto_valido());

-- 3.2 raiz da empresa: o cadastro basico e legivel pelas finalidades
-- administrativas (atribuicao de carteira, 403 da F9, duplicidade de CNPJ); o
-- dado operacional continua nas tabelas filhas, que so a empresa autorizada abre.
-- O `FOR SHARE` das operacoes de carteira exige a politica de UPDATE: por isso
-- o USING de UPDATE enxerga o tenant inteiro na finalidade administrativa, e o
-- WITH CHECK continua exigindo empresa autorizada — o admin trava, nao altera.
DROP POLICY IF EXISTS empresa_isolamento ON app.empresa;

CREATE POLICY empresa_leitura ON app.empresa FOR SELECT
  USING (
    tenant_id = app.tenant_atual()
    AND (
      app.empresa_na_carteira(id)
      OR (app.administrador_comum() AND situacao = 'arquivado')
      OR app.finalidade_administrativa()
    )
  );

-- Empresa nova ainda nao tem vinculo: so a finalidade de gestao de acesso a cria.
CREATE POLICY empresa_insercao ON app.empresa FOR INSERT
  WITH CHECK (
    tenant_id = app.tenant_atual()
    AND app.contexto_humano()
    AND app.finalidade_atual() = 'ADMIN_ACESSO'
  );

-- USING escolhe a linha alvo (carteira, arquivada para o admin, ou o tenant na
-- gestao de acesso, so para travar). WITH CHECK decide o que pode ser gravado:
-- carteira, ou o admin comum — que so chega aqui por empresa arquivada, e a
-- reativacao troca justamente a situacao dela. Na gestao de acesso nenhum
-- UPDATE de empresa passa no WITH CHECK.
CREATE POLICY empresa_alteracao ON app.empresa FOR UPDATE
  USING (
    tenant_id = app.tenant_atual()
    AND (
      app.empresa_na_carteira(id)
      OR (app.administrador_comum() AND situacao = 'arquivado')
      OR app.finalidade_atual() = 'ADMIN_ACESSO'
    )
  )
  WITH CHECK (
    tenant_id = app.tenant_atual()
    AND (app.empresa_na_carteira(id) OR app.administrador_comum())
  );

-- 3.3 vinculo de carteira: o proprio usuario le os seus; a gestao de acesso
-- le e escreve todos do tenant. Nunca depende de `empresa_autorizada` (a
-- funcao le esta tabela: sem isso haveria recursao).
DROP POLICY IF EXISTS carteira_vinculo_isolamento ON app.carteira_vinculo;

CREATE POLICY carteira_vinculo_leitura ON app.carteira_vinculo FOR SELECT
  USING (
    tenant_id = app.tenant_atual()
    AND app.contexto_humano()
    AND (
      app.finalidade_atual() = 'ADMIN_ACESSO'
      OR (usuario_id = app.usuario_atual() AND app.usuario_ativo_atual())
    )
  );

CREATE POLICY carteira_vinculo_insercao ON app.carteira_vinculo FOR INSERT
  WITH CHECK (
    tenant_id = app.tenant_atual()
    AND app.contexto_humano()
    AND app.finalidade_atual() = 'ADMIN_ACESSO'
  );

CREATE POLICY carteira_vinculo_alteracao ON app.carteira_vinculo FOR UPDATE
  USING (
    tenant_id = app.tenant_atual()
    AND app.contexto_humano()
    AND app.finalidade_atual() = 'ADMIN_ACESSO'
  )
  WITH CHECK (
    tenant_id = app.tenant_atual()
    AND app.contexto_humano()
    AND app.finalidade_atual() = 'ADMIN_ACESSO'
  );

-- 3.4 tabelas por empresa. Um comando por politica: as append-only (I-6) ficam
-- so com SELECT e INSERT — sem politica de UPDATE/DELETE, a RLS forcada nega.
DO $$
DECLARE
  alvo record;
  comando text;
  nome text;
BEGIN
  FOR alvo IN
    SELECT * FROM (VALUES
      ('empresa_cnae_secundario',      ARRAY['SELECT', 'INSERT', 'UPDATE']),
      ('empresa_endereco',             ARRAY['SELECT', 'INSERT', 'UPDATE']),
      ('empresa_evento_de_historico',  ARRAY['SELECT', 'INSERT']),
      ('empresa_exigencia_documental', ARRAY['SELECT', 'INSERT', 'UPDATE']),
      ('empresa_documento_versao',     ARRAY['SELECT', 'INSERT', 'UPDATE']),
      ('empresa_evento_documental',    ARRAY['SELECT', 'INSERT']),
      ('empresa_pendencia',            ARRAY['SELECT', 'INSERT', 'UPDATE']),
      ('empresa_evento_de_pendencia',  ARRAY['SELECT', 'INSERT']),
      ('empresa_notificacao',          ARRAY['SELECT', 'INSERT', 'UPDATE']),
      ('empresa_evento_de_notificacao', ARRAY['SELECT', 'INSERT'])
    ) AS t(tabela, comandos)
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON app.%I', alvo.tabela || '_isolamento', alvo.tabela);

    FOREACH comando IN ARRAY alvo.comandos LOOP
      nome := alvo.tabela || '_' || lower(comando);

      IF comando = 'SELECT' THEN
        EXECUTE format(
          'CREATE POLICY %I ON app.%I FOR SELECT USING (tenant_id = app.tenant_atual() AND app.empresa_autorizada(empresa_id))',
          nome, alvo.tabela);
      ELSIF comando = 'INSERT' THEN
        EXECUTE format(
          'CREATE POLICY %I ON app.%I FOR INSERT WITH CHECK (tenant_id = app.tenant_atual() AND app.empresa_autorizada(empresa_id))',
          nome, alvo.tabela);
      ELSE
        EXECUTE format(
          'CREATE POLICY %I ON app.%I FOR UPDATE USING (tenant_id = app.tenant_atual() AND app.empresa_autorizada(empresa_id)) WITH CHECK (tenant_id = app.tenant_atual() AND app.empresa_autorizada(empresa_id))',
          nome, alvo.tabela);
      END IF;
    END LOOP;
  END LOOP;
END
$$;

-- 3.5 tabelas de gestao do escritorio (sem empresa_id): tenant + contexto
-- humano. Job tecnico nao le usuario, papel, convite nem carteira.
DO $$
DECLARE
  tabela text;
BEGIN
  FOREACH tabela IN ARRAY ARRAY[
    'usuario', 'usuario_papel', 'usuario_convite', 'usuario_evento',
    'papel_personalizado', 'papel_personalizado_revisao', 'usuario_papel_personalizado',
    'escritorio_endereco', 'escritorio_arquivo',
    'carteira_evento', 'carteira_notificacao'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON app.%I', tabela || '_isolamento', tabela);
    EXECUTE format(
      'CREATE POLICY %I ON app.%I USING (tenant_id = app.tenant_atual() AND app.contexto_humano()) WITH CHECK (tenant_id = app.tenant_atual() AND app.contexto_humano())',
      tabela || '_isolamento', tabela);
  END LOOP;
END
$$;

-- 3.6 escopo imutavel: UPDATE nao move linha entre tenant nem entre empresa
-- (SPEC-010 §3.4). O WITH CHECK so ve a linha nova; a trigger compara com a velha.
CREATE OR REPLACE FUNCTION app.proteger_escopo_tenant() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'tenant_id e imutavel' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION app.proteger_escopo_empresa() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.empresa_id IS DISTINCT FROM OLD.empresa_id THEN
    RAISE EXCEPTION 'tenant_id e empresa_id sao imutaveis' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION app.proteger_escopo_raiz_empresa() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'tenant_id e id da empresa sao imutaveis' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  tabela text;
BEGIN
  FOREACH tabela IN ARRAY ARRAY[
    'empresa_cnae_secundario', 'empresa_endereco', 'empresa_evento_de_historico',
    'empresa_exigencia_documental', 'empresa_documento_versao', 'empresa_evento_documental',
    'empresa_pendencia', 'empresa_evento_de_pendencia', 'empresa_notificacao',
    'empresa_evento_de_notificacao', 'carteira_vinculo'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS escopo_imutavel ON app.%I', tabela);
    EXECUTE format(
      'CREATE TRIGGER escopo_imutavel BEFORE UPDATE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.proteger_escopo_empresa()',
      tabela);
  END LOOP;

  FOREACH tabela IN ARRAY ARRAY[
    'usuario', 'usuario_papel', 'usuario_convite', 'usuario_evento',
    'papel_personalizado', 'papel_personalizado_revisao', 'usuario_papel_personalizado',
    'escritorio_endereco', 'escritorio_arquivo', 'carteira_evento', 'carteira_notificacao'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS escopo_imutavel ON app.%I', tabela);
    EXECUTE format(
      'CREATE TRIGGER escopo_imutavel BEFORE UPDATE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.proteger_escopo_tenant()',
      tabela);
  END LOOP;

  DROP TRIGGER IF EXISTS escopo_imutavel ON app.empresa;
  CREATE TRIGGER escopo_imutavel BEFORE UPDATE ON app.empresa
    FOR EACH ROW EXECUTE FUNCTION app.proteger_escopo_raiz_empresa();
END
$$;

-- 4. Privilegios -----------------------------------------------------------------

-- O `pg_default_acl` do schema volta a conceder DELETE a cada tabela nova (ver 0004).
ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE DELETE ON TABLES FROM contaia_app;
REVOKE DELETE ON ALL TABLES IN SCHEMA app FROM contaia_app;
