/**
 * Formatação de empregado na tela (PATTERNS.md §3, FRONTEND.md §12): CPF completo com máscara e
 * data civil por texto, sem `Date`.
 */
import { describe, expect, it } from 'vitest';

import { cpfParaExibir, formatarDataCivil, rotuloDoCampo } from './apresentacao';

describe('cpfParaExibir', () => {
  it.each([
    ['52998224725', '529.982.247-25'],
    ['529.982.247-25', '529.982.247-25'],
    ['529982247-25', '529.982.247-25'],
  ])('%s → %s', (entrada, saida) => {
    expect(cpfParaExibir(entrada)).toBe(saida);
  });

  it('o que não tem 11 dígitos aparece como veio no arquivo', () => {
    expect(cpfParaExibir('5299822472x5')).toBe('5299822472x5');
    expect(cpfParaExibir('123')).toBe('123');
  });
});

describe('formatarDataCivil', () => {
  it('troca a ordem sem passar por fuso', () => {
    expect(formatarDataCivil('1990-02-14')).toBe('14/02/1990');
    expect(formatarDataCivil('2024-02-29')).toBe('29/02/2024');
  });

  it('texto fora do formato fica como está', () => {
    expect(formatarDataCivil('31/02/2020')).toBe('31/02/2020');
  });
});

describe('rotuloDoCampo', () => {
  it('nomeia o campo e a linha inteira', () => {
    expect(rotuloDoCampo('data_admissao')).toBe('Data de admissão');
    expect(rotuloDoCampo(null)).toBe('Linha inteira');
  });
});
