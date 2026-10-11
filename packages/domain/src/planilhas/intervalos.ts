import { ehLetraDeColuna, letraParaColuna } from './colunas.js';
import type { IntervaloMesclado } from './tipos.js';

const FORMA_DA_REFERENCIA = /^([A-Z]{1,3})([0-9]{1,7})$/u;

export interface AreaMesclada {
  readonly colunaInicial: number;
  readonly colunaFinal: number;
  readonly linhaInicial: number;
  readonly linhaFinal: number;
}

const lerReferencia = (referencia: string): Readonly<{ coluna: number; linha: number }> | null => {
  const partes = FORMA_DA_REFERENCIA.exec(referencia);
  const letra = partes?.[1];
  const linha = Number(partes?.[2]);
  if (letra === undefined || !ehLetraDeColuna(letra) || linha < 1) {
    return null;
  }
  return { coluna: letraParaColuna(letra), linha };
};

/**
 * Intervalo mesclado → área normalizada. Referência malformada ou intervalo de uma célula só não
 * é mescla (`null`): o leitor não deve emiti-los, e o domínio não confia nele para decidir rejeição.
 */
export const areaDaMescla = (mescla: IntervaloMesclado): AreaMesclada | null => {
  const de = lerReferencia(mescla.de);
  const ate = lerReferencia(mescla.ate);
  if (de === null || ate === null) {
    return null;
  }

  const area = {
    colunaInicial: Math.min(de.coluna, ate.coluna),
    colunaFinal: Math.max(de.coluna, ate.coluna),
    linhaInicial: Math.min(de.linha, ate.linha),
    linhaFinal: Math.max(de.linha, ate.linha),
  };
  return area.colunaInicial === area.colunaFinal && area.linhaInicial === area.linhaFinal ? null : area;
};
