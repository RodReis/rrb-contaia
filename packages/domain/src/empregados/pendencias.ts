/**
 * Causa de pendência da importação de empregados (SPEC-014 §3.10).
 *
 * Alimenta a mesma reconciliação da Central (SPEC-005): a chave é estável, então reprocessar não
 * duplica e a causa que some é resolvida. Empresa sem nenhum empregado confirmado mantém
 * `empregados:nao-importados` aberta; o primeiro empregado confirmado a resolve.
 */
import type { CausaDaPendencia } from '../pendencias/pendencias.js';

export const CHAVE_DE_PENDENCIA_DE_EMPREGADOS = 'empregados:nao-importados';

export const causasDeEmpregados = (quantidadeConfirmados: number): readonly CausaDaPendencia[] =>
  quantidadeConfirmados > 0
    ? []
    : [
        {
          origem: 'EMPREGADOS',
          tipo: 'EMPREGADOS_NAO_IMPORTADOS',
          chave: CHAVE_DE_PENDENCIA_DE_EMPREGADOS,
          dataLimite: null,
        },
      ];
