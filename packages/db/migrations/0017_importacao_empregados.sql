-- SPEC-014/F14 — Empregados da empresa e importacao por CSV.
--
-- Espelha a 0015/0016 da F13 (mesmo pipeline, mesmo ciclo de vida da tentativa), com schema,
-- chave natural e validacoes proprios de empregado. Todas as tabelas sao da classe `empresa`
-- (SPEC-010 §3.5): tenant_id + empresa_id NOT NULL, FK composta (empresa_id, tenant_id) ->
-- empresa, RLS forcada com `app.empresa_autorizada`, escopo imutavel por trigger e nenhum DELETE
-- para a aplicacao (I-7).
--
--   empregado                          base vigente; chave natural (empresa_id, cpf, matricula)
--   empresa_empregados_versao          versao otimista da base (SPEC-014 §6.3), uma por empresa
--   importacao_empregados              tentativa: arquivo, mapeamento, estado, totais
--   importacao_empregados_linha        staging normalizado + rejeicoes por linha (valor cru)
--   importacao_empregados_evento       trilha append-only da tentativa (I-6)
--   importacao_empregados_notificacao  conclusao para o iniciador e os admins autorizados (F6)
--
-- Por fim: a pendencia "empregados nao importados" (F5) com backfill e a funcao que lista os
-- administradores autorizados da empresa (destinatarios da notificacao, inclusive pelo worker).

-- 1. Base de empregados vigente ------------------------------------------------------------------

CREATE TABLE app.empregado (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES app.tenant(id),
  empresa_id uuid NOT NULL,

  -- So os 11 digitos: a mascara e da interface; a validade dos digitos verificadores e do dominio.
  cpf text NOT NULL CHECK (cpf ~ '^[0-9]{11}$'),
  -- Sem limite de tamanho (decisao do PI): o arquivo de 10 MB ja limita. Matricula preserva caixa
  -- e zeros a esquerda ("00123" <> "123").
  nome text NOT NULL CHECK (btrim(nome) <> ''),
  matricula text NOT NULL CHECK (btrim(matricula) <> ''),
  -- Datas civis (I-11).
  data_nascimento date NOT NULL,
  data_admissao date NOT NULL,

  arquivado boolean NOT NULL DEFAULT false,
  arquivado_em timestamptz,
  -- Sobe a cada alteracao real (trigger): auditoria do empregado, nao a versao da base.
  versao bigint NOT NULL DEFAULT 1 CHECK (versao > 0),
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT empregado_chave_natural UNIQUE (empresa_id, cpf, matricula),
  CONSTRAINT empregado_admissao_depois_do_nascimento CHECK (data_admissao > data_nascimento),
  CONSTRAINT empregado_arquivamento_condizente CHECK (arquivado = (arquivado_em IS NOT NULL)),
  CONSTRAINT empregado_empresa_do_tenant
    FOREIGN KEY (empresa_id, tenant_id) REFERENCES app.empresa (id, tenant_id)
);

CREATE INDEX empregado_tenant_id_idx ON app.empregado (tenant_id);
CREATE INDEX empregado_empresa_id_idx ON app.empregado (empresa_id);
-- Consulta da base: por nome, paginada (SPEC-014 §3.9).
CREATE INDEX empregado_consulta_idx ON app.empregado (empresa_id, nome, matricula, id);

-- CPF e matricula sao a chave natural e nunca mudam; empregado arquivado nao e atualizado nem
-- reativado pela importacao (SPEC-014 §3.6) — reativacao e fluxo proprio do MVP-3. A aplicacao ja
-- nao tem UPDATE nessas colunas (privilegio de coluna); a trigger vale tambem para o superusuario.
CREATE OR REPLACE FUNCTION app.proteger_empregado() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW IS NOT DISTINCT FROM OLD THEN
    RETURN NEW;
  END IF;

  IF NEW.cpf IS DISTINCT FROM OLD.cpf OR NEW.matricula IS DISTINCT FROM OLD.matricula THEN
    RAISE EXCEPTION 'cpf e matricula do empregado sao a chave natural e nao mudam'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF OLD.arquivado THEN
    RAISE EXCEPTION 'empregado arquivado nao e atualizado nem reativado'
      USING ERRCODE = 'restrict_violation';
  END IF;

  NEW.versao := OLD.versao + 1;

  RETURN NEW;
