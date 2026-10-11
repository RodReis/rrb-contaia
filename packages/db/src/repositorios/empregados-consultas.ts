/**
 * Consultas dos empregados e da importação por CSV (SPEC-014 §3.4, §3.5, §3.9, §3.10).
 *
 * Histórico e diagnóstico são os genéricos de `importacao-ciclo-consultas.ts` com
 * `DESCRITOR_EMPREGADOS`; aqui ficam rejeições e relatório no formato de empregado, a base em
 * consulta, a contagem que decide a pendência e a base vigente no formato da validação. Roda na
 * transação do chamador e filtra sempre pela `empresa_id` recebida, além da RLS. Só leitura.
 */
import type {
  CodigoDeErroDeEmpregado,
  EmpregadoVigente,
  LinhaDoRelatorioDeEmpregados,
} from '@contaia/domain';
import type { PaginaDeEmpregados, PaginaDeRejeicoesDeEmpregados } from '@contaia/shared';
import type { PoolClient } from 'pg';

import {
  listarLinhasParaRelatorio,
  listarRejeicoes,
  paginacao,
  padraoDeBusca,
} from './importacao-ciclo-consultas.js';
import { DESCRITOR_EMPREGADOS as D } from './importacao-ciclo.js';
import type { AcaoDaLinha } from './importacao-ciclo.js';

/**
 * Base vigente no formato da validação do domínio: chave `${cpf}|${matricula}` (11 dígitos e
 * matrícula como gravada) e a marca de arquivado. Chamar DEPOIS de `iniciarValidacao`.
 */
export const carregarEmpregadosVigentes = async (
  cliente: PoolClient,
  empresaId: string,
): Promise<ReadonlyMap<string, EmpregadoVigente>> => {
  const { rows } = await cliente.query<{ cpf: string; matricula: string; arquivado: boolean }>(
    `select cpf, matricula, arquivado from app.empregado where empresa_id = $1`,
    [empresaId],
  );

  return new Map(rows.map((linha) => [`${linha.cpf}|${linha.matricula}`, { arquivado: linha.arquivado }]));
};

/** Empregados não arquivados: zero mantém a pendência "empregados não importados" (§3.10). */
export const contarEmpregadosConfirmados = async (cliente: PoolClient, empresaId: string): Promise<number> => {
  const { rows } = await cliente.query<{ total: number }>(
    `select count(*)::int as total from app.empregado where empresa_id = $1 and arquivado = false`,
    [empresaId],
  );

  return rows[0]!.total;
};

/**
 * Base da empresa em consulta (ativos e arquivados, com a marca), por nome, no contrato
 * compartilhado. Busca literal (sem curinga do usuário) em nome ou matrícula; se o termo tem
 * dígitos, também no CPF por esses dígitos (aceita o CPF com máscara).
 */
export const listarEmpregados = async (
  cliente: PoolClient,
  empresaId: string,
  pagina: number,
  porPagina: number,
  busca?: string,
): Promise<PaginaDeEmpregados> => {
  const recorte = paginacao(pagina, porPagina);
  const aparada = busca?.trim() ?? '';
  const termo = aparada === '' ? null : padraoDeBusca(aparada);
  const digitos = aparada.replace(/\D/gu, '');
  const termoDoCpf = digitos === '' ? null : `%${digitos}%`;
  const filtro = `empresa_id = $1 and ($2::text is null
    or nome ilike $2 escape '\\' or matricula ilike $2 escape '\\' or cpf like $3::text)`;
  const { rows: contagem } = await cliente.query<{ total: number }>(
    `select count(*)::int as total from app.empregado where ${filtro}`,
    [empresaId, termo, termoDoCpf],
  );
  const { rows } = await cliente.query<{
    id: string;
    cpf: string;
    nome: string;
    matricula: string;
    data_nascimento: string;
    data_admissao: string;
    arquivado: boolean;
  }>(
    `select id, cpf, nome, matricula, to_char(data_nascimento, 'YYYY-MM-DD') as data_nascimento,
            to_char(data_admissao, 'YYYY-MM-DD') as data_admissao, arquivado
       from app.empregado
      where ${filtro}
      order by nome, matricula, id
      limit $4 offset $5`,
    [empresaId, termo, termoDoCpf, recorte.porPagina, recorte.offset],
  );

  return {
    pagina: recorte.pagina,
    itensPorPagina: recorte.porPagina,
    total: contagem[0]!.total,
    itens: rows.map((linha) => ({
      id: linha.id,
      cpf: linha.cpf,
      nome: linha.nome,
      matricula: linha.matricula,
      dataNascimento: linha.data_nascimento,
      dataAdmissao: linha.data_admissao,
      arquivado: linha.arquivado,
    })),
  };
};

type RejeicaoNoBanco = {
  numero_linha: number;
  cpf: string | null;
  matricula: string | null;
  campo: string | null;
  codigo_de_erro: CodigoDeErroDeEmpregado;
  mensagem: string | null;
};

/** Amostra paginada das rejeições da prévia: CPF e matrícula como vieram no arquivo. */
export const listarRejeicoesDeEmpregados = (
  cliente: PoolClient,
  empresaId: string,
  tentativaId: string,
  pagina: number,
  porPagina: number,
): Promise<PaginaDeRejeicoesDeEmpregados> =>
  listarRejeicoes(cliente, D, empresaId, tentativaId, pagina, porPagina, (linha: RejeicaoNoBanco) => ({
    numeroDaLinha: linha.numero_linha,
    cpf: linha.cpf,
    matricula: linha.matricula,
    campo: linha.campo,
    codigoDeErro: linha.codigo_de_erro,
    mensagem: linha.mensagem,
  }));

type LinhaDoStagingNoBanco = {
  numero_linha: number;
  cpf: string | null;
  nome: string | null;
  matricula: string | null;
  data_nascimento: string | null;
  data_admissao: string | null;
  status: 'VALIDA' | 'REJEITADA';
  acao: AcaoDaLinha | null;
  codigo_de_erro: CodigoDeErroDeEmpregado | null;
  campo: string | null;
  mensagem: string | null;
};

const paraLinhaDoRelatorio = (linha: LinhaDoStagingNoBanco): LinhaDoRelatorioDeEmpregados => ({
  numeroDaLinha: linha.numero_linha,
  cpf: linha.cpf,
  nome: linha.nome,
  matricula: linha.matricula,
  dataNascimento: linha.data_nascimento,
  dataAdmissao: linha.data_admissao,
  status: linha.status,
  acao: linha.acao,
  codigoDeErro: linha.codigo_de_erro,
  campo: linha.campo,
  mensagem: linha.mensagem,
});

/**
 * Todas as linhas da tentativa, em ordem de linha, por cursor (lotes de 500), no formato que
 * `gerarRelatorioCsvDeEmpregados` consome. Exige a transação do chamador aberta durante a leitura.
 */
export const listarLinhasParaRelatorioDeEmpregados = (
  cliente: PoolClient,
  empresaId: string,
  tentativaId: string,
): AsyncGenerator<LinhaDoRelatorioDeEmpregados, void, undefined> =>
  listarLinhasParaRelatorio(cliente, D, empresaId, tentativaId, paraLinhaDoRelatorio);
