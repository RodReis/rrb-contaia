/**
 * Avaliador tributário determinístico (SPEC-016 §§3.3–3.5, I-3, I-8, I-12).
 */
import { describe, expect, it } from 'vitest';

import { CODIGOS_DE_ERRO, ErroDeDominio } from '../erros.js';
import { evaluateTaxRule, selectApplicableRule } from './evaluate-tax-rule.js';
import type { TaxRule } from './model.js';

const rule = (overrides: Partial<TaxRule> = {}): TaxRule => ({
  id: 'rule-1',
  version: 1,
  status: 'PUBLISHED',
  taxType: 'ICMS',
  regime: 'LUCRO_PRESUMIDO',
  operationType: 'VENDA_MERCADORIA',
  validFrom: '2026-01-01',
  validUntil: null,
  operation: { rateBasisPoints: 1_800 },
  ...overrides,
});

const input = (overrides: Partial<{ baseCents: number; factDate: string }> = {}) => ({
  baseCents: 10_000,
  factDate: '2026-06-15',
  ...overrides,
});

const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (error) {
    return error instanceof ErroDeDominio ? error.codigo : `inesperado: ${String(error)}`;
  }
  return undefined;
};

describe('evaluateTaxRule', () => {
  it('aplica a alíquota sobre a base sem redução e expõe a memória completa', () => {
    const result = evaluateTaxRule(rule(), input());

    expect(result).toEqual({
      ruleId: 'rule-1',
      ruleVersion: 1,
      validFrom: '2026-01-01',
      validUntil: null,
      factDate: '2026-06-15',
      baseCents: 10_000,
      baseReductionBasisPoints: 0,
      reducedBase: { numerator: '10000', denominator: '1' },
      rateBasisPoints: 1_800,
      unrounded: { numerator: '1800', denominator: '1' },
      rounding: 'HALF_UP',
      resultCents: 1_800,
    });
  });

  it('arredonda para cima exatamente na metade do centavo', () => {
    expect(evaluateTaxRule(rule({ operation: { rateBasisPoints: 100 } }), input({ baseCents: 50 })).resultCents).toBe(1);
    expect(evaluateTaxRule(rule({ operation: { rateBasisPoints: 100 } }), input({ baseCents: 49 })).resultCents).toBe(0);
  });

  it('descarta fração abaixo de meio centavo', () => {
    expect(
      evaluateTaxRule(rule({ operation: { rateBasisPoints: 90 } }), input({ baseCents: 10_001 })),
    ).toMatchObject({ resultCents: 90, rounding: 'HALF_UP' });
  });

  it('aplica a redução de base antes da alíquota e guarda as frações exatas', () => {
    const result = evaluateTaxRule(
      rule({ operation: { baseReductionBasisPoints: 3_333, rateBasisPoints: 1_800 } }),
      input(),
    );

    expect(result).toMatchObject({
      baseReductionBasisPoints: 3_333,
      reducedBase: { numerator: '6667', denominator: '1' },
      unrounded: { numerator: '60003', denominator: '50' },
      resultCents: 1_200,
    });
  });

  it('não perde precisão no maior inteiro seguro', () => {
    const base = Number.MAX_SAFE_INTEGER;

    expect(evaluateTaxRule(rule({ operation: { rateBasisPoints: 3_333 } }), input({ baseCents: base })).resultCents).toBe(
      3_002_099_511_605_172,
    );
    expect(
      evaluateTaxRule(rule({ operation: { baseReductionBasisPoints: 2_500, rateBasisPoints: 3_333 } }), input({ baseCents: base }))
        .resultCents,
    ).toBe(2_251_574_633_703_879);
  });

  it('aceita base zero e alíquota zero', () => {
    expect(evaluateTaxRule(rule(), input({ baseCents: 0 })).resultCents).toBe(0);
    expect(evaluateTaxRule(rule({ operation: { rateBasisPoints: 0 } }), input()).resultCents).toBe(0);
  });

  it('reproduz memória e resultado byte a byte para a mesma entrada e versão', () => {
    const first = JSON.stringify(evaluateTaxRule(rule(), input({ baseCents: 12_345 })));
    const second = JSON.stringify(evaluateTaxRule(rule(), input({ baseCents: 12_345 })));

    expect(second).toBe(first);
  });

  it('inclui o primeiro e o último dia da vigência', () => {
    const bounded = rule({ validFrom: '2026-03-01', validUntil: '2026-03-31' });

    expect(evaluateTaxRule(bounded, input({ factDate: '2026-03-01' })).resultCents).toBe(1_800);
    expect(evaluateTaxRule(bounded, input({ factDate: '2026-03-31' })).resultCents).toBe(1_800);
  });

  it('recusa fato gerador fora da vigência, inclusive o dia anterior e o seguinte', () => {
    const bounded = rule({ validFrom: '2026-03-01', validUntil: '2026-03-31' });

    expect(codeOf(() => evaluateTaxRule(bounded, input({ factDate: '2026-02-28' })))).toBe(
      CODIGOS_DE_ERRO.TAX_RULE_NOT_APPLICABLE,
    );
    expect(codeOf(() => evaluateTaxRule(bounded, input({ factDate: '2026-04-01' })))).toBe(
      CODIGOS_DE_ERRO.TAX_RULE_NOT_APPLICABLE,
    );
  });

  it('trata vigência final ausente como intervalo aberto', () => {
    expect(evaluateTaxRule(rule({ validUntil: null }), input({ factDate: '2099-12-31' })).resultCents).toBe(1_800);
  });

  it.each([
    ['base negativa', { baseCents: -1 }],
    ['base fracionária', { baseCents: 10.5 }],
    ['base acima do inteiro seguro', { baseCents: Number.MAX_SAFE_INTEGER + 1 }],
    ['base não numérica', { baseCents: Number.NaN }],
    ['data inexistente', { factDate: '2026-02-30' }],
    ['data fora do formato civil', { factDate: '15/06/2026' }],
  ])('recusa entrada inválida: %s', (_nome, overrides) => {
    expect(codeOf(() => evaluateTaxRule(rule(), input(overrides)))).toBe(CODIGOS_DE_ERRO.TAX_SIMULATION_INVALID_INPUT);
  });

  it.each([
    ['alíquota acima de 100%', { rateBasisPoints: 10_001 }],
    ['alíquota fracionária', { rateBasisPoints: 18.5 }],
    ['alíquota negativa', { rateBasisPoints: -1 }],
    ['redução acima de 100%', { baseReductionBasisPoints: 10_001, rateBasisPoints: 100 }],
    ['redução negativa', { baseReductionBasisPoints: -1, rateBasisPoints: 100 }],
  ])('recusa operação malformada: %s', (_nome, operation) => {
    expect(codeOf(() => evaluateTaxRule(rule({ operation }), input()))).toBe(CODIGOS_DE_ERRO.TAX_SIMULATION_INVALID_INPUT);
  });
});

