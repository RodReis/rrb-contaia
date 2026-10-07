/**
 * Estado operacional de uma finalidade por empresa (SPEC-012 §5.2).
 *
 * DF-e e eSocial têm estados independentes; o resumo da empresa usa o pior dos
 * dois. A ordem abaixo vai do melhor ao pior e nunca depende de cor.
 */

export const ESTADOS_DA_FINALIDADE = ['OPERACIONAL', 'NAO_TESTADO', 'SEM_CERTIFICADO', 'FALHA'] as const;

export type EstadoDaFinalidade = (typeof ESTADOS_DA_FINALIDADE)[number];

export const piorEstado = (estados: readonly EstadoDaFinalidade[]): EstadoDaFinalidade => {
  if (estados.length === 0) {
    return 'NAO_TESTADO';
  }

  return estados.reduce((pior, atual) =>
    ESTADOS_DA_FINALIDADE.indexOf(atual) > ESTADOS_DA_FINALIDADE.indexOf(pior) ? atual : pior,
  );
};
