-- SPEC-013/F13 — Plano de contas da empresa e importacao por CSV.
--
-- Todas as tabelas sao da classe `empresa` (SPEC-010 §3.5): tenant_id + empresa_id NOT NULL,
-- FK composta (empresa_id, tenant_id) -> empresa, RLS forcada com `app.empresa_autorizada`,
-- escopo imutavel por trigger e nenhum DELETE para a aplicacao (I-7).
--
--   conta_contabil                      plano vigente; chave natural (empresa_id, codigo)
--   empresa_plano_versao                versao otimista do plano (SPEC-013 §6.3), uma por empresa
--   importacao_plano_contas             tentativa: arquivo, mapeamento, estado, totais
--   importacao_plano_contas_linha       staging normalizado + rejeicoes por linha (valor cru)
--   importacao_plano_contas_evento      trilha append-only da tentativa (I-6)
--   importacao_plano_contas_notificacao conclusao para quem iniciou (sino da F6)
--
-- O arquivo original e o relatorio ficam no object storage local; o banco guarda so a chave do
-- objeto, o hash e o resultado. Por fim: a pendencia "plano de contas incompleto" (F5) e o seu
-- backfill para as empresas que ja existem.

-- 1. Plano de contas vigente ---------------------------------------------------------------------

CREATE TABLE app.conta_contabil (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES app.tenant(id),
  empresa_id uuid NOT NULL,

  -- Sem regra de formato alem de "nao vazio": o contrato da conta e da validacao do dominio, e
  -- um CHECK mais estreito aqui recusaria na aplicacao uma linha que a validacao aceitou.
  codigo text NOT NULL CHECK (btrim(codigo) <> ''),
  nome text NOT NULL CHECK (btrim(nome) <> ''),
  tipo text NOT NULL CHECK (tipo IN ('analitica', 'sintetica')),
  natureza text NOT NULL CHECK (natureza IN ('devedora', 'credora')),
  -- Nula so na conta raiz.
  conta_pai text,

  arquivada boolean NOT NULL DEFAULT false,
  arquivada_em timestamptz,
  -- Sobe a cada alteracao real (trigger): auditoria da conta, nao a versao do plano.
  versao bigint NOT NULL DEFAULT 1 CHECK (versao > 0),
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT conta_contabil_chave_natural UNIQUE (empresa_id, codigo),
  CONSTRAINT conta_contabil_arquivamento_condizente CHECK (arquivada = (arquivada_em IS NOT NULL)),
  CONSTRAINT conta_contabil_pai_nao_e_ela_mesma CHECK (conta_pai IS NULL OR conta_pai <> codigo),
  CONSTRAINT conta_contabil_empresa_do_tenant
    FOREIGN KEY (empresa_id, tenant_id) REFERENCES app.empresa (id, tenant_id),
  -- O pai existe na MESMA empresa. Verificado no fim da transacao: a aplicacao grava o lote
  -- inteiro numa transacao so e a ordem das linhas nao define a hierarquia (SPEC-013 §3.4, §3.6).
  CONSTRAINT conta_contabil_pai_da_mesma_empresa
    FOREIGN KEY (empresa_id, conta_pai) REFERENCES app.conta_contabil (empresa_id, codigo)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX conta_contabil_tenant_id_idx ON app.conta_contabil (tenant_id);
CREATE INDEX conta_contabil_empresa_id_idx ON app.conta_contabil (empresa_id);
-- Filhas de uma conta (regra "sintetica com filhas nao vira analitica").
CREATE INDEX conta_contabil_conta_pai_idx ON app.conta_contabil (empresa_id, conta_pai);

-- O codigo e a chave natural e nunca muda; conta arquivada nao e atualizada nem reativada pela
-- importacao (SPEC-013 §3.6) — a reativacao, quando existir, e fluxo proprio. A aplicacao ja nao
-- tem UPDATE em `codigo` (privilegio de coluna); a trigger vale tambem para o superusuario.
CREATE OR REPLACE FUNCTION app.proteger_conta_contabil() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW IS NOT DISTINCT FROM OLD THEN
    RETURN NEW;
  END IF;

  IF NEW.codigo IS DISTINCT FROM OLD.codigo THEN
    RAISE EXCEPTION 'o codigo da conta contabil e a chave natural e nao muda'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF OLD.arquivada THEN
    RAISE EXCEPTION 'conta contabil arquivada nao e atualizada nem reativada'
      USING ERRCODE = 'restrict_violation';
  END IF;

  NEW.versao := OLD.versao + 1;

  RETURN NEW;
END;
$$;

CREATE TRIGGER conta_contabil_protegida
  BEFORE UPDATE ON app.conta_contabil
  FOR EACH ROW EXECUTE FUNCTION app.proteger_conta_contabil();

-- 2. Versao otimista do plano --------------------------------------------------------------------

-- Uma linha por empresa, criada sob demanda (`INSERT ... ON CONFLICT (empresa_id, tenant_id) DO
-- NOTHING`) e incrementada a cada aplicacao confirmada. A validacao guarda a versao lida; a
-- confirmacao com versao diferente e conflito (HTTP 409, nada aplicado). Nunca `max(versao)` das
-- contas: conta nova nao muda versao de conta nenhuma.
-- A chave e (empresa_id, tenant_id): como a FK composta amarra a empresa ao seu unico tenant, ela
-- equivale a "uma por empresa", e uma linha com tenant trocado cai na FK (23503), nao numa
-- colisao. `id` existe para a matriz de RLS e para a trilha, como nas demais tabelas.
CREATE TABLE app.empresa_plano_versao (
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES app.tenant(id),
  empresa_id uuid NOT NULL,
  versao bigint NOT NULL DEFAULT 0 CHECK (versao >= 0),

  CONSTRAINT empresa_plano_versao_pkey PRIMARY KEY (empresa_id, tenant_id),
  CONSTRAINT empresa_plano_versao_id_unico UNIQUE (id),
  CONSTRAINT empresa_plano_versao_empresa_do_tenant
    FOREIGN KEY (empresa_id, tenant_id) REFERENCES app.empresa (id, tenant_id)
);

CREATE INDEX empresa_plano_versao_tenant_id_idx ON app.empresa_plano_versao (tenant_id);

-- A versao so sobe: voltar atras faria uma previa obsoleta parecer atual.
CREATE OR REPLACE FUNCTION app.proteger_empresa_plano_versao() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.versao < OLD.versao THEN
    RAISE EXCEPTION 'a versao do plano de contas so sobe' USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER empresa_plano_versao_protegida
  BEFORE UPDATE ON app.empresa_plano_versao
  FOR EACH ROW EXECUTE FUNCTION app.proteger_empresa_plano_versao();

-- 3. Tentativa de importacao ---------------------------------------------------------------------

-- A tentativa nasce JA com o mapeamento: o upload vem antes e a API calcula o hash do arquivo no
-- servidor. Por isso a identidade idempotente (tenant + empresa + hash + mapeamento, SPEC-013
-- §3.7) e uma UNIQUE (parcial, ver `importacao_plano_contas_idempotente`), sem estado
-- intermediario sem mapeamento.
CREATE TABLE app.importacao_plano_contas (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES app.tenant(id),
  empresa_id uuid NOT NULL,

  hash_arquivo text NOT NULL CHECK (hash_arquivo ~ '^[0-9a-f]{64}$'),
  mapeamento jsonb NOT NULL CHECK (jsonb_typeof(mapeamento) = 'object'),
  arquivo_nome text NOT NULL CHECK (btrim(arquivo_nome) <> ''),
  -- Limite da SPEC-013 §3.2: 10 MB.
  arquivo_tamanho bigint NOT NULL CHECK (arquivo_tamanho BETWEEN 0 AND 10485760),
  -- Chave do objeto original no storage local (nunca o conteudo).
  arquivo_chave text NOT NULL CHECK (btrim(arquivo_chave) <> ''),

  estado text NOT NULL DEFAULT 'RECEBIDA' CHECK (estado IN (
    'RECEBIDA', 'VALIDANDO', 'AGUARDANDO_CONFIRMACAO', 'APLICANDO',
    'CONCLUIDA', 'CONCLUIDA_COM_REJEICOES', 'REJEITADA', 'CANCELADA', 'FALHA'
  )),
  -- Versao do plano (empresa_plano_versao) sobre a qual a previa foi formada: fixada junto com o
  -- staging em gravarResultadoDaValidacao (nula ate a validacao terminar); a confirmacao a compara.
  plano_versao_na_validacao bigint CHECK (plano_versao_na_validacao >= 0),
  -- {lidas, novas, atualizadas, rejeitadas}; nulo ate a validacao terminar.
  totais jsonb CHECK (totais IS NULL OR jsonb_typeof(totais) = 'object'),

  usuario_iniciador_id uuid NOT NULL,
  usuario_confirmador_id uuid,
  usuario_cancelador_id uuid,
  correlation_id text NOT NULL,
  -- O ultimo pedido desta identidade reutilizou o resultado existente (SPEC-013 §3.9).
  reutilizada_por_idempotencia boolean NOT NULL DEFAULT false,

  criado_em timestamptz NOT NULL DEFAULT now(),
  -- Inicio do processamento (validacao) e termino (estado terminal).
  iniciado_em timestamptz,
  finalizado_em timestamptz,
  sequencia bigint NOT NULL GENERATED ALWAYS AS IDENTITY,

  -- Alvo das FKs compostas das filhas (linha, evento, notificacao): a filha nunca aponta para a
  -- tentativa de outra empresa ou de outro tenant.
  CONSTRAINT importacao_plano_contas_escopo UNIQUE (id, empresa_id, tenant_id),
  CONSTRAINT importacao_plano_contas_termino_condizente CHECK (
    (estado IN ('CONCLUIDA', 'CONCLUIDA_COM_REJEICOES', 'REJEITADA', 'CANCELADA', 'FALHA'))
    = (finalizado_em IS NOT NULL)
  ),
  CONSTRAINT importacao_plano_contas_cancelamento_com_autor CHECK (
    estado <> 'CANCELADA' OR usuario_cancelador_id IS NOT NULL
  ),
  CONSTRAINT importacao_plano_contas_empresa_do_tenant
    FOREIGN KEY (empresa_id, tenant_id) REFERENCES app.empresa (id, tenant_id),
  CONSTRAINT importacao_plano_contas_iniciador_do_tenant
    FOREIGN KEY (usuario_iniciador_id, tenant_id) REFERENCES app.usuario (id, tenant_id),
  CONSTRAINT importacao_plano_contas_confirmador_do_tenant
    FOREIGN KEY (usuario_confirmador_id, tenant_id) REFERENCES app.usuario (id, tenant_id),
  CONSTRAINT importacao_plano_contas_cancelador_do_tenant
    FOREIGN KEY (usuario_cancelador_id, tenant_id) REFERENCES app.usuario (id, tenant_id)
);

CREATE INDEX importacao_plano_contas_tenant_id_idx ON app.importacao_plano_contas (tenant_id);
CREATE INDEX importacao_plano_contas_empresa_id_idx ON app.importacao_plano_contas (empresa_id);
-- Identidade idempotente (SPEC-013 §3.7): uma tentativa viva ou com resultado reutilizavel
-- (CONCLUIDA, CONCLUIDA_COM_REJEICOES, REJEITADA) por tenant + empresa + hash + mapeamento.
-- FALHA e CANCELADA saem do indice: depois de falha tecnica, de cancelamento ou de uma previa
-- obsoleta cancelada, o mesmo arquivo com o mesmo mapeamento pode ser validado de novo (§3.6,
-- §3.8, §5.3). A aplicacao usa `ON CONFLICT (...) WHERE estado NOT IN ('FALHA', 'CANCELADA')`.
CREATE UNIQUE INDEX importacao_plano_contas_idempotente
  ON app.importacao_plano_contas (empresa_id, tenant_id, hash_arquivo, mapeamento)
  WHERE estado NOT IN ('FALHA', 'CANCELADA');
-- Historico: 15 por pagina, mais recente primeiro (SPEC-013 §3.9).
CREATE INDEX importacao_plano_contas_historico_idx
  ON app.importacao_plano_contas (empresa_id, criado_em DESC, sequencia DESC);

-- Estado terminal nao reabre nem muda (SPEC-013 §3.11). A unica marca aceita depois do fim e a de
-- reuso idempotente, que nao altera o resultado. O contexto (arquivo, hash, iniciador, correlacao)
-- ja e imutavel para a aplicacao por privilegio de coluna.
CREATE OR REPLACE FUNCTION app.proteger_importacao_plano_contas() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.estado IN ('CONCLUIDA', 'CONCLUIDA_COM_REJEICOES', 'REJEITADA', 'CANCELADA', 'FALHA')
     AND (to_jsonb(NEW) - 'reutilizada_por_idempotencia')
         IS DISTINCT FROM (to_jsonb(OLD) - 'reutilizada_por_idempotencia') THEN
    RAISE EXCEPTION 'tentativa de importacao em estado terminal nao muda'
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- O mapeamento faz parte da identidade idempotente e e o "mapeamento utilizado" da previa
  -- (SPEC-013 §3.9, §6.3): so muda antes da validacao comecar.
  IF NEW.mapeamento IS DISTINCT FROM OLD.mapeamento AND OLD.estado <> 'RECEBIDA' THEN
    RAISE EXCEPTION 'o mapeamento da tentativa so muda enquanto RECEBIDA'
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER importacao_plano_contas_protegida
  BEFORE UPDATE ON app.importacao_plano_contas
  FOR EACH ROW EXECUTE FUNCTION app.proteger_importacao_plano_contas();

-- 4. Staging da validacao ------------------------------------------------------------------------

-- Uma linha por linha de dados do arquivo, valida ou rejeitada. As colunas de valor sao texto
-- ANULAVEL e sem CHECK de dominio: a linha rejeitada por campo ausente ou fora do dominio guarda o
-- valor cru, para o relatorio. So a linha VALIDA exige o dominio (e a acao que a previa mostrou).
CREATE TABLE app.importacao_plano_contas_linha (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES app.tenant(id),
  empresa_id uuid NOT NULL,
  tentativa_id uuid NOT NULL,

  numero_linha integer NOT NULL CHECK (numero_linha > 0),
  codigo text,
  nome text,
  tipo text,
  natureza text,
  conta_pai text,

  status text NOT NULL CHECK (status IN ('VALIDA', 'REJEITADA')),
  acao text CHECK (acao IN ('INCLUIR', 'ATUALIZAR')),
  -- Codigo estavel do dominio (CodigoDeErroDaLinha); a lista vive no dominio, aqui so o formato.
  codigo_de_erro text CHECK (codigo_de_erro ~ '^[A-Z][A-Z0-9_]*$'),
  campo text,
  mensagem text,
  sequencia bigint NOT NULL GENERATED ALWAYS AS IDENTITY,

  -- Reentrega do job nao duplica staging: o worker grava com ON CONFLICT DO NOTHING (SPEC-013 §6.4).
  CONSTRAINT importacao_plano_contas_linha_unica UNIQUE (tentativa_id, numero_linha),
  CONSTRAINT importacao_plano_contas_linha_valida_condizente CHECK (
    status <> 'VALIDA' OR (
      codigo IS NOT NULL AND btrim(codigo) <> ''
      AND nome IS NOT NULL AND btrim(nome) <> ''
      AND tipo IN ('analitica', 'sintetica')
      AND natureza IN ('devedora', 'credora')
      AND acao IS NOT NULL
      AND codigo_de_erro IS NULL
    )
  ),
  CONSTRAINT importacao_plano_contas_linha_rejeitada_condizente CHECK (
    status <> 'REJEITADA' OR (codigo_de_erro IS NOT NULL AND acao IS NULL)
  ),
  CONSTRAINT importacao_plano_contas_linha_empresa_do_tenant
    FOREIGN KEY (empresa_id, tenant_id) REFERENCES app.empresa (id, tenant_id),
  CONSTRAINT importacao_plano_contas_linha_tentativa_da_empresa
    FOREIGN KEY (tentativa_id, empresa_id, tenant_id)
    REFERENCES app.importacao_plano_contas (id, empresa_id, tenant_id)
);

CREATE INDEX importacao_plano_contas_linha_tenant_id_idx ON app.importacao_plano_contas_linha (tenant_id);
CREATE INDEX importacao_plano_contas_linha_empresa_id_idx ON app.importacao_plano_contas_linha (empresa_id);
-- Amostra paginada das rejeicoes na previa.
CREATE INDEX importacao_plano_contas_linha_rejeicoes_idx
  ON app.importacao_plano_contas_linha (tentativa_id, numero_linha) WHERE status = 'REJEITADA';

-- 5. Trilha append-only da tentativa (I-6) -------------------------------------------------------

CREATE TABLE app.importacao_plano_contas_evento (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES app.tenant(id),
  empresa_id uuid NOT NULL,
  tentativa_id uuid NOT NULL,

  -- Criacao, reuso idempotente e cada evento da maquina de estados do dominio.
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
  -- Autor humano (iniciador, confirmador, cancelador); nulo no evento do worker.
  usuario_id uuid,
  totais jsonb CHECK (totais IS NULL OR jsonb_typeof(totais) = 'object'),
  -- Codigo estavel da falha tecnica, quando houver; nunca stack trace.
  codigo text CHECK (codigo ~ '^[A-Z][A-Z0-9_]*$'),
  correlation_id text NOT NULL,
  ocorrido_em timestamptz NOT NULL DEFAULT now(),
  sequencia bigint NOT NULL GENERATED ALWAYS AS IDENTITY,

  CONSTRAINT importacao_plano_contas_evento_empresa_do_tenant
    FOREIGN KEY (empresa_id, tenant_id) REFERENCES app.empresa (id, tenant_id),
  CONSTRAINT importacao_plano_contas_evento_tentativa_da_empresa
    FOREIGN KEY (tentativa_id, empresa_id, tenant_id)
    REFERENCES app.importacao_plano_contas (id, empresa_id, tenant_id),
  CONSTRAINT importacao_plano_contas_evento_autor_do_tenant
    FOREIGN KEY (usuario_id, tenant_id) REFERENCES app.usuario (id, tenant_id)
);

CREATE INDEX importacao_plano_contas_evento_tenant_id_idx ON app.importacao_plano_contas_evento (tenant_id);
CREATE INDEX importacao_plano_contas_evento_empresa_id_idx ON app.importacao_plano_contas_evento (empresa_id);
CREATE INDEX importacao_plano_contas_evento_tentativa_idx
  ON app.importacao_plano_contas_evento (tentativa_id, ocorrido_em, sequencia);

CREATE TRIGGER importacao_plano_contas_evento_append_only
  BEFORE UPDATE OR DELETE ON app.importacao_plano_contas_evento
  FOR EACH ROW EXECUTE FUNCTION app.rejeitar_escrita_em_historico();

-- 6. Notificacao de conclusao ------------------------------------------------------------------

-- Classe `empresa`, como empresa_certificado_notificacao: quem grava e o worker da empresa ou o
-- caso de uso de confirmacao do contador (fora da gestao de acesso), e a classe `tenant` com
-- INSERT so na gestao de acesso nao os deixaria gravar. O sino filtra por `usuario_id` (so o
-- iniciador recebe, SPEC-013 §3.10); estado e totais vem da tentativa, terminal e imutavel.
CREATE TABLE app.importacao_plano_contas_notificacao (
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
  CONSTRAINT importacao_plano_contas_notificacao_unica UNIQUE (tentativa_id, usuario_id),
  CONSTRAINT importacao_plano_contas_notificacao_lida_condizente CHECK (
    (lida = false AND lida_em IS NULL) OR (lida = true AND lida_em IS NOT NULL)
  ),
  CONSTRAINT importacao_plano_contas_notificacao_empresa_do_tenant
    FOREIGN KEY (empresa_id, tenant_id) REFERENCES app.empresa (id, tenant_id),
  CONSTRAINT importacao_plano_contas_notificacao_tentativa_da_empresa
    FOREIGN KEY (tentativa_id, empresa_id, tenant_id)
    REFERENCES app.importacao_plano_contas (id, empresa_id, tenant_id),
  CONSTRAINT importacao_plano_contas_notificacao_destinatario_do_tenant
    FOREIGN KEY (usuario_id, tenant_id) REFERENCES app.usuario (id, tenant_id)
);

CREATE INDEX importacao_plano_contas_notificacao_tenant_id_idx
  ON app.importacao_plano_contas_notificacao (tenant_id);
CREATE INDEX importacao_plano_contas_notificacao_empresa_id_idx
  ON app.importacao_plano_contas_notificacao (empresa_id);
-- Sino do usuario: painel e contador de nao lidas.
CREATE INDEX importacao_plano_contas_notificacao_painel_idx
  ON app.importacao_plano_contas_notificacao (usuario_id, criado_em DESC, sequencia DESC);
CREATE INDEX importacao_plano_contas_notificacao_nao_lidas_idx
  ON app.importacao_plano_contas_notificacao (usuario_id) WHERE lida = false;

-- 7. RLS (classe `empresa`) e escopo imutavel ----------------------------------------------------

ALTER TABLE app.conta_contabil ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.empresa_plano_versao ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.importacao_plano_contas ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.importacao_plano_contas_linha ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.importacao_plano_contas_evento ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.importacao_plano_contas_notificacao ENABLE ROW LEVEL SECURITY;

ALTER TABLE app.conta_contabil FORCE ROW LEVEL SECURITY;
ALTER TABLE app.empresa_plano_versao FORCE ROW LEVEL SECURITY;
ALTER TABLE app.importacao_plano_contas FORCE ROW LEVEL SECURITY;
ALTER TABLE app.importacao_plano_contas_linha FORCE ROW LEVEL SECURITY;
ALTER TABLE app.importacao_plano_contas_evento FORCE ROW LEVEL SECURITY;
ALTER TABLE app.importacao_plano_contas_notificacao FORCE ROW LEVEL SECURITY;

-- Tenant + empresa autorizada (carteira do humano ou a empresa exata do job tecnico).
DO $$
DECLARE
  alvo record;
  comando text;
BEGIN
  FOR alvo IN
    SELECT * FROM (VALUES
      ('conta_contabil',                      ARRAY['SELECT', 'INSERT', 'UPDATE']),
      ('empresa_plano_versao',                ARRAY['SELECT', 'INSERT', 'UPDATE']),
      ('importacao_plano_contas',             ARRAY['SELECT', 'INSERT', 'UPDATE']),
      -- Staging e trilha: sem politica de UPDATE/DELETE, a RLS forcada nega.
      ('importacao_plano_contas_linha',       ARRAY['SELECT', 'INSERT']),
      ('importacao_plano_contas_evento',      ARRAY['SELECT', 'INSERT']),
      ('importacao_plano_contas_notificacao', ARRAY['SELECT', 'INSERT', 'UPDATE'])
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

    -- UPDATE nao move linha entre tenant nem empresa (SPEC-010 §3.4).
    EXECUTE format(
      'CREATE TRIGGER escopo_imutavel BEFORE UPDATE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.proteger_escopo_empresa()',
      alvo.tabela);
  END LOOP;
END
$$;

-- 8. Pendencia "plano de contas incompleto" (F5) ------------------------------------------------

ALTER TABLE app.empresa_pendencia DROP CONSTRAINT empresa_pendencia_origem_check;
ALTER TABLE app.empresa_pendencia ADD CONSTRAINT empresa_pendencia_origem_check
  CHECK (origem IN ('CADASTRAL', 'DOCUMENTAL', 'CERTIFICADO', 'PLANO_CONTAS'));

ALTER TABLE app.empresa_pendencia DROP CONSTRAINT empresa_pendencia_tipo_check;
ALTER TABLE app.empresa_pendencia ADD CONSTRAINT empresa_pendencia_tipo_check
  CHECK (tipo IN (
    'CAMPO_AUSENTE', 'CAMPO_INVALIDO', 'DOCUMENTO_AUSENTE',
    'DOCUMENTO_REJEITADO', 'DOCUMENTO_VENCIDO', 'EXIGENCIA_ESPECIFICA',
    'CERTIFICADO_AUSENTE', 'CERTIFICADO_VENCIDO', 'CERTIFICADO_SEM_RESPONSAVEL',
    'PLANO_CONTAS_INCOMPLETO'
  ));

-- Backfill (idempotente): toda empresa ATIVA sem nenhuma conta valida (nao arquivada) tem a
-- pendencia de plano de contas incompleto (SPEC-013 §3.10). Como o plano nasce nesta migration,
-- hoje isso e toda empresa ATIVA — mas a consulta vale para qualquer estado do banco.
WITH novas AS (
  INSERT INTO app.empresa_pendencia (tenant_id, empresa_id, origem, tipo, chave)
  SELECT e.tenant_id, e.id, 'PLANO_CONTAS', 'PLANO_CONTAS_INCOMPLETO', 'plano-contas:incompleto'
    FROM app.empresa e
   WHERE e.status = 'ATIVA' AND e.situacao = 'ativo'
     AND NOT EXISTS (
       SELECT 1 FROM app.conta_contabil cc
        WHERE cc.empresa_id = e.id AND cc.arquivada = false)
  ON CONFLICT (empresa_id, chave) WHERE estado = 'ABERTA' DO NOTHING
  RETURNING id, tenant_id, empresa_id
)
INSERT INTO app.empresa_evento_de_pendencia (tenant_id, empresa_id, pendencia_id, acao)
SELECT tenant_id, empresa_id, id, 'CRIACAO' FROM novas;

-- 9. Privilegios --------------------------------------------------------------------------------

-- Conta: o codigo (chave natural), o escopo e a criacao nao mudam; a versao da conta e da trigger.
REVOKE UPDATE ON app.conta_contabil FROM contaia_app;
GRANT UPDATE (nome, tipo, natureza, conta_pai, arquivada, arquivada_em, atualizado_em)
  ON app.conta_contabil TO contaia_app;

-- Versao do plano: so o numero.
REVOKE UPDATE ON app.empresa_plano_versao FROM contaia_app;
GRANT UPDATE (versao) ON app.empresa_plano_versao TO contaia_app;

-- Tentativa: so o ciclo de vida. Arquivo, hash, iniciador, correlacao e criacao sao imutaveis.
REVOKE UPDATE ON app.importacao_plano_contas FROM contaia_app;
GRANT UPDATE (
  mapeamento, estado, plano_versao_na_validacao, totais, usuario_confirmador_id,
  usuario_cancelador_id, iniciado_em, finalizado_em, reutilizada_por_idempotencia
) ON app.importacao_plano_contas TO contaia_app;

-- Staging e trilha: SELECT e INSERT; nenhum UPDATE.
REVOKE UPDATE ON app.importacao_plano_contas_linha FROM contaia_app;
REVOKE UPDATE ON app.importacao_plano_contas_evento FROM contaia_app;

-- Notificacao: so a leitura.
REVOKE UPDATE ON app.importacao_plano_contas_notificacao FROM contaia_app;
GRANT UPDATE (lida, lida_em) ON app.importacao_plano_contas_notificacao TO contaia_app;

-- O `pg_default_acl` do schema volta a conceder DELETE a cada tabela nova (ver 0004).
ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE DELETE ON TABLES FROM contaia_app;
REVOKE DELETE ON ALL TABLES IN SCHEMA app FROM contaia_app;
