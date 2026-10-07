/**
 * Catálogo fechado de finalidades do Signer (SPEC-012 §3.3).
 *
 * Só existem as duas finalidades de teste. Adicionar uma exige decisão do PI:
 * cada finalidade carrega adaptador, destino local e estado de diagnóstico
 * próprios, e o chamador nunca informa protocolo, host, porta ou algoritmo.
 */
export const FINALIDADES = ['DFE_TESTE', 'ESOCIAL_TESTE'] as const;

export type Finalidade = (typeof FINALIDADES)[number];

export const ehFinalidade = (valor: unknown): valor is Finalidade =>
  typeof valor === 'string' && (FINALIDADES as readonly string[]).includes(valor);
