import { describe, expect, it } from 'vitest';
import { calculateCorporateTaxAssessment, type CorporateTaxRulePackage } from './calculate-corporate-tax-assessment.js';

const pkg: CorporateTaxRulePackage = {
  version: 'fixture-v1', approved: true, validFrom: '2026-01-01', validThrough: '2026-12-31', sourceIds: ['source:fixture'],
  rules: [
    { id: 'IRPJ-COMERCIO', tax: 'IRPJ', activityCode: 'COMMERCE_AUTO_PARTS', revenueNatureCode: 'SALES', validFrom: '2026-01-01', validThrough: null, presumptionRateScaled: '0.08', taxRateScaled: '0.15', sourceIds: ['source:irpj'] },
    { id: 'CSLL-COMERCIO', tax: 'CSLL', activityCode: 'COMMERCE_AUTO_PARTS', revenueNatureCode: 'SALES', validFrom: '2026-01-01', validThrough: null, presumptionRateScaled: '0.12', taxRateScaled: '0.09', sourceIds: ['source:csll'] },
  ], additionalIrpjRateScaled: '0.10', additionalIrpjThresholdCentsByMonth: 20_000, additionalIrpjRuleId: 'IRPJ-ADICIONAL',
  additionalIrpjSourceIds: ['source:additional'], rounding: 'HALF_UP',
};
const revenue = [{ id: 'line-1', activityCode: 'COMMERCE_AUTO_PARTS', revenueNatureCode: 'SALES', month: '2026-01', grossCents: 1_000_000,
  adjustmentCents: 0, directAdditionCents: 0, lineType: 'FISCAL_ITEM' as const,
  sourceIds: ['document:1','rule:IRPJ-COMERCIO','rule:CSLL-COMERCIO'] }];
const input = (overrides: Partial<Parameters<typeof calculateCorporateTaxAssessment>[0]> = {}) => ({
  quarter: '2026-Q1', recognition: 'ACCRUAL' as const, recognitionOptionValid: true, regimeVerified: true, activityVerified: true,
  revenueReconciled: true, deductionsComplete: true, package: pkg, revenue, deductions: [], ...overrides,
});

