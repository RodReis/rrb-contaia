import { colunaParaLetra, type AbaDaPlanilha, type CelulaDaTabela, type LeituraDaAba, type LinhaDaTabela, type TipoNativoDeCelula } from '@contaia/domain';

import { ErroDePlanilha, corrompido, excedido } from './erros.ts';
import type { Limites } from './limites.ts';
import { ParadaAntecipada } from './xml.ts';

/** Célula como os leitores de formato a entregam (a mescla é decidida no fim, pelos intervalos). */
export interface CelulaLida {
  readonly valorExibido: string;
  readonly tipoNativo: TipoNativoDeCelula;
  readonly formula: boolean;
  readonly dataCivil?: string | undefined;
  /** `covered-table-cell` do ODS: dentro de mescla mesmo sem intervalo declarado. */
  readonly coberta?: boolean;
}

interface Area {
  readonly colunaInicial: number;
  readonly linhaInicial: number;
  readonly colunaFinal: number;
  readonly linhaFinal: number;
}

interface LinhaLida {
  oculta: boolean;
  readonly celulas: Map<number, CelulaLida>;
}

// Custo estimado de uma célula/linha no JSON da saída, além do texto (chaves, booleanos, tipo).
const CUSTO_DA_CELULA = 80;
const CUSTO_DA_LINHA = 40;

/** A célula conta como conteúdo (mesma regra do domínio: texto não-branco ou fórmula). */
export const temConteudo = (celula: CelulaLida): boolean => celula.formula || celula.valorExibido.trim() !== '';

export const ULTIMA_LINHA = 1_048_576;

/**
 * Acumula a aba selecionada de forma esparsa (Map por linha), com os tetos de linhas com conteúdo,
 * células, saída e mesclas. Linha sem nenhuma célula com conteúdo não é guardada nem contada.
 */
export class Coletor {
  readonly #limites: Limites;
  readonly #pararNoPrimeiroConteudo: boolean;
  readonly #linhas = new Map<number, LinhaLida>();
  readonly #mesclas: Area[] = [];
  #celulas = 0;
  #saida = 0;

  constructor(limites: Limites, pararNoPrimeiroConteudo = false) {
    this.#limites = limites;
    this.#pararNoPrimeiroConteudo = pararNoPrimeiroConteudo;
  }

  get temLinhas(): boolean {
    return this.#linhas.size > 0;
  }

