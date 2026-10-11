import type { LeituraDaAba } from '@contaia/domain';

import { ErroDePlanilha } from './erros.ts';
import { LIMITES, type Limites } from './limites.ts';
import { lerAbaDoOds } from './ods.ts';
import { abrirPlanilha } from './sniff.ts';
import { lerAbaDoXlsx } from './xlsx.ts';

/**
 * Lê só a aba escolhida (posição base 1): células materializadas de forma esparsa, só linhas com
 * conteúdo, mesclas como intervalos. Síncrono: roda dentro do processo filho (`lerPlanilhaIsolada`).
 */
export const lerAba = (bytes: Uint8Array, abaPosicao: number, limites: Limites = LIMITES): LeituraDaAba => {
  if (!Number.isInteger(abaPosicao) || abaPosicao < 1) throw new ErroDePlanilha('ABA_INEXISTENTE', 'ABA');
  const { formato, zip } = abrirPlanilha(bytes, limites);
  return formato === 'XLSX' ? lerAbaDoXlsx(zip, abaPosicao, limites) : lerAbaDoOds(zip, abaPosicao, limites);
};
