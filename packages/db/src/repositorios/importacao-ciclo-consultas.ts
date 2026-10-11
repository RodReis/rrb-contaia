/**
 * Consultas genéricas da importação (SPEC-013 e SPEC-014 §3.5, §3.9, §3.10): histórico, amostra de
 * rejeições, relatório por cursor e diagnóstico, sobre as tabelas do descritor (allowlist em
 * `importacao-ciclo.ts`; nomes nunca vêm de fora, valores são parâmetros). Como o ciclo, roda na
 * transação do chamador e filtra sempre pela `empresa_id` recebida, além da RLS. Só leitura.
 */
import { randomUUID } from 'node:crypto';

import type { EstadoDaImportacao } from '@contaia/domain';
import type { HistoricoDeImportacoes } from '@contaia/shared';
import type { PoolClient, QueryResultRow } from 'pg';

import { COLUNAS_DE_PLANILHA_SQL, exigirDescritor, paraDetalhesDePlanilha } from './importacao-ciclo.js';
import type { ColunasDePlanilha, DescritorDaImportacao, TotaisDaImportacao } from './importacao-ciclo.js';

/** Desfecho que carrega diagnóstico: a falha técnica e a rejeição do arquivo inteiro. */
export type DiagnosticoDaTentativa = Readonly<{
  acao: 'FALHA_TECNICA' | 'VALIDACAO_REJEITADA';
  /** Código estável (`^[A-Z][A-Z0-9_]*$`), nunca mensagem crua. */
  codigo: string;
}>;

export type Pagina<T> = Readonly<{
  pagina: number;
  itensPorPagina: number;
  total: number;
  itens: T[];
}>;

// --- apoio ---------------------------------------------------------------------------------------

/** Histórico: 15 tentativas por página, da mais recente para a mais antiga (SPEC-013/014 §3.9). */
export const ITENS_DO_HISTORICO = 15;
/** Linhas trazidas por ida ao banco na leitura do relatório (cursor). */
const LOTE_DO_RELATORIO = 500;
const MAXIMO_POR_PAGINA = 100;

/** Página ≥ 1 e tamanho entre 1 e 100: offset negativo ou página gigante nunca chegam ao SQL. */
export const paginacao = (
  pagina: number,
  porPagina: number,
): Readonly<{ pagina: number; porPagina: number; offset: number }> => {
  const paginaValida = Number.isInteger(pagina) && pagina >= 1 ? pagina : 1;
  const porPaginaValida = Number.isInteger(porPagina) ? Math.min(Math.max(porPagina, 1), MAXIMO_POR_PAGINA) : 1;

  return { pagina: paginaValida, porPagina: porPaginaValida, offset: (paginaValida - 1) * porPaginaValida };
};

/** Busca literal: `%`, `_` e `\` do usuário não viram curinga do LIKE. */
export const padraoDeBusca = (busca: string): string => `%${busca.replace(/[\\%_]/gu, (c) => `\\${c}`)}%`;

// --- consultas -----------------------------------------------------------------------------------

const TOTAIS_ZERADOS: TotaisDaImportacao = { lidas: 0, novas: 0, atualizadas: 0, rejeitadas: 0 };

type LinhaDoHistorico = ColunasDePlanilha & {
  id: string;
  arquivo_nome: string;
  arquivo_tamanho: string;
  hash_arquivo: string;
  mapeamento: Record<string, string>;
  estado: EstadoDaImportacao;
  totais: TotaisDaImportacao | null;
  criado_em: Date;
  finalizado_em: Date | null;
  correlation_id: string;
  reutilizada_por_idempotencia: boolean;
  iniciador_id: string;
  iniciador_nome: string;
  autor_id: string | null;
  autor_nome: string | null;
};

/** Histórico da empresa no contrato compartilhado: 15 por página, mais recente primeiro. */
export const listarHistorico = async (
  cliente: PoolClient,
  descritor: DescritorDaImportacao,
  empresaId: string,
  pagina: number,
): Promise<HistoricoDeImportacoes> => {
  const d = exigirDescritor(descritor);
  const recorte = paginacao(pagina, ITENS_DO_HISTORICO);
  const { rows: contagem } = await cliente.query<{ total: number }>(
    `select count(*)::int as total from app.${d.tabela} where empresa_id = $1`,
    [empresaId],
  );
  const { rows } = await cliente.query<LinhaDoHistorico>(
    `select t.id, t.arquivo_nome, t.arquivo_tamanho::text as arquivo_tamanho, t.hash_arquivo, t.mapeamento,
            t.estado, t.totais, t.criado_em, t.finalizado_em, t.correlation_id, t.reutilizada_por_idempotencia,
            ui.id as iniciador_id, ui.nome as iniciador_nome,
            ua.id as autor_id, ua.nome as autor_nome, ${COLUNAS_DE_PLANILHA_SQL}
       from app.${d.tabela} t
       join app.usuario ui on ui.id = t.usuario_iniciador_id and ui.tenant_id = t.tenant_id
       left join app.usuario ua
         on ua.id = coalesce(t.usuario_confirmador_id, t.usuario_cancelador_id) and ua.tenant_id = t.tenant_id
      where t.empresa_id = $1
      order by t.criado_em desc, t.sequencia desc
      limit $2 offset $3`,
    [empresaId, recorte.porPagina, recorte.offset],
  );

  return {
    pagina: recorte.pagina,
    itensPorPagina: recorte.porPagina,
    total: contagem[0]!.total,
    itens: rows.map((linha) => ({
      id: linha.id,
      arquivo: { nome: linha.arquivo_nome, tamanho: Number(linha.arquivo_tamanho), hash: linha.hash_arquivo },
      mapeamento: linha.mapeamento,
      usuarioIniciador: { id: linha.iniciador_id, nome: linha.iniciador_nome },
      usuarioConfirmadorOuCancelador:
        linha.autor_id === null || linha.autor_nome === null ? null : { id: linha.autor_id, nome: linha.autor_nome },
      estado: linha.estado,
      totais: linha.totais ?? TOTAIS_ZERADOS,
      inicioEm: linha.criado_em.toISOString(),
      fimEm: linha.finalizado_em === null ? null : linha.finalizado_em.toISOString(),
      correlationId: linha.correlation_id,
      reutilizadaPorIdempotencia: linha.reutilizada_por_idempotencia,
      ...paraDetalhesDePlanilha(linha),
      // O contrato do histórico é o tipo inferido do zod (array mutável).
      diagnosticosDaPlanilha: linha.diagnosticos,
    })),
  };
};

