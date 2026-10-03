import { describe, expect, it } from 'vitest';

import {
  diasParaVencer,
  estadoDeValidade,
  estadoNoCofre,
  marcoDeVencimentoAtual,
} from './estado.js';

describe('diasParaVencer', () => {
  it('conta dias corridos entre datas civis', () => {
    expect(diasParaVencer('2026-10-31', '2026-10-01')).toBe(30);
    expect(diasParaVencer('2026-10-01', '2026-10-01')).toBe(0);
    expect(diasParaVencer('2026-09-30', '2026-10-01')).toBe(-1);
  });

  it('atravessa virada de mês, ano e bissexto sem erro de fuso', () => {
    expect(diasParaVencer('2027-01-01', '2026-12-31')).toBe(1);
    expect(diasParaVencer('2028-03-01', '2028-02-28')).toBe(2);
  });
});

describe('marcoDeVencimentoAtual', () => {
  const hoje = '2026-10-01';

  it.each([
    ['2027-01-01', null],
    ['2026-11-01', null],
    ['2026-10-31', 'D30'],
    ['2026-10-30', 'D30'],
    ['2026-10-17', 'D30'],
    ['2026-10-16', 'D15'],
    ['2026-10-09', 'D15'],
    ['2026-10-08', 'D7'],
    ['2026-10-01', 'D7'],
    ['2026-09-30', 'VENCIDO'],
    ['2020-01-01', 'VENCIDO'],
  ])('validoAte %s → %s', (validoAte, esperado) => {
    expect(marcoDeVencimentoAtual(validoAte, hoje)).toBe(esperado);
  });
});

describe('estadoDeValidade', () => {
  it('antes de D-30 é válido; depois, o estado acompanha o marco', () => {
    expect(estadoDeValidade('2027-01-01', '2026-10-01')).toBe('VALIDO');
    expect(estadoDeValidade('2026-10-30', '2026-10-01')).toBe('VENCE_D30');
    expect(estadoDeValidade('2026-10-16', '2026-10-01')).toBe('VENCE_D15');
    expect(estadoDeValidade('2026-10-08', '2026-10-01')).toBe('VENCE_D7');
    expect(estadoDeValidade('2026-09-30', '2026-10-01')).toBe('VENCIDO');
  });
});

describe('estadoNoCofre', () => {
  it('com vigente, o estado vem da validade', () => {
    expect(
      estadoNoCofre({ vigente: { validoAte: '2027-05-01' }, temHistorico: true }, '2026-10-01'),
    ).toBe('VALIDO');
  });

  it('sem vigente e sem histórico, não há certificado', () => {
    expect(estadoNoCofre({ vigente: null, temHistorico: false }, '2026-10-01')).toBe(
      'SEM_CERTIFICADO',
    );
  });

  it('sem vigente e com histórico, foi desativado', () => {
    expect(estadoNoCofre({ vigente: null, temHistorico: true }, '2026-10-01')).toBe('DESATIVADO');
  });
});
