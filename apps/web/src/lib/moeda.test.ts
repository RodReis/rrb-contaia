import { describe, expect, it } from 'vitest';

import { formatarCentavos, formatarCentesimosDePercentual, paraCentavos, paraCentesimosDePercentual } from './moeda';

describe('formatarCentavos (FRONTEND.md §9: estado em centavos, máscara só na exibição)', () => {
  it.each([
    [0, 'R$ 0,00'],
    [5, 'R$ 0,05'],
    [100, 'R$ 1,00'],
    [123_456, 'R$ 1.234,56'],
    [1_000_000_00, 'R$ 1.000.000,00'],
  ])('%i → %s', (centavos, texto) => {
    expect(formatarCentavos(centavos)).toBe(texto);
  });

  it('mantém o sinal na diferença, sem float', () => {
    expect(formatarCentavos(-5)).toBe('-R$ 0,05');
    expect(formatarCentavos(-123_456)).toBe('-R$ 1.234,56');
  });

  it('é exato no maior inteiro seguro', () => {
    expect(formatarCentavos(Number.MAX_SAFE_INTEGER)).toBe('R$ 90.071.992.547.409,91');
  });

  it('recusa valor que não é inteiro seguro, em vez de exibir lixo', () => {
    expect(() => formatarCentavos(10.5)).toThrow();
    expect(() => formatarCentavos(Number.NaN)).toThrow();
    expect(() => formatarCentavos(Number.MAX_SAFE_INTEGER + 1)).toThrow();
  });
});

describe('paraCentavos (colar valor mascarado funciona)', () => {
  it.each([
    ['12.345,67', 1_234_567],
    ['R$ 12.345,67', 1_234_567],
    ['100', 10_000],
    ['100,5', 10_050],
    ['0,05', 5],
    ['0', 0],
    ['  1.000,00  ', 100_000],
    ['1234,56', 123_456],
  ])('%j → %i', (texto, centavos) => {
    expect(paraCentavos(texto)).toBe(centavos);
  });

  it.each(['', '   ', 'abc', '1,234', '1.23.4', '-5', '1e3', 'R$', '1,', ',5', '10,5,5', '12.34'])(
    'recusa %j',
    (texto) => {
      expect(paraCentavos(texto)).toBeNull();
    },
  );

  it('recusa acima do inteiro seguro', () => {
    expect(paraCentavos('90.071.992.547.409,92')).toBeNull();
    expect(paraCentavos('90.071.992.547.409,91')).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe('percentuais em centésimos de ponto percentual (1550 = 15,50%)', () => {
  it.each([
    [0, '0,00%'],
    [90, '0,90%'],
    [1_800, '18,00%'],
    [1_550, '15,50%'],
    [10_000, '100,00%'],
  ])('%i → %s', (centesimos, texto) => {
    expect(formatarCentesimosDePercentual(centesimos)).toBe(texto);
  });

  it.each([
    ['18', 1_800],
    ['18,5', 1_850],
    ['15,50', 1_550],
    ['0,9', 90],
    ['0,90%', 90],
    ['100', 10_000],
    ['0', 0],
  ])('%j → %i', (texto, centesimos) => {
    expect(paraCentesimosDePercentual(texto)).toBe(centesimos);
  });

  it.each(['', 'abc', '100,01', '101', '-1', '1,234', '1,', ',5', '1.5'])('recusa %j', (texto) => {
    expect(paraCentesimosDePercentual(texto)).toBeNull();
  });
});
