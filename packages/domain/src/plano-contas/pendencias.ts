/**
 * Causa de pendência do plano de contas (SPEC-013 §3.10).
 *
 * Alimenta a mesma reconciliação da Central (SPEC-005): a chave é estável, então
 * reprocessar não duplica e a causa que some é resolvida. Empresa sem nenhuma conta
 * válida mantém `plano-contas:incompleto` aberta; a primeira conta válida a resolve.
 * `hoje` entra por parâmetro como nas demais causas (a pendência não tem prazo).
 */
import type { CausaDaPendencia } from '../pendencias/pendencias.js';

export const CHAVE_DE_PENDENCIA_DO_PLANO_DE_CONTAS = 'plano-contas:incompleto';

export const causasDoPlanoDeContas = (
  entrada: Readonly<{
    temContaValida: boolean;
    /** yyyy-mm-dd, injetado. */
    hoje: string;
  }>,
): readonly CausaDaPendencia[] => {
  if (entrada.temContaValida) {
    return [];
  }

  return [
    {
      origem: 'PLANO_CONTAS',
      tipo: 'PLANO_CONTAS_INCOMPLETO',
      chave: CHAVE_DE_PENDENCIA_DO_PLANO_DE_CONTAS,
      dataLimite: null,
    },
  ];
};