  fecharLinha(numero: number, oculta: boolean, celulas: ReadonlyMap<number, CelulaLida>): void {
    let algumConteudo = false;
    for (const celula of celulas.values()) {
      if (temConteudo(celula)) {
        algumConteudo = true;
        break;
      }
    }
    if (!algumConteudo) return;
    if (numero < 1 || numero > ULTIMA_LINHA) throw corrompido('REFERENCIA_INVALIDA');

    let linha = this.#linhas.get(numero);
    if (linha === undefined) {
      if (this.#linhas.size >= this.#limites.linhasComConteudo) throw new ErroDePlanilha('ARQUIVO_ACIMA_DO_LIMITE', 'LINHAS');
      linha = { oculta, celulas: new Map() };
      this.#linhas.set(numero, linha);
      this.#gastar(CUSTO_DA_LINHA);
    }
    linha.oculta ||= oculta;
    for (const [coluna, celula] of celulas) {
      if (coluna > this.#limites.colunas) throw excedido('COLUNAS');
      if (++this.#celulas > this.#limites.celulas) throw excedido('CELULAS');
      this.#gastar(celula.valorExibido.length + CUSTO_DA_CELULA);
      linha.celulas.set(coluna, celula);
    }
    if (this.#pararNoPrimeiroConteudo) throw new ParadaAntecipada();
  }

  mesclar(colunaInicial: number, linhaInicial: number, colunaFinal: number, linhaFinal: number): void {
    const area: Area = {
      colunaInicial: Math.min(colunaInicial, colunaFinal),
      linhaInicial: Math.min(linhaInicial, linhaFinal),
      colunaFinal: Math.min(Math.max(colunaInicial, colunaFinal), this.#limites.colunas),
      linhaFinal: Math.min(Math.max(linhaInicial, linhaFinal), ULTIMA_LINHA),
    };
    if (area.colunaInicial < 1 || area.linhaInicial < 1 || area.colunaInicial > this.#limites.colunas || area.linhaInicial > ULTIMA_LINHA) {
      throw corrompido('REFERENCIA_INVALIDA');
    }
    if (area.colunaInicial === area.colunaFinal && area.linhaInicial === area.linhaFinal) return;
    if (this.#mesclas.length >= this.#limites.mesclas) throw excedido('MESCLAS');
    this.#gastar(CUSTO_DA_CELULA);
    this.#mesclas.push(area);
  }

  #gastar(custo: number): void {
    this.#saida += custo;
    if (this.#saida > this.#limites.bytesDaSaida) throw excedido('SAIDA');
  }

  leitura(formato: 'XLSX' | 'ODS', aba: Omit<AbaDaPlanilha, 'utilizavel'>): LeituraDaAba {
    const numeros = [...this.#linhas.keys()].sort((a, b) => a - b);
    const emMescla = varreduraDeMesclas(this.#mesclas);
    let ocultas = 0;
    const linhas = numeros.map((numero): LinhaDaTabela => {
      const lida = this.#linhas.get(numero) as LinhaLida;
      if (lida.oculta) ocultas += 1;
      const dentro = emMescla(numero);
      const celulas: Record<string, CelulaDaTabela> = {};
      for (const coluna of [...lida.celulas.keys()].sort((a, b) => a - b)) {
        const c = lida.celulas.get(coluna) as CelulaLida;
        celulas[colunaParaLetra(coluna)] = {
          valorExibido: c.valorExibido,
          tipoNativo: c.tipoNativo,
          formula: c.formula,
          mesclada: c.coberta === true || dentro(coluna),
          ...(c.dataCivil === undefined ? {} : { dataCivil: c.dataCivil }),
        };
      }
      return { numero, oculta: lida.oculta, celulas };
    });

    return {
      formato,
      aba: { ...aba, utilizavel: linhas.length > 0 },
      linhas,
      mesclas: this.#mesclas.map((m) => ({
        de: `${colunaParaLetra(m.colunaInicial)}${m.linhaInicial}`,
        ate: `${colunaParaLetra(m.colunaFinal)}${m.linhaFinal}`,
      })),
      totalDeLinhasOcultas: ocultas,
    };
  }
}

/**
 * Pertinência à mescla sem expandir intervalos: as linhas são consultadas em ordem crescente; a cada
 * linha, as mesclas ativas viram uma lista ordenada de faixas de coluna, buscada por bissecção.
 */
const varreduraDeMesclas = (mesclas: readonly Area[]): ((linha: number) => (coluna: number) => boolean) => {
  const porInicio = [...mesclas].sort((a, b) => a.linhaInicial - b.linhaInicial);
  let proxima = 0;
  let ativas: Area[] = [];
  let faixas: (readonly [number, number])[] = [];

  return (linha) => {
    let mudou = false;
    while (proxima < porInicio.length && (porInicio[proxima] as Area).linhaInicial <= linha) {
      ativas.push(porInicio[proxima] as Area);
      proxima += 1;
      mudou = true;
    }
    const antes = ativas.length;
    ativas = ativas.filter((m) => m.linhaFinal >= linha);
    if (mudou || ativas.length !== antes) faixas = unirFaixas(ativas);

    return (coluna) => {
      let baixo = 0;
      let alto = faixas.length - 1;
      while (baixo <= alto) {
        const meio = (baixo + alto) >> 1;
        const [inicio, fim] = faixas[meio] as readonly [number, number];
        if (coluna < inicio) alto = meio - 1;
        else if (coluna > fim) baixo = meio + 1;
        else return true;
      }
      return false;
    };
  };
};

const unirFaixas = (areas: readonly Area[]): (readonly [number, number])[] => {
  const ordenadas = areas.map((a) => [a.colunaInicial, a.colunaFinal] as const).sort((a, b) => a[0] - b[0]);
  const unidas: [number, number][] = [];
  for (const [inicio, fim] of ordenadas) {
    const ultima = unidas[unidas.length - 1];
    if (ultima !== undefined && inicio <= ultima[1] + 1) ultima[1] = Math.max(ultima[1], fim);
    else unidas.push([inicio, fim]);
  }
  return unidas;
};
