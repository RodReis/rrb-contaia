import type { CodigoDoLeitor, DetalheDoErro } from './erros.ts';

/** O que ler: a lista de abas ou uma aba (posição base 1). */
export type OperacaoDePlanilha = { readonly tipo: 'inspecionar' } | { readonly tipo: 'ler-aba'; readonly abaPosicao: number };

/**
 * Resposta do processo filho, escrita como JSON no stdout (o pai lê com teto de bytes). Nunca carrega
 * conteúdo do arquivo fora de `resultado`: erro é só código e motivo interno.
 */
export type Resposta =
  | { readonly ok: true; readonly resultado: unknown; readonly maxRssKb: number }
  | { readonly ok: false; readonly codigo: CodigoDoLeitor; readonly detalhe?: DetalheDoErro; readonly maxRssKb: number }
  | { readonly ok: false; readonly infraestrutura: true; readonly maxRssKb: number };

/** Mensagem IPC do filho ao pai quando terminou de carregar e está pronto para receber a operação. */
export const PRONTO = 'pronto';

export const ehOperacao = (valor: unknown): valor is OperacaoDePlanilha => {
  if (typeof valor !== 'object' || valor === null) return false;
  const v = valor as Record<string, unknown>;
  if (v['tipo'] === 'inspecionar') return Object.keys(v).length === 1;
  return v['tipo'] === 'ler-aba' && Object.keys(v).length === 2 && Number.isInteger(v['abaPosicao']) && (v['abaPosicao'] as number) >= 1;
};