describe('calculateCorporateTaxAssessment', () => {
  it('calcula IRPJ, adicional e CSLL em centavos, com arredondamento HALF_UP', () => {
    const result = calculateCorporateTaxAssessment(input());
    expect(result.status).toBe('READY_FOR_REVIEW');
    expect(result.components.map((item) => [item.tax, item.presumedBaseCents, item.grossTaxCents])).toEqual([
      ['IRPJ', 80_000, 12_000], ['CSLL', 120_000, 10_800], ['IRPJ_ADDITIONAL', 20_000, 2_000],
    ]);
    expect(result.irpjPayableCents).toBe(14_000);
    expect(result.csllPayableCents).toBe(10_800);
  });

  it('nunca escolhe silenciosamente uma regra quando há conflito', () => {
    const result = calculateCorporateTaxAssessment(input({ package: { ...pkg, rules: [...pkg.rules, { ...pkg.rules[0]!, id: 'IRPJ-AMBIGUO' }] } }));
    expect(result.status).toBe('INDETERMINATE');
    expect(result.gapCodes).toContain('CORPORATE_TAX_RULE_CONFLICT');
    expect(result.irpjPayableCents).toBeNull();
  });

  it('bloqueia vigência que não cobre o fim do trimestre civil', () => {
    const result = calculateCorporateTaxAssessment(input({ package: { ...pkg, validThrough: '2026-03-30' } }));
    expect(result.status).toBe('INDETERMINATE');
    expect(result.gapCodes).toContain('CORPORATE_TAX_RULE_MISSING');
  });

  it('aplica HALF_UP exato em base de um centavo e limita o adicional por três meses', () => {
    const fractionalPackage = { ...pkg, additionalIrpjThresholdCentsByMonth: 100_000,
      rules: pkg.rules.map((rule) => ({ ...rule, presumptionRateScaled: '0.5', taxRateScaled: '1' })) };
    const fractionalRevenue = [{ ...revenue[0]!, grossCents: 1 }];
    const result = calculateCorporateTaxAssessment(input({ quarter: '2026-Q4', package: fractionalPackage,
      revenue: [{ ...fractionalRevenue[0]!, month: '2026-10' }] }));
    expect(result.status).toBe('READY_FOR_REVIEW');
    expect(result.components.filter((item) => item.tax !== 'IRPJ_ADDITIONAL').map((item) => item.presumedBaseCents)).toEqual([1,1]);
    expect(result.components.some((item) => item.tax === 'IRPJ_ADDITIONAL')).toBe(false);
    expect(result.components[0]?.calculationTrace.rounding).toBe('HALF_UP');
  });

  it('seleciona a faixa pela receita acumulada do trimestre, não por uma linha mensal', () => {
    const rangedPackage = { ...pkg, rules: pkg.rules.map((rule) => ({ ...rule, revenueBasis: 'QUARTER' as const,
      revenueMinimumCents: 0, revenueMaximumCents: 100_000,
      ...(rule.tax === 'IRPJ' ? { id: 'IRPJ-LOW', presumptionRateScaled: '0.08' } : { id: 'CSLL-LOW', presumptionRateScaled: '0.12' }),
    })).concat(pkg.rules.map((rule) => ({ ...rule, revenueBasis: 'QUARTER' as const,
      id: rule.tax === 'IRPJ' ? 'IRPJ-HIGH' : 'CSLL-HIGH', revenueMinimumCents: 100_001, revenueMaximumCents: null,
      presumptionRateScaled: rule.tax === 'IRPJ' ? '0.32' : '0.32',
    }))) };
    const splitRevenue = [
      { ...revenue[0]!, id: 'line-1', month: '2026-01', grossCents: 60_000, sourceIds: ['document:1','rule:IRPJ-HIGH','rule:CSLL-HIGH'] },
      { ...revenue[0]!, id: 'line-2', month: '2026-02', grossCents: 60_000, sourceIds: ['document:2','rule:IRPJ-HIGH','rule:CSLL-HIGH'] },
    ];
    const result = calculateCorporateTaxAssessment(input({ package: rangedPackage, revenue: splitRevenue }));
    expect(result.status).toBe('READY_FOR_REVIEW');
    expect(result.components.filter((item) => item.tax !== 'IRPJ_ADDITIONAL').map((item) => item.presumptionRateScaled)).toEqual(['0.32','0.32']);
  });

  it('aplica adição direta só à base quando origem e classificação da linha estão explícitas', () => {
    const result = calculateCorporateTaxAssessment(input({ revenue: [{ ...revenue[0]!, grossCents: 0, directAdditionCents: 500,
      lineType: 'FINANCIAL_INCOME', sourceIds: ['evidence:bank-proof','rule:IRPJ-COMERCIO','rule:CSLL-COMERCIO'] }] }));
    expect(result.status).toBe('READY_FOR_REVIEW');
    expect(result.components.filter((item) => item.tax !== 'IRPJ_ADDITIONAL').map((item) => [item.presumedBaseCents, item.directAdditionCents]))
      .toEqual([[0,500],[0,500]]);
  });

  it('bloqueia dedução sem fonte vinculada ou comprovante duplicado', () => {
    const noSource = calculateCorporateTaxAssessment(input({ deductionsComplete: false, deductions: [
      { tax: 'IRPJ', kind: 'WITHHOLDING', amountCents: 100, recognizedOn: '2026-02-15', evidenceId: 'evidence-1', ruleId: 'WITHHOLDING-1' },
    ] }));
    expect(noSource.status).toBe('INDETERMINATE');
    expect(noSource.gapCodes).toContain('CORPORATE_TAX_DEDUCTION_INVALID');
    const duplicate = calculateCorporateTaxAssessment(input({ deductions: [
      { tax: 'IRPJ', kind: 'WITHHOLDING', amountCents: 100, recognizedOn: '2026-02-15', evidenceId: 'evidence-1', ruleId: 'WITHHOLDING-1', sourceIds: ['source:1'] },
      { tax: 'IRPJ', kind: 'WITHHOLDING', amountCents: 100, recognizedOn: '2026-02-15', evidenceId: 'evidence-1', ruleId: 'WITHHOLDING-1', sourceIds: ['source:1'] },
    ] }));
    expect(duplicate.status).toBe('INDETERMINATE');
  });

  it('aceita dedução comprovada no trimestre e bloqueia retenção de trimestre anterior', () => {
    const deduction = { tax: 'IRPJ' as const, kind: 'WITHHOLDING' as const, amountCents: 100,
      evidenceId: 'evidence-1', ruleId: 'WITHHOLDING-1', sourceIds: ['source:1'] };
    const currentQuarter = calculateCorporateTaxAssessment(input({ deductions: [{ ...deduction, recognizedOn: '2026-02-15' }] }));
    expect(currentQuarter.status).toBe('READY_FOR_REVIEW');
    const priorQuarter = calculateCorporateTaxAssessment(input({ deductions: [{ ...deduction, recognizedOn: '2025-12-31' }] }));
    expect(priorQuarter.status).toBe('INDETERMINATE');
    expect(priorQuarter.gapCodes).toContain('CORPORATE_TAX_DEDUCTION_INVALID');
  });
});
