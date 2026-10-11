import { describe, expect, it } from 'vitest';

import { colunaParaLetra, ehLetraDeColuna, letraParaColuna, ULTIMA_COLUNA } from './colunas.js';

describe('colunaParaLetra / letraParaColuna (A..XFD, base 1)', () => {
  it.each([
    [1, 'A'],
    [2, 'B'],
    [26, 'Z'],
    [27, 'AA'],
    [28, 'AB'],
    [52, 'AZ'],
    [53, 'BA'],
    [702, 'ZZ'],
    [703, 'AAA'],
    [16384, 'XFD'],
  ])('coluna %i é %s', (indice, letra) => {
    expect(colunaParaLetra(indice)).toBe(letra);
    expect(letraParaColuna(letra)).toBe(indice);
  });

  it('a última coluna da planilha é XFD (16.384)', () => {
    expect(ULTIMA_COLUNA).toBe(16384);
  });

  it('ida e volta para todas as colunas possíveis', () => {
    for (let indice = 1; indice <= ULTIMA_COLUNA; indice += 1) {
      expect(letraParaColuna(colunaParaLetra(indice))).toBe(indice);
    }
  });

  it.each([0, -1, 1.5, 16385, Number.NaN, Number.POSITIVE_INFINITY])('recusa o índice %s', (indice) => {
    expect(() => colunaParaLetra(indice)).toThrow(RangeError);
  });

  it.each(['', 'a', 'xfd', 'XFE', 'AAAA', 'A1', ' A', 'Á', 'A B'])('recusa a letra %j', (letra) => {
    expect(() => letraParaColuna(letra)).toThrow(RangeError);
  });
});

describe('ehLetraDeColuna', () => {
  it('aceita só maiúsculas dentro de A..XFD', () => {
    expect(ehLetraDeColuna('A')).toBe(true);
    expect(ehLetraDeColuna('XFD')).toBe(true);
    expect(ehLetraDeColuna('XFE')).toBe(false);
    expect(ehLetraDeColuna('a')).toBe(false);
    expect(ehLetraDeColuna('')).toBe(false);
    expect(ehLetraDeColuna('A1')).toBe(false);
  });
});
