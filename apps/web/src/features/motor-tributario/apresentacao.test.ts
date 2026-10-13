import { TAX_REGIMES, TAX_RULE_STATUSES, TAX_TYPES } from '@contaia/domain';
import { TAX_OPERATION_TYPES } from '@contaia/shared';
import { describe, expect, it } from 'vitest';

import {
  APRESENTACAO_DO_ESTADO,
  ROTULO_DA_OPERACAO,
  ROTULO_DO_REGIME,
  ROTULO_DO_TRIBUTO,
  formatarDataCivil,
  formatarFracaoExata,
  formatarInstante,
  formatarPercentualDeclarado,
  formatarVigencia,
} from './apresentacao';

describe('rótulos', () => {
  it('todo tributo, regime, operação e estado tem rótulo em PT-BR', () => {
    for (const tributo of TAX_TYPES) {
      expect(ROTULO_DO_TRIBUTO[tributo].length).toBeGreaterThan(0);
    }
    for (const regime of TAX_REGIMES) {
      expect(ROTULO_DO_REGIME[regime].length).toBeGreaterThan(0);
    }
    for (const operacao of TAX_OPERATION_TYPES) {
      expect(ROTULO_DA_OPERACAO[operacao].length).toBeGreaterThan(0);
    }
    for (const estado of TAX_RULE_STATUSES) {
      expect(APRESENTACAO_DO_ESTADO[estado].rotulo.length).toBeGreaterThan(0);
    }
  });

  it('o estado tem texto além da cor e só a versão publicada é conforme', () => {
    expect(APRESENTACAO_DO_ESTADO.PUBLISHED).toEqual({ rotulo: 'Publicada', tom: 'conforme' });
    expect(APRESENTACAO_DO_ESTADO.DRAFT).toEqual({ rotulo: 'Rascunho', tom: 'neutro' });
    expect(APRESENTACAO_DO_ESTADO.ARCHIVED).toEqual({ rotulo: 'Arquivada', tom: 'neutro' });
  });

  it('IBS e CBS distinguem os entes no rótulo', () => {
    expect(ROTULO_DO_TRIBUTO.IBS_UF).toMatch(/Estad/u);
    expect(ROTULO_DO_TRIBUTO.IBS_MUN).toMatch(/Munic/u);
  });
});

describe('formatarDataCivil (I-11: sem passar por Date)', () => {
  it('troca a ordem sem converter fuso', () => {
    expect(formatarDataCivil('2026-06-15')).toBe('15/06/2026');
    expect(formatarDataCivil('2026-01-01')).toBe('01/01/2026');
    expect(formatarDataCivil('2028-02-29')).toBe('29/02/2028');
  });

  it('devolve o texto original quando não é data civil, em vez de inventar uma', () => {
    expect(formatarDataCivil('15/06/2026')).toBe('15/06/2026');
    expect(formatarDataCivil('')).toBe('');
  });
});

describe('formatarInstante (exibição em America/Sao_Paulo)', () => {
  it('converte o instante UTC para o horário de Brasília', () => {
    expect(formatarInstante('2026-09-20T12:00:00.000Z')).toBe('20/09/2026 09:00');
    expect(formatarInstante('2026-09-21T02:30:00.000Z')).toBe('20/09/2026 23:30');
  });
});

describe('formatarVigencia', () => {
  it('intervalo aberto diz que não há fim', () => {
    expect(formatarVigencia('2026-07-01', null)).toBe('A partir de 01/07/2026, sem data final');
  });

  it('intervalo fechado e de um dia só', () => {
    expect(formatarVigencia('2026-01-01', '2026-06-30')).toBe('01/01/2026 a 30/06/2026');
    expect(formatarVigencia('2026-03-01', '2026-03-01')).toBe('Somente em 01/03/2026');
  });
});

describe('formatarFracaoExata (memória de cálculo: decimal exato, sem float)', () => {
  it.each([
    [{ numerator: '60003', denominator: '50' }, '1.200,06'],
    [{ numerator: '10000', denominator: '1' }, '10.000'],
    [{ numerator: '6667', denominator: '1' }, '6.667'],
    [{ numerator: '9', denominator: '1000' }, '0,009'],
    [{ numerator: '1', denominator: '2' }, '0,5'],
    [{ numerator: '0', denominator: '1' }, '0'],
    [{ numerator: '30020995116051723003', denominator: '10000' }, '3.002.099.511.605.172,3003'],
  ])('%j → %s', (fracao, texto) => {
    expect(formatarFracaoExata(fracao)).toBe(texto);
  });

  it('o que não termina em decimal fica como fração, nunca arredondado em silêncio', () => {
    expect(formatarFracaoExata({ numerator: '1', denominator: '3' })).toBe('1/3');
  });
});

describe('formatarPercentualDeclarado (texto do XML, só exibição)', () => {
  it('usa vírgula decimal e mantém as casas do documento', () => {
    expect(formatarPercentualDeclarado('0.9000')).toBe('0,9000%');
    expect(formatarPercentualDeclarado('18.00')).toBe('18,00%');
  });

  it('ausente fica explícito', () => {
    expect(formatarPercentualDeclarado(null)).toBe('não informado');
  });
});
