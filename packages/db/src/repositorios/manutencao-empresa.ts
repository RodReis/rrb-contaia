/**
 * Repositório da manutenção da empresa (SPEC-003): endereços com finalidade,
 * arquivamento/reativação e o Histórico de Informações.
 *
 * Como em SPEC-002, recebe o cliente da transação aberta pelo caso de uso e
 * filtra `tenant_id` no SQL além da RLS — a política é rede de segurança, não
 * autorização.
 */
import type {
  AbaDoHistorico,
  AcaoDoHistorico,
  EnderecoComFinalidade,
  FinalidadeDeEndereco,
  SituacaoDeRegistro,
} from '@contaia/domain';
import type { PoolClient } from 'pg';

// -- Endereços ---------------------------------------------------------------

type LinhaDoEnderecoComFinalidade = {
  id: string;
  finalidade: FinalidadeDeEndereco;
  descricao: string | null;
  principal: boolean;
  cep: string;
  logradouro: string;
  numero: string;
  complemento: string | null;
  bairro: string;
  municipio: string;
  uf: string;
  versao: number;
};

export type EnderecoDaEmpresaPersistido = EnderecoComFinalidade &
  Readonly<{ id: string; principal: boolean; versao: number }>;

const COLUNAS_DO_ENDERECO = `id, finalidade, descricao, principal, cep, logradouro,
       numero, complemento, bairro, municipio, uf, versao`;

const paraEnderecoDaEmpresaPersistido = (
  linha: LinhaDoEnderecoComFinalidade,
): EnderecoDaEmpresaPersistido => ({
  id: linha.id,
  finalidade: linha.finalidade,
  descricao: linha.descricao,
  principal: linha.principal,
  cep: linha.cep,
  logradouro: linha.logradouro,
  numero: linha.numero,
  complemento: linha.complemento,
  bairro: linha.bairro,
  municipio: linha.municipio,
  uf: linha.uf,
  versao: linha.versao,
});

/** Endereços ativos, com o Fiscal primeiro — é o padrão e abre a lista. */
export const listarEnderecosDaEmpresa = async (
  cliente: PoolClient,
  tenantId: string,
  empresaId: string,
): Promise<readonly EnderecoDaEmpresaPersistido[]> => {
  const { rows } = await cliente.query<LinhaDoEnderecoComFinalidade>(
    `select ${COLUNAS_DO_ENDERECO} from app.empresa_endereco
      where tenant_id = $1 and empresa_id = $2 and situacao = 'ativo'
      order by principal desc, finalidade`,
    [tenantId, empresaId],
  );

  return rows.map(paraEnderecoDaEmpresaPersistido);
};

export const carregarEndereco = async (
  cliente: PoolClient,
  tenantId: string,
  empresaId: string,
  enderecoId: string,
): Promise<EnderecoDaEmpresaPersistido | null> => {
  const { rows } = await cliente.query<LinhaDoEnderecoComFinalidade>(
    `select ${COLUNAS_DO_ENDERECO} from app.empresa_endereco
      where tenant_id = $1 and empresa_id = $2 and id = $3 and situacao = 'ativo'`,
    [tenantId, empresaId, enderecoId],
  );

  const linha = rows[0];
  return linha === undefined ? null : paraEnderecoDaEmpresaPersistido(linha);
};

export const inserirEndereco = async (
  cliente: PoolClient,
  tenantId: string,
  empresaId: string,
  endereco: EnderecoComFinalidade,
): Promise<string> => {
  const { rows } = await cliente.query<{ id: string }>(
    `insert into app.empresa_endereco
       (tenant_id, empresa_id, finalidade, descricao, principal,
        cep, logradouro, numero, complemento, bairro, municipio, uf)
     values ($1, $2, $3, $4, $3 = 'FISCAL', $5, $6, $7, $8, $9, $10, $11)
     returning id`,
    [
      tenantId,
      empresaId,
      endereco.finalidade,
      endereco.descricao,
      endereco.cep,
      endereco.logradouro,
      endereco.numero,
      endereco.complemento,
      endereco.bairro,
      endereco.municipio,
      endereco.uf,
    ],
  );

  const id = rows[0]?.id;

  if (id === undefined) {
    throw new Error('insert de endereço não devolveu id');
  }

  return id;
};

export const atualizarEndereco = async (
  cliente: PoolClient,
  tenantId: string,
  empresaId: string,
  enderecoId: string,
  endereco: EnderecoComFinalidade,
): Promise<void> => {
  await cliente.query(
    `update app.empresa_endereco
        set finalidade = $4, descricao = $5, principal = $4 = 'FISCAL',
            cep = $6, logradouro = $7, numero = $8, complemento = $9,
            bairro = $10, municipio = $11, uf = $12,
            atualizado_em = now(), versao = versao + 1
      where tenant_id = $1 and empresa_id = $2 and id = $3 and situacao = 'ativo'`,
    [
      tenantId,
      empresaId,
      enderecoId,
      endereco.finalidade,
      endereco.descricao,
      endereco.cep,
      endereco.logradouro,
      endereco.numero,
      endereco.complemento,
      endereco.bairro,
      endereco.municipio,
      endereco.uf,
    ],
  );
};