describe('selectApplicableRule', () => {
  const criteria = {
    taxType: 'ICMS',
    regime: 'LUCRO_PRESUMIDO',
    operationType: 'VENDA_MERCADORIA',
    factDate: '2026-06-15',
  } as const;

  it('escolhe a única regra publicada vigente na data do fato', () => {
    const current = rule({ id: 'atual', validFrom: '2026-01-01', validUntil: '2026-12-31' });

    expect(selectApplicableRule([current], criteria)).toBe(current);
  });

  it('ignora regra futura para fato anterior à sua vigência', () => {
    const past = rule({ id: 'passada', validFrom: '2026-01-01', validUntil: '2026-06-30' });
    const future = rule({ id: 'futura', version: 2, validFrom: '2026-07-01', validUntil: null });

    expect(selectApplicableRule([future, past], criteria)).toBe(past);
    expect(selectApplicableRule([future, past], { ...criteria, factDate: '2026-07-01' })).toBe(future);
  });

  it('ignora rascunho, arquivada e outra identidade de regra', () => {
    const candidates = [
      rule({ id: 'rascunho', status: 'DRAFT' }),
      rule({ id: 'arquivada', status: 'ARCHIVED' }),
      rule({ id: 'outro-tributo', taxType: 'PIS' }),
      rule({ id: 'outro-regime', regime: 'LUCRO_REAL' }),
      rule({ id: 'outra-operacao', operationType: 'SERVICO' }),
    ];

    expect(codeOf(() => selectApplicableRule(candidates, criteria))).toBe(CODIGOS_DE_ERRO.TAX_RULE_NOT_APPLICABLE);
  });

  it('falha sem regra aplicável, sem improvisar cálculo', () => {
    expect(codeOf(() => selectApplicableRule([], criteria))).toBe(CODIGOS_DE_ERRO.TAX_RULE_NOT_APPLICABLE);
  });

  it('trata duas regras aplicáveis como erro de integridade, sem precedência', () => {
    const older = rule({ id: 'antiga', version: 1 });
    const newer = rule({ id: 'nova', version: 2 });

    expect(codeOf(() => selectApplicableRule([older, newer], criteria))).toBe(CODIGOS_DE_ERRO.TAX_RULE_AMBIGUOUS);
    expect(codeOf(() => selectApplicableRule([newer, older], criteria))).toBe(CODIGOS_DE_ERRO.TAX_RULE_AMBIGUOUS);
  });
});
