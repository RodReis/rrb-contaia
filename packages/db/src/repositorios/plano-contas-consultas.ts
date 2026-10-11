/**
 * Consultas do plano de contas e da importação por CSV (SPEC-013 §3.5, §3.9, §3.10).
 *
 * Histórico, rejeições, relatório e diagnóstico são os genéricos de `importacao-ciclo-consultas.ts`
 * com `DESCRITOR_PLANO_CONTAS`; aqui ficam a conversão para os tipos da F13 (assinaturas
 * inalteradas) e as consultas do próprio plano. Roda dentro da transação do chamador e filtra
 * sempre pela `empresa_id` recebida, além da RLS. Só leitura.
 */
import type { CodigoDeErroDaLinha, ContaVigente, NaturezaDaConta, TipoDaConta } from '@contaia/domain';
import type { HistoricoDeImportacoes } from '@contaia/shared';
import type { PoolClient } from 'pg';

import {
  buscarDiagnosticoDaTentativa as buscarDiagnosticoNoCiclo,
  listarHistorico as listarHistoricoNoCiclo,
  listarLinhasParaRelatorio as listarLinhasNoCiclo,
  listarRejeicoes as listarRejeicoesNoCiclo,
  paginacao,
  padraoDeBusca,
} from './importacao-ciclo-consultas.js';
import type { DiagnosticoDaTentativa } from './importacao-ciclo-consultas.js';
import { DESCRITOR_PLANO_CONTAS as D } from './importacao-ciclo.js';
import type { AcaoDaLinha } from './plano-contas.js';

export { ITENS_DO_HISTORICO } from './importacao-ciclo-consultas.js';
export type { DiagnosticoDaTentativa } from './importacao-ciclo-consultas.js';

export type RejeicaoDaLinha = Readonly<{
  numeroDaLinha: number;
  codigo: string | null;
  campo: string | null;
  codigoDeErro: CodigoDeErroDaLinha;
  mensagem: string | null;
}>;

export type PaginaDeRejeicoes = Readonly<{
  pagina: number;
  itensPorPagina: number;
  total: number;
  itens: readonly RejeicaoDaLinha[];
}>;

/** Uma linha do relatório completo: valores como gravados no staging e o resultado da validação. */
export type LinhaDoRelatorio = Readonly<{
  numeroDaLinha: number;
  codigo: string | null;
  nome: string | null;
  tipo: string | null;
  natureza: string | null;
  contaPai: string | null;
  status: 'VALIDA' | 'REJEITADA';
  acao: AcaoDaLinha | null;
  codigoDeErro: CodigoDeErroDaLinha | null;
  campo: string | null;
  mensagem: string | null;
}>;

export type ContaDoPlano = Readonly<{
  id: string;
  codigo: string;
  nome: string;
  tipo: TipoDaConta;
  natureza: NaturezaDaConta;
  contaPai: string | null;
  arquivada: boolean;
  versao: number;
  atualizadoEm: Date;
}>;

export type PaginaDoPlano = Readonly<{
  pagina: number;
  itensPorPagina: number;
  total: number;
  itens: readonly ContaDoPlano[];
}>;

/** Histórico da empresa no contrato compartilhado: 15 por página, mais recente primeiro. */
export const listarHistorico = (cliente: PoolClient, empresaId: string, pagina: number): Promise<HistoricoDeImportacoes> =>
  listarHistoricoNoCiclo(cliente, D, empresaId, pagina);

type RejeicaoNoBanco = {
  numero_linha: number;
  codigo: string | null;
  campo: string | null;
  codigo_de_erro: CodigoDeErroDaLinha;
  mensagem: string | null;
};

/** Amostra paginada das rejeições da prévia, por número de linha. */
export const listarRejeicoes = (
  cliente: PoolClient,
  empresaId: string,
  tentativaId: string,
  pagina: number,
  porPagina: number,
): Promise<PaginaDeRejeicoes> =>
  listarRejeicoesNoCiclo(cliente, D, empresaId, tentativaId, pagina, porPagina, (linha: RejeicaoNoBanco) => ({
    numeroDaLinha: linha.numero_linha,
    codigo: linha.codigo,
    campo: linha.campo,
    codigoDeErro: linha.codigo_de_erro,
    mensagem: linha.mensagem,
  }));

type LinhaDoStagingNoBanco = {
  numero_linha: number;
  codigo: string | null;
  nome: string | null;
  tipo: string | null;
  natureza: string | null;
  conta_pai: string | null;
  status: 'VALIDA' | 'REJEITADA';
  acao: AcaoDaLinha | null;
  codigo_de_erro: CodigoDeErroDaLinha | null;
  campo: string | null;
  mensagem: string | null;
};

const paraLinhaDoRelatorio = (linha: LinhaDoStagingNoBanco): LinhaDoRelatorio => ({
  numeroDaLinha: linha.numero_linha,
  codigo: linha.codigo,
  nome: linha.nome,
  tipo: linha.tipo,
  natureza: linha.natureza,
  contaPai: linha.conta_pai,
  status: linha.status,
  acao: linha.acao,
  codigoDeErro: linha.codigo_de_erro,
  campo: linha.campo,
  mensagem: linha.mensagem,
});

/**
 * Todas as linhas da tentativa, em ordem de linha, por cursor no servidor (lotes de 500). Exige a
 * transação do chamador aberta durante toda a leitura. Ver `importacao-ciclo-consultas`.
 */