/**
 * Amostra paginada das rejeições, por número de linha. Lê `numero_linha, campo, codigo_de_erro,
 * mensagem` e as colunas de identificação do descritor; o domínio converte cada linha.
 */
export const listarRejeicoes = async <L extends QueryResultRow, R>(
  cliente: PoolClient,
  descritor: DescritorDaImportacao,
  empresaId: string,
  tentativaId: string,
  pagina: number,
  porPagina: number,
  paraItem: (linha: L) => R,
): Promise<Pagina<R>> => {
  const d = exigirDescritor(descritor);
  const recorte = paginacao(pagina, porPagina);
  const { rows: contagem } = await cliente.query<{ total: number }>(
    `select count(*)::int as total from app.${d.tabelaLinha}
      where tentativa_id = $1 and empresa_id = $2 and status = 'REJEITADA'`,
    [tentativaId, empresaId],
  );
  const { rows } = await cliente.query<L>(
    `select numero_linha, ${d.colunasDaRejeicao}, campo, codigo_de_erro, mensagem
       from app.${d.tabelaLinha}
      where tentativa_id = $1 and empresa_id = $2 and status = 'REJEITADA'
      order by numero_linha
      limit $3 offset $4`,
    [tentativaId, empresaId, recorte.porPagina, recorte.offset],
  );

  return { pagina: recorte.pagina, itensPorPagina: recorte.porPagina, total: contagem[0]!.total, itens: rows.map(paraItem) };
};

/**
 * Fecha o cursor do relatório. Depois de uma falha a transação está abortada (25P02) e o CLOSE
 * também falha: o ROLLBACK do chamador descarta o cursor, e o erro que importa é o original —
 * então, nesse caso, a falha do CLOSE é engolida para não mascará-lo.
 */
const fecharCursor = async (cliente: PoolClient, cursor: string, depoisDeFalha: boolean): Promise<void> => {
  try {
    await cliente.query(`close ${cursor}`);
  } catch (erroAoFechar) {
    if (!depoisDeFalha) {
      throw erroAoFechar;
    }
  }
};

/**
 * Todas as linhas da tentativa, em ordem de linha, por cursor no servidor (lotes de 500): o
 * relatório de 10.000 linhas nunca é carregado inteiro na memória. Lê `numero_linha`, as colunas
 * do relatório do descritor e `status, acao, codigo_de_erro, campo, mensagem`. Exige a transação do
 * chamador aberta durante toda a leitura; o cursor é fechado ao fim, num `break` ou num erro.
 */
export async function* listarLinhasParaRelatorio<L extends QueryResultRow, R>(
  cliente: PoolClient,
  descritor: DescritorDaImportacao,
  empresaId: string,
  tentativaId: string,
  paraLinha: (linha: L) => R,
): AsyncGenerator<R, void, undefined> {
  const d = exigirDescritor(descritor);
  // Nome gerado aqui (hex), nunca vindo de fora: identificador seguro para DECLARE/FETCH/CLOSE.
  const cursor = `relatorio_${randomUUID().replaceAll('-', '')}`;

  await cliente.query(
    `declare ${cursor} no scroll cursor for
       select numero_linha, ${d.colunasDoRelatorio}, status, acao, codigo_de_erro, campo, mensagem
         from app.${d.tabelaLinha}
        where tentativa_id = $1 and empresa_id = $2
        order by numero_linha`,
    [tentativaId, empresaId],
  );

  let falhou = false;

  try {
    for (;;) {
      const { rows } = await cliente.query<L>(`fetch ${LOTE_DO_RELATORIO} from ${cursor}`);

      for (const linha of rows) {
        yield paraLinha(linha);
      }

      if (rows.length < LOTE_DO_RELATORIO) {
        return;
      }
    }
  } catch (erro) {
    falhou = true;
    throw erro;
  } finally {
    await fecharCursor(cliente, cursor, falhou);
  }
}

/**
 * Último evento de falha técnica ou de rejeição do arquivo que tenha código (desfecho acionável).
 * Rejeição só por conteúdo das linhas não tem código: devolve `null`, como a tentativa de outra
 * empresa, de outro tenant ou sem evento assim.
 */
export const buscarDiagnosticoDaTentativa = async (
  cliente: PoolClient,
  descritor: DescritorDaImportacao,
  empresaId: string,
  tentativaId: string,
): Promise<DiagnosticoDaTentativa | null> => {
  const d = exigirDescritor(descritor);
  const { rows } = await cliente.query<DiagnosticoDaTentativa>(
    `select acao, codigo
       from app.${d.tabelaEvento}
      where tentativa_id = $1 and empresa_id = $2
        and acao in ('FALHA_TECNICA', 'VALIDACAO_REJEITADA')
        and codigo is not null
      order by sequencia desc
      limit 1`,
    [tentativaId, empresaId],
  );

  return rows[0] ?? null;
};