/**
 * Aplica as duas pontas da troca de finalidade Fiscal.
 *
 * Numa troca simples — o Fiscal vira Cobrança e o de Cobrança vira Fiscal — as
 * finalidades se cruzam, e o índice parcial de finalidade única recusa o estado
 * intermediário: o PostgreSQL verifica índice único por linha, durante o
 * comando, e não no fim dele. Um `UPDATE` só com `unnest` falha igual a dois
 * comandos separados. Adiar a verificação exigiria uma constraint `DEFERRABLE`,
 * que não aceita predicado parcial e portanto não serve aqui.
 *
 * A saída é passar por um estado que não colide: o endereço Fiscal atual sai
 * primeiro para `situacao = 'em_troca'`, que está fora do predicado do índice,
 * e volta a `ativo` já com a finalidade definitiva. Tudo dentro da transação do
 * caso de uso — nenhuma leitura concorrente vê o estado intermediário.
 */
export const aplicarTrocaDeFinalidade = async (
  cliente: PoolClient,
  tenantId: string,
  empresaId: string,
  atribuicoes: readonly Readonly<{
    id: string;
    finalidade: FinalidadeDeEndereco;
    principal: boolean;
  }>[],
): Promise<void> => {
  const anterior = atribuicoes.find((atribuicao) => !atribuicao.principal);
  const novoFiscal = atribuicoes.find((atribuicao) => atribuicao.principal);

  if (anterior === undefined || novoFiscal === undefined) {
    return;
  }

  // 1. Tira o Fiscal atual do índice, sem ainda dizer qual será sua finalidade.
  await cliente.query(
    `update app.empresa_endereco
        set situacao = 'em_troca'
      where tenant_id = $1 and empresa_id = $2 and id = $3 and situacao = 'ativo'`,
    [tenantId, empresaId, anterior.id],
  );

  // 2. Com a finalidade FISCAL livre, o novo endereço a assume.
  await cliente.query(
    `update app.empresa_endereco
        set finalidade = 'FISCAL', principal = true, descricao = null,
            atualizado_em = now(), versao = versao + 1
      where tenant_id = $1 and empresa_id = $2 and id = $3 and situacao = 'ativo'`,
    [tenantId, empresaId, novoFiscal.id],
  );

  // 3. O anterior volta ao índice já com a finalidade escolhida pelo usuário,
  //    que ficou livre no passo 2.
  await cliente.query(
    `update app.empresa_endereco
        set finalidade = $4, principal = false, descricao = null,
            situacao = 'ativo', atualizado_em = now(), versao = versao + 1
      where tenant_id = $1 and empresa_id = $2 and id = $3 and situacao = 'em_troca'`,
    [tenantId, empresaId, anterior.id, anterior.finalidade],
  );
};

/** Arquiva o endereço: nunca `DELETE` (I-7). */
export const arquivarEndereco = async (
  cliente: PoolClient,
  tenantId: string,
  empresaId: string,
  enderecoId: string,
): Promise<void> => {
  await cliente.query(
    `update app.empresa_endereco
        set situacao = 'arquivado', atualizado_em = now(), versao = versao + 1
      where tenant_id = $1 and empresa_id = $2 and id = $3 and situacao = 'ativo'`,
    [tenantId, empresaId, enderecoId],
  );
};

// -- Arquivamento da empresa -------------------------------------------------

export const situacaoDaEmpresa = async (
  cliente: PoolClient,
  tenantId: string,
  empresaId: string,
): Promise<SituacaoDeRegistro | null> => {
  const { rows } = await cliente.query<{ situacao: SituacaoDeRegistro }>(
    `select situacao from app.empresa where tenant_id = $1 and id = $2`,
    [tenantId, empresaId],
  );

  return rows[0]?.situacao ?? null;
};

export const definirSituacaoDaEmpresa = async (
  cliente: PoolClient,
  tenantId: string,
  empresaId: string,
  situacao: SituacaoDeRegistro,
): Promise<void> => {
  await cliente.query(
    `update app.empresa
        set situacao = $3, atualizado_em = now(), versao = versao + 1
      where tenant_id = $1 and id = $2`,
    [tenantId, empresaId, situacao],
  );
};

// -- Histórico de Informações ------------------------------------------------

export type EventoParaRegistrar = Readonly<{
  empresaId: string;
  aba: AbaDoHistorico;
  acao: AcaoDoHistorico;
  campo: string;
  valorAnterior: string | null;
  valorNovo: string | null;
  vigencia: string | null;
  justificativa: string | null;
  usuarioId: string;
}>;

/**
 * Grava os eventos do histórico. Roda **na mesma transação** da alteração que
 * os originou (SPEC-003 §4.2): se o insert falhar, a alteração sofre rollback.
 */