END;
$$;

CREATE TRIGGER empregado_protegido
  BEFORE UPDATE ON app.empregado
  FOR EACH ROW EXECUTE FUNCTION app.proteger_empregado();

-- 2. Versao otimista da base ---------------------------------------------------------------------

-- Mesmo desenho de empresa_plano_versao (0015 §2): uma linha por empresa, criada sob demanda e
-- incrementada a cada aplicacao confirmada; a confirmacao com versao diferente e conflito (409).
CREATE TABLE app.empresa_empregados_versao (
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES app.tenant(id),
  empresa_id uuid NOT NULL,
  versao bigint NOT NULL DEFAULT 0 CHECK (versao >= 0),

  CONSTRAINT empresa_empregados_versao_pkey PRIMARY KEY (empresa_id, tenant_id),
  CONSTRAINT empresa_empregados_versao_id_unico UNIQUE (id),
  CONSTRAINT empresa_empregados_versao_empresa_do_tenant
    FOREIGN KEY (empresa_id, tenant_id) REFERENCES app.empresa (id, tenant_id)
);

CREATE INDEX empresa_empregados_versao_tenant_id_idx ON app.empresa_empregados_versao (tenant_id);

-- Generica (so le `versao`): voltar atras faria uma previa obsoleta parecer atual.
CREATE OR REPLACE FUNCTION app.proteger_versao_do_agregado() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.versao < OLD.versao THEN
    RAISE EXCEPTION 'a versao do agregado so sobe' USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER empresa_empregados_versao_protegida
  BEFORE UPDATE ON app.empresa_empregados_versao
  FOR EACH ROW EXECUTE FUNCTION app.proteger_versao_do_agregado();

-- 3. Tentativa de importacao ---------------------------------------------------------------------