export const listarLinhasParaRelatorio = (
  cliente: PoolClient,
  empresaId: string,
  tentativaId: string,
): AsyncGenerator<LinhaDoRelatorio, void, undefined> =>
  listarLinhasNoCiclo(cliente, D, empresaId, tentativaId, paraLinhaDoRelatorio);

/** Plano da empresa (ativas e arquivadas, com a marca), por código; busca literal em código ou nome. */
export const listarPlano = async (
  cliente: PoolClient,
  empresaId: string,
  pagina: number,
  porPagina: number,
  busca?: string,
): Promise<PaginaDoPlano> => {
  const recorte = paginacao(pagina, porPagina);
  const termo = busca === undefined || busca.trim() === '' ? null : padraoDeBusca(busca.trim());
  const filtro = `empresa_id = $1 and ($2::text is null or codigo ilike $2 escape '\\' or nome ilike $2 escape '\\')`;
  const { rows: contagem } = await cliente.query<{ total: number }>(
    `select count(*)::int as total from app.conta_contabil where ${filtro}`,
    [empresaId, termo],
  );
  const { rows } = await cliente.query<{
    id: string;
    codigo: string;
    nome: string;
    tipo: TipoDaConta;
    natureza: NaturezaDaConta;
    conta_pai: string | null;
    arquivada: boolean;
    versao: string;
    atualizado_em: Date;
  }>(
    `select id, codigo, nome, tipo, natureza, conta_pai, arquivada, versao::text as versao, atualizado_em
       from app.conta_contabil
      where ${filtro}
      order by codigo, id
      limit $3 offset $4`,
    [empresaId, termo, recorte.porPagina, recorte.offset],
  );

  return {
    pagina: recorte.pagina,
    itensPorPagina: recorte.porPagina,
    total: contagem[0]!.total,
    itens: rows.map((linha) => ({
      id: linha.id,
      codigo: linha.codigo,
      nome: linha.nome,
      tipo: linha.tipo,
      natureza: linha.natureza,
      contaPai: linha.conta_pai,
      arquivada: linha.arquivada,
      versao: Number(linha.versao),
      atualizadoEm: linha.atualizado_em,
    })),
  };
};

/** Situação do cadastro que decide se a empresa aceita escrita no plano de contas. */
export type SituacaoDaEmpresaParaImportacao = Readonly<{ arquivada: boolean; ativa: boolean }>;

/**
 * Situação da empresa sob a RLS da sessão (`null` fora do alcance). Empresa arquivada é somente
 * consulta (SPEC-003 §3.5) — o administrador a alcança sem vínculo, então o caso de uso precisa
 * recusar a escrita explicitamente; empresa em cadastro ainda não tem plano a importar.
 */
export const carregarSituacaoDaEmpresa = async (
  cliente: PoolClient,
  empresaId: string,
): Promise<SituacaoDaEmpresaParaImportacao | null> => {
  const { rows } = await cliente.query<{ situacao: string; status: string }>(
    `select situacao, status from app.empresa where id = $1`,
    [empresaId],
  );
  const linha = rows[0];

  return linha === undefined ? null : { arquivada: linha.situacao === 'arquivado', ativa: linha.status === 'ATIVA' };
};

/** Contas válidas (não arquivadas): zero mantém a pendência de plano incompleto (SPEC-013 §3.10). */
export const contarContasValidas = async (cliente: PoolClient, empresaId: string): Promise<number> => {
  const { rows } = await cliente.query<{ total: number }>(
    `select count(*)::int as total from app.conta_contabil where empresa_id = $1 and arquivada = false`,
    [empresaId],
  );

  return rows[0]!.total;
};

/**
 * Plano vigente no formato da validação do domínio: código, tipo, arquivada, se tem filhas
 * (qualquer filha, inclusive arquivada) e a conta-pai — a validação monta a hierarquia RESULTANTE
 * (vigente + lote) para recusar ciclos formados com contas vigentes (SPEC-013 §3.4, §7).
 * Chamar DEPOIS de `iniciarValidacao`.
 */
export const carregarContasVigentes = async (
  cliente: PoolClient,
  empresaId: string,
): Promise<readonly ContaVigente[]> => {
  const { rows } = await cliente.query<{
    codigo: string;
    tipo: TipoDaConta;
    arquivada: boolean;
    tem_filhas: boolean;
    conta_pai: string | null;
  }>(
    `select cc.codigo, cc.tipo, cc.arquivada, cc.conta_pai,
            exists (select 1 from app.conta_contabil f
                     where f.empresa_id = cc.empresa_id and f.conta_pai = cc.codigo) as tem_filhas
       from app.conta_contabil cc
      where cc.empresa_id = $1`,
    [empresaId],
  );

  return rows.map((linha) => ({
    codigo: linha.codigo,
    tipo: linha.tipo,
    arquivada: linha.arquivada,
    temFilhas: linha.tem_filhas,
    contaPai: linha.conta_pai,
  }));
};


/**
 * Último evento de falha técnica ou de rejeição do arquivo que tenha código (SPEC-013 §3.10, §7).
 * Rejeição só por conteúdo das linhas, outra empresa, outro tenant ou sem evento → `null`.
 */
export const buscarDiagnosticoDaTentativa = (
  cliente: PoolClient,
  empresaId: string,
  tentativaId: string,
): Promise<DiagnosticoDaTentativa | null> => buscarDiagnosticoNoCiclo(cliente, D, empresaId, tentativaId);
