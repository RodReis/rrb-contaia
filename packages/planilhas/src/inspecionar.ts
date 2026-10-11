import type { AbaDaPlanilha } from '@contaia/domain';

import { LIMITES, type Limites } from './limites.ts';
import { inspecionarOds } from './ods.ts';
import { abrirPlanilha } from './sniff.ts';
import { inspecionarXlsx } from './xlsx.ts';

export interface Inspecao {
  readonly formato: 'XLSX' | 'ODS';
  readonly abas: AbaDaPlanilha[];
}

/**
 * Abas da planilha (nome, posição base 1, utilizável = tem ao menos uma célula com conteúdo). Síncrono:
 * roda dentro do processo filho (`lerPlanilhaIsolada`); fora dele, só em teste.
 */
export const inspecionarPlanilha = (bytes: Uint8Array, limites: Limites = LIMITES): Inspecao => {
  const { formato, zip } = abrirPlanilha(bytes, limites);
  return { formato, abas: formato === 'XLSX' ? inspecionarXlsx(zip, limites) : inspecionarOds(zip, limites) };
};
