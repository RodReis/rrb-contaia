/**
 * Consultas do plano de contas e da importação por CSV (SPEC-013 §3.5, §3.9, §3.10).
 *
 * Como o repositório de escrita (`plano-contas.ts`), roda dentro da transação do chamador
 * (`comContextoHumano` ou contexto técnico da empresa) e filtra sempre pela `empresa_id` recebida,
 * além da RLS. Só leitura.
 */
import { randomUUID } from 'node:crypto';

import type { CodigoDeErroDaLinha, ContaVigente, EstadoDaImportacao, NaturezaDaConta, TipoDaConta } from '@contaia/domain';
import type { HistoricoDeImportacoes } from '@contaia/shared';
import type { PoolClient } from 'pg';

import type { AcaoDaLinha, TotaisDaImportacao } from './plano-contas.js';

/** Histórico: 15 tentativas por página, da mais recente para a mais antiga (SPEC-013 §3.9). */
export const ITENS_DO_HISTORICO = 15;
/** Linhas trazidas por ida ao banco na leitura do relatório (cursor). */
const LOTE_DO_RELATORIO = 500;
const MAXIMO_POR_PAGINA = 100;

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

/** Página ≥ 1 e tamanho entre 1 e 100: offset negativo ou página gigante nunca chegam ao SQL. */
const paginacao = (pagina: number, porPagina: number): Readonly<{ pagina: number; porPagina: number; offset: number }> => {
  const paginaValida = Number.isInteger(pagina) && pagina >= 1 ? pagina : 1;
  const porPaginaValida = Number.isInteger(porPagina) ? Math.min(Math.max(porPagina, 1), MAXIMO_POR_PAGINA) : 1;

  return { pagina: paginaValida, porPagina: porPaginaValida, offset: (paginaValida - 1) * porPaginaValida };
};

/** Busca literal: `%`, `_` e `\` do usuário não viram curinga do LIKE. */
const padraoDeBusca = (busca: string): string => `%${busca.replace(/[\\%_]/gu, (c) => `\\${c}`)}%`;

const TOTAIS_ZERADOS: TotaisDaImportacao = { lidas: 0, novas: 0, atualizadas: 0, rejeitadas: 0 };

type LinhaDoHistorico = {
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
  empresaId: string,
  pagina: number,
): Promise<HistoricoDeImportacoes> => {
  const recorte = paginacao(pagina, ITENS_DO_HISTORICO);
  const { rows: contagem } = await cliente.query<{ total: number }>(
    `select count(*)::int as total from app.importacao_plano_contas where empresa_id = $1`,
    [empresaId],
  );
  const { rows } = await cliente.query<LinhaDoHistorico>(
    `select t.id, t.arquivo_nome, t.arquivo_tamanho::text as arquivo_tamanho, t.hash_arquivo, t.mapeamento,
            t.estado, t.totais, t.criado_em, t.finalizado_em, t.correlation_id, t.reutilizada_por_idempotencia,
            ui.id as iniciador_id, ui.nome as iniciador_nome,
            ua.id as autor_id, ua.nome as autor_nome
       from app.importacao_plano_contas t
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
    })),
  };
};

/** Amostra paginada das rejeições da prévia, por número de linha. */
export const listarRejeicoes = async (
  cliente: PoolClient,
  empresaId: string,
  tentativaId: string,
  pagina: number,
  porPagina: number,
): Promise<PaginaDeRejeicoes> => {
  const recorte = paginacao(pagina, porPagina);
  const { rows: contagem } = await cliente.query<{ total: number }>(
    `select count(*)::int as total from app.importacao_plano_contas_linha
      where tentativa_id = $1 and empresa_id = $2 and status = 'REJEITADA'`,
    [tentativaId, empresaId],
  );
  const { rows } = await cliente.query<{
    numero_linha: number;
    codigo: string | null;
    campo: string | null;
    codigo_de_erro: CodigoDeErroDaLinha;
    mensagem: string | null;
  }>(
    `select numero_linha, codigo, campo, codigo_de_erro, mensagem
       from app.importacao_plano_contas_linha
      where tentativa_id = $1 and empresa_id = $2 and status = 'REJEITADA'
      order by numero_linha
      limit $3 offset $4`,
    [tentativaId, empresaId, recorte.porPagina, recorte.offset],
  );

  return {
    pagina: recorte.pagina,
    itensPorPagina: recorte.porPagina,
    total: contagem[0]!.total,
    itens: rows.map((linha) => ({
      numeroDaLinha: linha.numero_linha,
      codigo: linha.codigo,
      campo: linha.campo,
      codigoDeErro: linha.codigo_de_erro,
      mensagem: linha.mensagem,
    })),
  };
};

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
 * Todas as linhas da tentativa, em ordem de linha, por cursor no servidor (lotes de 500): o
 * relatório de 10.000 linhas nunca é carregado inteiro na memória. Exige a transação do chamador
 * aberta durante toda a leitura; o cursor é fechado ao fim, num `break` ou num erro.
 */
export async function* listarLinhasParaRelatorio(
  cliente: PoolClient,
  empresaId: string,
  tentativaId: string,
): AsyncGenerator<LinhaDoRelatorio, void, undefined> {
  // Nome gerado aqui (hex), nunca vindo de fora: identificador seguro para DECLARE/FETCH/CLOSE.
  const cursor = `relatorio_plano_${randomUUID().replaceAll('-', '')}`;

  await cliente.query(
    `declare ${cursor} no scroll cursor for
       select numero_linha, codigo, nome, tipo, natureza, conta_pai, status, acao, codigo_de_erro, campo, mensagem
         from app.importacao_plano_contas_linha
        where tentativa_id = $1 and empresa_id = $2
        order by numero_linha`,
    [tentativaId, empresaId],
  );

  let falhou = false;

  try {
    for (;;) {
      const { rows } = await cliente.query<LinhaDoStagingNoBanco>(`fetch ${LOTE_DO_RELATORIO} from ${cursor}`);

      for (const linha of rows) {
        yield paraLinhaDoRelatorio(linha);
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

/** Desfecho que carrega diagnóstico: a falha técnica e a rejeição do arquivo inteiro. */
export type DiagnosticoDaTentativa = Readonly<{
  acao: 'FALHA_TECNICA' | 'VALIDACAO_REJEITADA';
  /** Código estável (`^[A-Z][A-Z0-9_]*$`), nunca mensagem crua. */
  codigo: string;
}>;

/**
 * Último evento de falha técnica ou de rejeição do arquivo que tenha código (SPEC-013 §3.10, §7:
 * desfecho acionável). Rejeição só por conteúdo das linhas não tem código: devolve `null`, como a
 * tentativa de outra empresa, de outro tenant ou sem evento assim.
 */
export const buscarDiagnosticoDaTentativa = async (
  cliente: PoolClient,
  empresaId: string,
  tentativaId: string,
): Promise<DiagnosticoDaTentativa | null> => {
  const { rows } = await cliente.query<DiagnosticoDaTentativa>(
    `select acao, codigo
       from app.importacao_plano_contas_evento
      where tentativa_id = $1 and empresa_id = $2
        and acao in ('FALHA_TECNICA', 'VALIDACAO_REJEITADA')
        and codigo is not null
      order by sequencia desc
      limit 1`,
    [tentativaId, empresaId],
  );

  return rows[0] ?? null;
};
