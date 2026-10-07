import type { Finalidade } from './finalidades.js';

/**
 * Decisão de idempotência do Signer (SPEC-012 §3.8, I-9).
 *
 * A chave é avaliada junto de tenant, empresa, finalidade e hash do conteúdo:
 * qualquer divergência com a mesma chave é conflito, em qualquer estado.
 */

export type EstadoDaOperacao = 'EM_ANDAMENTO' | 'CONCLUIDA' | 'RECUSADA' | 'FALHA_TRANSITORIA';

/**
 * Quanto tempo uma operação pode ficar `EM_ANDAMENTO` antes de se presumir que o processo que a
 * executava morreu. Cobre com folga as duas esperas da fase com segredo (Vault e destino, 15 s cada
 * no máximo). Passado o prazo, a MESMA operação é retomada; o destino deduplica pelo `operacaoId`.
 */
export const PRAZO_DE_EM_ANDAMENTO_MS = 120_000;

export type OperacaoExistente = Readonly<{
  id: string;
  tenantId: string;
  empresaId: string;
  finalidade: Finalidade;
  hashConteudo: string;
  estado: EstadoDaOperacao;
  /** Há quanto tempo está (ou ficou) em andamento, pelo relógio do banco. */
  emAndamentoHaMs: number;
}>;

export type PedidoIdempotente = Readonly<{
  tenantId: string;
  empresaId: string;
  finalidade: Finalidade;
  hashConteudo: string;
}>;

export type DecisaoDeIdempotencia =
  | Readonly<{ tipo: 'NOVA' }>
  | Readonly<{ tipo: 'REUTILIZAR'; operacaoId: string }>
  | Readonly<{ tipo: 'EM_ANDAMENTO'; operacaoId: string }>
  | Readonly<{ tipo: 'RETENTAR'; operacaoId: string }>
  | Readonly<{ tipo: 'CONFLITO' }>;

export const decidirIdempotencia = (
  existente: OperacaoExistente | null,
  pedido: PedidoIdempotente,
): DecisaoDeIdempotencia => {
  if (existente === null) {
    return { tipo: 'NOVA' };
  }

  const mesmoContexto =
    existente.tenantId === pedido.tenantId &&
    existente.empresaId === pedido.empresaId &&
    existente.finalidade === pedido.finalidade &&
    existente.hashConteudo === pedido.hashConteudo;

  if (!mesmoContexto) {
    return { tipo: 'CONFLITO' };
  }

  switch (existente.estado) {
    case 'CONCLUIDA':
    case 'RECUSADA':
      return { tipo: 'REUTILIZAR', operacaoId: existente.id };
    case 'EM_ANDAMENTO':
      return existente.emAndamentoHaMs > PRAZO_DE_EM_ANDAMENTO_MS
        ? { tipo: 'RETENTAR', operacaoId: existente.id }
        : { tipo: 'EM_ANDAMENTO', operacaoId: existente.id };
    case 'FALHA_TRANSITORIA':
      return { tipo: 'RETENTAR', operacaoId: existente.id };
  }
};