-- Igual a importacao_plano_contas (0015 §3 + 0016): nasce com o mapeamento; a identidade
-- idempotente e a UNIQUE parcial abaixo, ja com `obsoleta` desde a origem (FIX #107).
CREATE TABLE app.importacao_empregados (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES app.tenant(id),
  empresa_id uuid NOT NULL,

  hash_arquivo text NOT NULL CHECK (hash_arquivo ~ '^[0-9a-f]{64}$'),
  mapeamento jsonb NOT NULL CHECK (jsonb_typeof(mapeamento) = 'object'),
  arquivo_nome text NOT NULL CHECK (btrim(arquivo_nome) <> ''),
  -- Limite da SPEC-014 §3.2: 10 MB.
  arquivo_tamanho bigint NOT NULL CHECK (arquivo_tamanho BETWEEN 0 AND 10485760),
  arquivo_chave text NOT NULL CHECK (btrim(arquivo_chave) <> ''),

  estado text NOT NULL DEFAULT 'RECEBIDA' CHECK (estado IN (
    'RECEBIDA', 'VALIDANDO', 'AGUARDANDO_CONFIRMACAO', 'APLICANDO',
    'CONCLUIDA', 'CONCLUIDA_COM_REJEICOES', 'REJEITADA', 'CANCELADA', 'FALHA'
  )),
  -- Versao da base (empresa_empregados_versao) sobre a qual a previa foi formada; nula ate a
  -- validacao terminar. REJEITADA termina nela; CONCLUIDA* nela + 1 (regra do FIX #107).
  empregados_versao_na_validacao bigint CHECK (empregados_versao_na_validacao >= 0),
  -- {lidas, novas, atualizadas, rejeitadas}; nulo ate a validacao terminar.
  totais jsonb CHECK (totais IS NULL OR jsonb_typeof(totais) = 'object'),

  usuario_iniciador_id uuid NOT NULL,
  usuario_confirmador_id uuid,
  usuario_cancelador_id uuid,
  correlation_id text NOT NULL,
  reutilizada_por_idempotencia boolean NOT NULL DEFAULT false,
  -- Resultado terminal de uma base que ja mudou: sai da identidade e fica intacto no historico.
  obsoleta boolean NOT NULL DEFAULT false,

  criado_em timestamptz NOT NULL DEFAULT now(),
  iniciado_em timestamptz,
  finalizado_em timestamptz,
  sequencia bigint NOT NULL GENERATED ALWAYS AS IDENTITY,

  CONSTRAINT importacao_empregados_escopo UNIQUE (id, empresa_id, tenant_id),
  CONSTRAINT importacao_empregados_termino_condizente CHECK (
    (estado IN ('CONCLUIDA', 'CONCLUIDA_COM_REJEICOES', 'REJEITADA', 'CANCELADA', 'FALHA'))
    = (finalizado_em IS NOT NULL)
  ),
  CONSTRAINT importacao_empregados_cancelamento_com_autor CHECK (
    estado <> 'CANCELADA' OR usuario_cancelador_id IS NOT NULL
  ),
  CONSTRAINT importacao_empregados_obsoleta_so_com_resultado CHECK (
    NOT obsoleta OR estado IN ('CONCLUIDA', 'CONCLUIDA_COM_REJEICOES', 'REJEITADA')
  ),
  CONSTRAINT importacao_empregados_empresa_do_tenant
    FOREIGN KEY (empresa_id, tenant_id) REFERENCES app.empresa (id, tenant_id),
  CONSTRAINT importacao_empregados_iniciador_do_tenant
    FOREIGN KEY (usuario_iniciador_id, tenant_id) REFERENCES app.usuario (id, tenant_id),
  CONSTRAINT importacao_empregados_confirmador_do_tenant
    FOREIGN KEY (usuario_confirmador_id, tenant_id) REFERENCES app.usuario (id, tenant_id),
  CONSTRAINT importacao_empregados_cancelador_do_tenant
    FOREIGN KEY (usuario_cancelador_id, tenant_id) REFERENCES app.usuario (id, tenant_id)
);

CREATE INDEX importacao_empregados_tenant_id_idx ON app.importacao_empregados (tenant_id);
CREATE INDEX importacao_empregados_empresa_id_idx ON app.importacao_empregados (empresa_id);
-- Identidade idempotente (SPEC-014 §3.7): viva ou com resultado reutilizavel AINDA ATUAL. A
-- aplicacao usa `ON CONFLICT (...) WHERE estado NOT IN ('FALHA', 'CANCELADA') AND NOT obsoleta`.
CREATE UNIQUE INDEX importacao_empregados_idempotente
  ON app.importacao_empregados (empresa_id, tenant_id, hash_arquivo, mapeamento)
  WHERE estado NOT IN ('FALHA', 'CANCELADA') AND NOT obsoleta;
-- Historico: 15 por pagina, mais recente primeiro (SPEC-014 §3.9).
CREATE INDEX importacao_empregados_historico_idx
  ON app.importacao_empregados (empresa_id, criado_em DESC, sequencia DESC);

-- Generica para as tentativas de importacao (mesma regra da 0016 para o plano de contas): estado
-- terminal congelado, salvo as marcas de reuso e de obsolescencia; obsoleta nao volta a valer; o
-- mapeamento so muda enquanto RECEBIDA.
CREATE OR REPLACE FUNCTION app.proteger_tentativa_de_importacao() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.estado IN ('CONCLUIDA', 'CONCLUIDA_COM_REJEICOES', 'REJEITADA', 'CANCELADA', 'FALHA')
     AND (to_jsonb(NEW) - 'reutilizada_por_idempotencia' - 'obsoleta')
         IS DISTINCT FROM (to_jsonb(OLD) - 'reutilizada_por_idempotencia' - 'obsoleta') THEN
    RAISE EXCEPTION 'tentativa de importacao em estado terminal nao muda'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF OLD.obsoleta AND NOT NEW.obsoleta THEN
    RAISE EXCEPTION 'tentativa de importacao obsoleta nao volta a valer'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW.mapeamento IS DISTINCT FROM OLD.mapeamento AND OLD.estado <> 'RECEBIDA' THEN
    RAISE EXCEPTION 'o mapeamento da tentativa so muda enquanto RECEBIDA'
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER importacao_empregados_protegida
  BEFORE UPDATE ON app.importacao_empregados
  FOR EACH ROW EXECUTE FUNCTION app.proteger_tentativa_de_importacao();

-- 4. Staging da validacao ------------------------------------------------------------------------

-- Data civil ISO `aaaa-mm-dd` que existe no calendario. IMMUTABLE de fato (make_date nao depende
-- de DateStyle nem de fuso), para caber num CHECK. A excecao do bloco nao grava nada.
CREATE OR REPLACE FUNCTION app.data_civil_valida(p_data text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF p_data IS NULL OR p_data !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
    RETURN false;
  END IF;

  PERFORM make_date(substr(p_data, 1, 4)::int, substr(p_data, 6, 2)::int, substr(p_data, 9, 2)::int);

  RETURN true;
EXCEPTION WHEN data_exception THEN
  RETURN false;
END;
$$;

-- Uma linha por linha de dados do arquivo, valida ou rejeitada. As celulas sao texto ANULAVEL e
-- sem CHECK de dominio: a linha rejeitada guarda o valor cru (ex.: "31/02/2020") para o relatorio.
-- So a linha VALIDA exige o dominio completo: CPF normalizado, datas ISO reais e coerentes, acao.
CREATE TABLE app.importacao_empregados_linha (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES app.tenant(id),
  empresa_id uuid NOT NULL,
  tentativa_id uuid NOT NULL,

  numero_linha integer NOT NULL CHECK (numero_linha > 0),
  -- Como veio no arquivo (com ou sem mascara).
  cpf text,
  -- 11 digitos, so quando o CPF e valido: e a chave aplicada a base.
  cpf_normalizado text CHECK (cpf_normalizado ~ '^[0-9]{11}$'),
  nome text,
  matricula text,
  data_nascimento text,
  data_admissao text,

  status text NOT NULL CHECK (status IN ('VALIDA', 'REJEITADA')),
  acao text CHECK (acao IN ('INCLUIR', 'ATUALIZAR')),
  -- Codigo estavel do dominio (CodigoDeErroDeEmpregado); a lista vive no dominio, aqui so o formato.
  codigo_de_erro text CHECK (codigo_de_erro ~ '^[A-Z][A-Z0-9_]*$'),
  campo text,
  mensagem text,
  sequencia bigint NOT NULL GENERATED ALWAYS AS IDENTITY,

  -- Reentrega do job nao duplica staging (ON CONFLICT DO NOTHING, SPEC-014 §6.4).
  CONSTRAINT importacao_empregados_linha_unica UNIQUE (tentativa_id, numero_linha),
  CONSTRAINT importacao_empregados_linha_valida_condizente CHECK (
    status <> 'VALIDA' OR (
      cpf_normalizado IS NOT NULL
      AND nome IS NOT NULL AND btrim(nome) <> ''
      AND matricula IS NOT NULL AND btrim(matricula) <> ''
      AND app.data_civil_valida(data_nascimento)
      AND app.data_civil_valida(data_admissao)
      -- ISO com ano de 4 digitos: a ordem do texto e a ordem do calendario.
      AND data_admissao > data_nascimento
      AND acao IS NOT NULL
      AND codigo_de_erro IS NULL
    )
  ),
  CONSTRAINT importacao_empregados_linha_rejeitada_condizente CHECK (
    status <> 'REJEITADA' OR (codigo_de_erro IS NOT NULL AND acao IS NULL)
  ),
  CONSTRAINT importacao_empregados_linha_empresa_do_tenant
    FOREIGN KEY (empresa_id, tenant_id) REFERENCES app.empresa (id, tenant_id),
  CONSTRAINT importacao_empregados_linha_tentativa_da_empresa
    FOREIGN KEY (tentativa_id, empresa_id, tenant_id)
    REFERENCES app.importacao_empregados (id, empresa_id, tenant_id)
);

CREATE INDEX importacao_empregados_linha_tenant_id_idx ON app.importacao_empregados_linha (tenant_id);
CREATE INDEX importacao_empregados_linha_empresa_id_idx ON app.importacao_empregados_linha (empresa_id);
CREATE INDEX importacao_empregados_linha_rejeicoes_idx
  ON app.importacao_empregados_linha (tentativa_id, numero_linha) WHERE status = 'REJEITADA';

-- 5. Trilha append-only da tentativa (I-6) -------------------------------------------------------

CREATE TABLE app.importacao_empregados_evento (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES app.tenant(id),
  empresa_id uuid NOT NULL,
  tentativa_id uuid NOT NULL,

  acao text NOT NULL CHECK (acao IN (
    'CRIACAO', 'REUTILIZACAO',
    'INICIAR_VALIDACAO', 'VALIDACAO_SUCESSO', 'VALIDACAO_REJEITADA', 'FALHA_TECNICA',
    'CONFIRMAR', 'CANCELAR', 'APLICACAO_SUCESSO', 'APLICACAO_SUCESSO_COM_REJEICOES'
  )),
  estado_anterior text CHECK (estado_anterior IN (
    'RECEBIDA', 'VALIDANDO', 'AGUARDANDO_CONFIRMACAO', 'APLICANDO',
    'CONCLUIDA', 'CONCLUIDA_COM_REJEICOES', 'REJEITADA', 'CANCELADA', 'FALHA'
  )),
  estado_novo text NOT NULL CHECK (estado_novo IN (
    'RECEBIDA', 'VALIDANDO', 'AGUARDANDO_CONFIRMACAO', 'APLICANDO',
    'CONCLUIDA', 'CONCLUIDA_COM_REJEICOES', 'REJEITADA', 'CANCELADA', 'FALHA'
  )),
  usuario_id uuid,
  totais jsonb CHECK (totais IS NULL OR jsonb_typeof(totais) = 'object'),
  codigo text CHECK (codigo ~ '^[A-Z][A-Z0-9_]*$'),
  correlation_id text NOT NULL,
  ocorrido_em timestamptz NOT NULL DEFAULT now(),
  sequencia bigint NOT NULL GENERATED ALWAYS AS IDENTITY,

  CONSTRAINT importacao_empregados_evento_empresa_do_tenant
    FOREIGN KEY (empresa_id, tenant_id) REFERENCES app.empresa (id, tenant_id),
  CONSTRAINT importacao_empregados_evento_tentativa_da_empresa
    FOREIGN KEY (tentativa_id, empresa_id, tenant_id)
    REFERENCES app.importacao_empregados (id, empresa_id, tenant_id),
  CONSTRAINT importacao_empregados_evento_autor_do_tenant
    FOREIGN KEY (usuario_id, tenant_id) REFERENCES app.usuario (id, tenant_id)
);

CREATE INDEX importacao_empregados_evento_tenant_id_idx ON app.importacao_empregados_evento (tenant_id);
CREATE INDEX importacao_empregados_evento_empresa_id_idx ON app.importacao_empregados_evento (empresa_id);
CREATE INDEX importacao_empregados_evento_tentativa_idx
  ON app.importacao_empregados_evento (tentativa_id, ocorrido_em, sequencia);

CREATE TRIGGER importacao_empregados_evento_append_only
  BEFORE UPDATE OR DELETE ON app.importacao_empregados_evento
  FOR EACH ROW EXECUTE FUNCTION app.rejeitar_escrita_em_historico();

-- 6. Notificacao de conclusao ------------------------------------------------------------------

-- Classe `empresa` (ver 0015 §6). Ao contrario da F13, ha N destinatarios por tentativa: o
-- iniciador e os admin_escritorio com acesso a empresa (SPEC-014 §3.10). O sino filtra por
-- `usuario_id`; estado e totais vem da tentativa, terminal e imutavel.
CREATE TABLE app.importacao_empregados_notificacao (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES app.tenant(id),
  empresa_id uuid NOT NULL,
  tentativa_id uuid NOT NULL,
  usuario_id uuid NOT NULL,
  lida boolean NOT NULL DEFAULT false,
  lida_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now(),
  sequencia bigint NOT NULL GENERATED ALWAYS AS IDENTITY,

  -- Uma por tentativa e destinatario: reprocessar ou reusar nao notifica de novo (I-9).
  CONSTRAINT importacao_empregados_notificacao_unica UNIQUE (tentativa_id, usuario_id),
  CONSTRAINT importacao_empregados_notificacao_lida_condizente CHECK (
    (lida = false AND lida_em IS NULL) OR (lida = true AND lida_em IS NOT NULL)
  ),
  CONSTRAINT importacao_empregados_notificacao_empresa_do_tenant
    FOREIGN KEY (empresa_id, tenant_id) REFERENCES app.empresa (id, tenant_id),
  CONSTRAINT importacao_empregados_notificacao_tentativa_da_empresa
    FOREIGN KEY (tentativa_id, empresa_id, tenant_id)
    REFERENCES app.importacao_empregados (id, empresa_id, tenant_id),
  CONSTRAINT importacao_empregados_notificacao_destinatario_do_tenant
    FOREIGN KEY (usuario_id, tenant_id) REFERENCES app.usuario (id, tenant_id)
);

CREATE INDEX importacao_empregados_notificacao_tenant_id_idx
  ON app.importacao_empregados_notificacao (tenant_id);
CREATE INDEX importacao_empregados_notificacao_empresa_id_idx
  ON app.importacao_empregados_notificacao (empresa_id);
CREATE INDEX importacao_empregados_notificacao_painel_idx
  ON app.importacao_empregados_notificacao (usuario_id, criado_em DESC, sequencia DESC);
CREATE INDEX importacao_empregados_notificacao_nao_lidas_idx
  ON app.importacao_empregados_notificacao (usuario_id) WHERE lida = false;

-- 7. RLS (classe `empresa`) e escopo imutavel ----------------------------------------------------

ALTER TABLE app.empregado ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.empresa_empregados_versao ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.importacao_empregados ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.importacao_empregados_linha ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.importacao_empregados_evento ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.importacao_empregados_notificacao ENABLE ROW LEVEL SECURITY;

ALTER TABLE app.empregado FORCE ROW LEVEL SECURITY;
ALTER TABLE app.empresa_empregados_versao FORCE ROW LEVEL SECURITY;
ALTER TABLE app.importacao_empregados FORCE ROW LEVEL SECURITY;
ALTER TABLE app.importacao_empregados_linha FORCE ROW LEVEL SECURITY;
ALTER TABLE app.importacao_empregados_evento FORCE ROW LEVEL SECURITY;
ALTER TABLE app.importacao_empregados_notificacao FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  alvo record;
  comando text;
BEGIN
  FOR alvo IN
    SELECT * FROM (VALUES
      ('empregado',                         ARRAY['SELECT', 'INSERT', 'UPDATE']),
      ('empresa_empregados_versao',         ARRAY['SELECT', 'INSERT', 'UPDATE']),
      ('importacao_empregados',             ARRAY['SELECT', 'INSERT', 'UPDATE']),
      -- Staging e trilha: sem politica de UPDATE/DELETE, a RLS forcada nega.
      ('importacao_empregados_linha',       ARRAY['SELECT', 'INSERT']),
      ('importacao_empregados_evento',      ARRAY['SELECT', 'INSERT']),
      ('importacao_empregados_notificacao', ARRAY['SELECT', 'INSERT', 'UPDATE'])
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

    EXECUTE format(
      'CREATE TRIGGER escopo_imutavel BEFORE UPDATE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.proteger_escopo_empresa()',
      alvo.tabela);
  END LOOP;
END
$$;

-- 8. Destinatarios administrativos da notificacao ------------------------------------------------

-- admin_escritorio ATIVO, com papel vigente e a empresa na carteira (mesmo criterio de
-- "administrador com acesso a empresa" do cofre, SPEC-011). A carteira de outros colaboradores so
-- e legivel na gestao de acesso e o worker (contexto tecnico) nao a le: por isso SECURITY DEFINER,
-- que so responde para a empresa que a PROPRIA sessao alcanca (`empresa_autorizada`) e devolve
-- apenas ids de usuario do tenant atual — nada fora do recorte da sessao vaza.
CREATE OR REPLACE FUNCTION app.admins_autorizados_da_empresa(p_empresa uuid) RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, public, pg_temp AS $$
  SELECT u.id
    FROM app.carteira_vinculo v
    JOIN app.usuario u ON u.id = v.usuario_id AND u.tenant_id = v.tenant_id
   WHERE app.empresa_autorizada(p_empresa)
     AND v.tenant_id = app.tenant_atual()
     AND v.empresa_id = p_empresa
     AND v.encerrado_em IS NULL
     AND u.estado = 'ATIVO'
     AND EXISTS (
       SELECT 1 FROM app.usuario_papel p
        WHERE p.usuario_id = u.id AND p.tenant_id = u.tenant_id
          AND p.papel = 'admin_escritorio' AND p.removido_em IS NULL)
   ORDER BY u.id;
$$;

REVOKE ALL ON FUNCTION app.admins_autorizados_da_empresa(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.admins_autorizados_da_empresa(uuid) TO contaia_app;
GRANT EXECUTE ON FUNCTION app.data_civil_valida(text) TO contaia_app;

-- 9. Pendencia "empregados nao importados" (F5) --------------------------------------------------

ALTER TABLE app.empresa_pendencia DROP CONSTRAINT empresa_pendencia_origem_check;
ALTER TABLE app.empresa_pendencia ADD CONSTRAINT empresa_pendencia_origem_check
  CHECK (origem IN ('CADASTRAL', 'DOCUMENTAL', 'CERTIFICADO', 'PLANO_CONTAS', 'EMPREGADOS'));

ALTER TABLE app.empresa_pendencia DROP CONSTRAINT empresa_pendencia_tipo_check;
ALTER TABLE app.empresa_pendencia ADD CONSTRAINT empresa_pendencia_tipo_check
  CHECK (tipo IN (
    'CAMPO_AUSENTE', 'CAMPO_INVALIDO', 'DOCUMENTO_AUSENTE',
    'DOCUMENTO_REJEITADO', 'DOCUMENTO_VENCIDO', 'EXIGENCIA_ESPECIFICA',
    'CERTIFICADO_AUSENTE', 'CERTIFICADO_VENCIDO', 'CERTIFICADO_SEM_RESPONSAVEL',
    'PLANO_CONTAS_INCOMPLETO', 'EMPREGADOS_NAO_IMPORTADOS'
  ));

-- Backfill (idempotente): toda empresa ATIVA sem nenhum empregado confirmado (nao arquivado) tem
-- a pendencia (SPEC-014 §3.10). Como a base nasce nesta migration, hoje isso e toda empresa ATIVA.
WITH novas AS (
  INSERT INTO app.empresa_pendencia (tenant_id, empresa_id, origem, tipo, chave)
  SELECT e.tenant_id, e.id, 'EMPREGADOS', 'EMPREGADOS_NAO_IMPORTADOS', 'empregados:nao-importados'
    FROM app.empresa e
   WHERE e.status = 'ATIVA' AND e.situacao = 'ativo'
     AND NOT EXISTS (
       SELECT 1 FROM app.empregado em
        WHERE em.empresa_id = e.id AND em.arquivado = false)
  ON CONFLICT (empresa_id, chave) WHERE estado = 'ABERTA' DO NOTHING
  RETURNING id, tenant_id, empresa_id
)
INSERT INTO app.empresa_evento_de_pendencia (tenant_id, empresa_id, pendencia_id, acao)
SELECT tenant_id, empresa_id, id, 'CRIACAO' FROM novas;

-- 10. Privilegios -------------------------------------------------------------------------------

-- Empregado: a importacao so atualiza nome, datas e o instante (SPEC-014 §3.6). Chave natural,
-- escopo e criacao nao mudam; arquivamento e reativacao sao do MVP-3 (sem privilegio aqui).
REVOKE UPDATE ON app.empregado FROM contaia_app;
GRANT UPDATE (nome, data_nascimento, data_admissao, atualizado_em) ON app.empregado TO contaia_app;

REVOKE UPDATE ON app.empresa_empregados_versao FROM contaia_app;
GRANT UPDATE (versao) ON app.empresa_empregados_versao TO contaia_app;

-- Tentativa: so o ciclo de vida. Arquivo, hash, iniciador, correlacao e criacao sao imutaveis.
REVOKE UPDATE ON app.importacao_empregados FROM contaia_app;
GRANT UPDATE (
  mapeamento, estado, empregados_versao_na_validacao, totais, usuario_confirmador_id,
  usuario_cancelador_id, iniciado_em, finalizado_em, reutilizada_por_idempotencia, obsoleta
) ON app.importacao_empregados TO contaia_app;

REVOKE UPDATE ON app.importacao_empregados_linha FROM contaia_app;
REVOKE UPDATE ON app.importacao_empregados_evento FROM contaia_app;

REVOKE UPDATE ON app.importacao_empregados_notificacao FROM contaia_app;
GRANT UPDATE (lida, lida_em) ON app.importacao_empregados_notificacao TO contaia_app;

-- O `pg_default_acl` do schema volta a conceder DELETE a cada tabela nova (ver 0004).
ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE DELETE ON TABLES FROM contaia_app;
REVOKE DELETE ON ALL TABLES IN SCHEMA app FROM contaia_app;
