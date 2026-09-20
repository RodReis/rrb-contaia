-- SPEC-003/F3 — manutencao da empresa cliente.
--
-- Tres mudancas: finalidade de endereco (F2 deixou so `principal`), historico
-- append-only de informacoes e a justificativa de arquivamento/reativacao, que
-- mora no proprio historico — a empresa guarda o estado, o evento guarda o porque.

-- 1. Finalidade do endereco -------------------------------------------------
--
-- A empresa ativa tem exatamente um endereco padrao e ele e sempre o FISCAL
-- (SPEC-003 secao 3.4). Modelar `principal` e `finalidade` como colunas
-- independentes permitiria estado incoerente, entao o CHECK amarra as duas:
-- padrao se e somente se FISCAL. Na pratica `principal` vira coluna derivada,
-- mantida porque o indice parcial e a F2 ja dependem dela.
ALTER TABLE app.empresa_endereco
  ADD COLUMN finalidade text NOT NULL DEFAULT 'FISCAL'
    CHECK (finalidade IN ('FISCAL', 'COBRANCA', 'CORRESPONDENCIA', 'OUTRO')),
  ADD COLUMN descricao text;

-- O DEFAULT acima da FISCAL a toda linha existente, inclusive as que nao sao
-- padrao — a F2 ja admitia endereco nao principal (arquivado, por exemplo), e
-- duas linhas FISCAL na mesma empresa quebrariam tanto o CHECK abaixo quanto o
-- indice de finalidade unica. Antes de criar as restricoes, o que nao e padrao
-- recebe CORRESPONDENCIA, a finalidade neutra desta fatia. Migration que so
-- funciona em tabela vazia nao e migration.
UPDATE app.empresa_endereco SET finalidade = 'CORRESPONDENCIA' WHERE NOT principal;

-- `OUTRO` exige descricao; as demais finalidades nao carregam descricao livre
-- (SPEC-003 secao 3.4).
ALTER TABLE app.empresa_endereco
  ADD CONSTRAINT empresa_endereco_descricao_apenas_em_outro CHECK (
    (finalidade = 'OUTRO' AND descricao IS NOT NULL)
    OR (finalidade <> 'OUTRO' AND descricao IS NULL)
  ),
  ADD CONSTRAINT empresa_endereco_fiscal_e_o_padrao CHECK (
    principal = (finalidade = 'FISCAL')
  );

-- Finalidade nao se repete entre enderecos ativos da mesma empresa; como sao
-- quatro finalidades, a empresa tem no maximo quatro enderecos ativos.
CREATE UNIQUE INDEX empresa_endereco_finalidade_unica_idx
  ON app.empresa_endereco (empresa_id, finalidade)
  WHERE situacao = 'ativo';

-- `em_troca` e um estado intermediario da troca de finalidade Fiscal: o indice
-- acima recusa o cruzamento de finalidades, porque indice unico e verificado
-- por linha e nao no fim do comando, e uma constraint DEFERRABLE nao aceita
-- predicado parcial. O endereco sai do indice por um instante e volta a `ativo`
-- na mesma transacao — nenhuma leitura concorrente enxerga o estado.
ALTER TABLE app.empresa_endereco
  DROP CONSTRAINT empresa_endereco_situacao_check;

ALTER TABLE app.empresa_endereco
  ADD CONSTRAINT empresa_endereco_situacao_check
    CHECK (situacao IN ('ativo', 'arquivado', 'em_troca'));

-- 2. Historico de Informacoes ------------------------------------------------
--
-- Append-only (I-6): sem GRANT de UPDATE nem de DELETE, e uma trigger que
-- rejeita os dois mesmo que um GRANT futuro escape. Uma tabela so, com `aba`
-- discriminando as quatro visoes da SPEC-003 secao 3.6 — os eventos tem a mesma
-- forma e os filtros sao os mesmos; separar em quatro tabelas custaria quatro
-- indices e uma UNION em toda consulta.
CREATE TABLE app.empresa_evento_de_historico (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES app.tenant(id),
  empresa_id uuid NOT NULL REFERENCES app.empresa(id),

  aba text NOT NULL CHECK (aba IN (
    'DADOS_CADASTRAIS', 'DADOS_FISCAIS', 'ENDERECOS', 'STATUS_DA_EMPRESA'
  )),
  acao text NOT NULL CHECK (acao IN (
    'ALTERACAO', 'INCLUSAO', 'ARQUIVAMENTO', 'REATIVACAO'
  )),

  -- `campo` e o identificador estavel do dado alterado (ex.: `razaoSocial`,
  -- `enderecos.COBRANCA.cep`); e o que alimenta o filtro "campo alterado".
  campo text NOT NULL,
  valor_anterior text,
  valor_novo text,

  -- Complementos condicionais da SPEC-003 secao 3.6: vigencia acompanha regime
  -- e CNAEs; justificativa acompanha arquivamento e reativacao.
  vigencia date,
  justificativa text,

  usuario_id uuid NOT NULL REFERENCES app.usuario(id),
  ocorrido_em timestamptz NOT NULL DEFAULT now(),

  -- `ocorrido_em` empata entre eventos da mesma transacao (`now()` e o inicio
  -- da transacao) e o `id` nao desempata: o uuid_v7 so e monotonico no prefixo
  -- de tempo, e o sufixo e aleatorio. Sem um criterio estavel, dois eventos
  -- salvos juntos apareceriam em ordem arbitraria na auditoria. A sequencia da
  -- a ordem de insercao, que e a ordem real dos fatos.
  sequencia bigint NOT NULL GENERATED ALWAYS AS IDENTITY
);

CREATE INDEX empresa_evento_de_historico_tenant_id_idx
  ON app.empresa_evento_de_historico (tenant_id);
-- A listagem abre do mais recente para o mais antigo e filtra por empresa,
-- periodo, usuario e campo (SPEC-003 secao 3.6).
CREATE INDEX empresa_evento_de_historico_consulta_idx
  ON app.empresa_evento_de_historico (tenant_id, ocorrido_em DESC, sequencia DESC);

ALTER TABLE app.empresa_evento_de_historico ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.empresa_evento_de_historico FORCE ROW LEVEL SECURITY;

CREATE POLICY empresa_evento_de_historico_isolamento ON app.empresa_evento_de_historico
  USING (tenant_id = app.tenant_atual())
  WITH CHECK (tenant_id = app.tenant_atual());

-- Append-only no banco, nao so na interface: a trigger vale para qualquer role,
-- inclusive uma que receba GRANT por engano numa fatia futura.
CREATE OR REPLACE FUNCTION app.rejeitar_escrita_em_historico()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'historico e append-only: % rejeitado', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER empresa_evento_de_historico_append_only
  BEFORE UPDATE OR DELETE ON app.empresa_evento_de_historico
  FOR EACH ROW EXECUTE FUNCTION app.rejeitar_escrita_em_historico();

-- INSERT e SELECT apenas: historico nao se corrige, se complementa.
GRANT SELECT, INSERT ON app.empresa_evento_de_historico TO contaia_app;

-- O `pg_default_acl` do schema volta a conceder DELETE a cada tabela nova
-- (ver o comentario extenso em 0004): o revoke tem de alcancar o default e o
-- que ja existe, em toda migration que cria tabela.
ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE DELETE ON TABLES FROM contaia_app;
REVOKE DELETE ON ALL TABLES IN SCHEMA app FROM contaia_app;
REVOKE UPDATE ON app.empresa_evento_de_historico FROM contaia_app;