export const registrarEventos = async (
  cliente: PoolClient,
  tenantId: string,
  eventos: readonly EventoParaRegistrar[],
): Promise<void> => {
  if (eventos.length === 0) {
    return;
  }

  for (const evento of eventos) {
    await cliente.query(
      `insert into app.empresa_evento_de_historico
         (tenant_id, empresa_id, aba, acao, campo, valor_anterior, valor_novo,
          vigencia, justificativa, usuario_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        tenantId,
        evento.empresaId,
        evento.aba,
        evento.acao,
        evento.campo,
        evento.valorAnterior,
        evento.valorNovo,
        evento.vigencia,
        evento.justificativa,
        evento.usuarioId,
      ],
    );
  }
};

export type EventoNaLista = Readonly<{
  id: string;
  empresaId: string;
  empresaNome: string;
  aba: AbaDoHistorico;
  acao: AcaoDoHistorico;
  campo: string;
  valorAnterior: string | null;
  valorNovo: string | null;
  vigencia: string | null;
  justificativa: string | null;
  usuarioNome: string;
  ocorridoEm: string;
}>;

export type FiltroDoHistorico = Readonly<{
  aba: AbaDoHistorico | null;
  empresaId: string | null;
  inicio: string | null;
  fim: string | null;
  usuarioId: string | null;
  campo: string | null;
  limite: number;
  deslocamento: number;
}>;

export type PaginaDoHistorico = Readonly<{
  eventos: readonly EventoNaLista[];
  total: number;
}>;

type LinhaDoEvento = {
  id: string;
  empresa_id: string;
  empresa_nome: string | null;
  aba: AbaDoHistorico;
  acao: AcaoDoHistorico;
  campo: string;
  valor_anterior: string | null;
  valor_novo: string | null;
  vigencia: string | null;
  justificativa: string | null;
  usuario_nome: string | null;
  ocorrido_em: Date;
};

/**
 * Lista o histórico do tenant, do mais recente para o mais antigo
 * (SPEC-003 §3.6). Somente leitura: não há update nem delete neste repositório
 * — o banco também recusa, por trigger.
 */
export const listarHistorico = async (
  cliente: PoolClient,
  tenantId: string,
  filtro: FiltroDoHistorico,
): Promise<PaginaDoHistorico> => {
  const condicoes = `evento.tenant_id = $1
      and ($2::text is null or evento.aba = $2)
      and ($3::uuid is null or evento.empresa_id = $3)
      and ($4::date is null or evento.ocorrido_em >= $4::date)
      and ($5::date is null or evento.ocorrido_em < ($5::date + 1))
      and ($6::uuid is null or evento.usuario_id = $6)
      and ($7::text is null or evento.campo = $7)`;

  const parametros = [
    tenantId,
    filtro.aba,
    filtro.empresaId,
    filtro.inicio,
    filtro.fim,
    filtro.usuarioId,
    filtro.campo,
  ];

  const { rows } = await cliente.query<LinhaDoEvento>(
    `select evento.id, evento.empresa_id,
            coalesce(empresa.nome_fantasia, empresa.razao_social, empresa.cnpj)
              as empresa_nome,
            evento.aba, evento.acao, evento.campo,
            evento.valor_anterior, evento.valor_novo,
            to_char(evento.vigencia, 'YYYY-MM-DD') as vigencia,
            evento.justificativa,
            coalesce(usuario.nome, usuario.email) as usuario_nome,
            evento.ocorrido_em
       from app.empresa_evento_de_historico evento
       join app.empresa empresa on empresa.id = evento.empresa_id
       join app.usuario usuario on usuario.id = evento.usuario_id
      where ${condicoes}
      order by evento.ocorrido_em desc, evento.sequencia desc
      limit $8 offset $9`,
    [...parametros, filtro.limite, filtro.deslocamento],
  );

  const contagem = await cliente.query<{ total: string }>(
    `select count(*)::text as total
       from app.empresa_evento_de_historico evento
      where ${condicoes}`,
    parametros,
  );

  return {
    eventos: rows.map((linha) => ({
      id: linha.id,
      empresaId: linha.empresa_id,
      empresaNome: linha.empresa_nome ?? '',
      aba: linha.aba,
      acao: linha.acao,
      campo: linha.campo,
      valorAnterior: linha.valor_anterior,
      valorNovo: linha.valor_novo,
      vigencia: linha.vigencia,
      justificativa: linha.justificativa,
      usuarioNome: linha.usuario_nome ?? '',
      ocorridoEm: linha.ocorrido_em.toISOString(),
    })),
    total: Number(contagem.rows[0]?.total ?? '0'),
  };
};

/** Campos já usados em eventos: alimenta o filtro "campo alterado". */
export const camposComHistorico = async (
  cliente: PoolClient,
  tenantId: string,
  aba: AbaDoHistorico | null,
): Promise<readonly string[]> => {
  const { rows } = await cliente.query<{ campo: string }>(
    `select distinct campo from app.empresa_evento_de_historico
      where tenant_id = $1 and ($2::text is null or aba = $2)
      order by campo`,
    [tenantId, aba],
  );

  return rows.map((linha) => linha.campo);
};
