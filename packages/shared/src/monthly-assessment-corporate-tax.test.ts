import { describe, expect, it } from 'vitest';
import { CorporateTaxDeclarationSchema, CorporateTaxRulePackageSchema } from './monthly-assessment.js';

const dueDates = (tax: 'IRPJ' | 'CSLL') => ['2026-Q1','2026-Q2','2026-Q3','2026-Q4'].map((quarter, index) => ({
  quarter, tax, installmentNumber: 1, dueDate: ['2026-04-30','2026-07-31','2026-10-31','2027-01-31'][index]!,
  additionRateScaled: '0', sourceIds: [`official:due:${quarter}:${tax}`],
}));
const rulePackage = () => ({ version: 'fixture-v1', validFrom: '2026-01-01', validThrough: '2026-12-31', consultedAt: '2026-10-27',
  officialBasis: 'Fixture estrutural, sem valor normativo.', sourceUrl: 'https://www.gov.br/receitafederal', rules: [
    { id: 'IRPJ-SALES', tax: 'IRPJ', activityCode: 'AUTO_PARTS', revenueNatureCode: 'SALES', validFrom: '2026-01-01', validThrough: null,
      presumptionRateScaled: '0.08', taxRateScaled: '0.15', taxCode: 'IRPJ', sourceIds: ['official:irpj'] },
    { id: 'CSLL-SALES', tax: 'CSLL', activityCode: 'AUTO_PARTS', revenueNatureCode: 'SALES', validFrom: '2026-01-01', validThrough: null,
      presumptionRateScaled: '0.12', taxRateScaled: '0.09', taxCode: 'CSLL', sourceIds: ['official:csll'] },
  ], deductionRules: [], additionalIrpjRateScaled: '0.10', additionalIrpjThresholdCentsByMonth: 20_000, additionalIrpjRuleId: 'IRPJ-ADICIONAL',
  additionalIrpjSourceIds: ['official:additional'], installmentTerms: { minimumPrincipalCents: 1, maximumInstallments: 1,
    additionRateScaled: '0', dueDates: [...dueDates('IRPJ'), ...dueDates('CSLL')] }, rounding: 'HALF_UP' as const });

describe('contratos da apuração corporativa F38', () => {
  it('exige fontes individuais para regra adicional e cada vencimento por trimestre', () => {
    expect(CorporateTaxRulePackageSchema.safeParse(rulePackage()).success).toBe(true);
    expect(CorporateTaxRulePackageSchema.safeParse({ ...rulePackage(), additionalIrpjSourceIds: [] }).success).toBe(false);
    expect(CorporateTaxRulePackageSchema.safeParse({ ...rulePackage(), installmentTerms: { ...rulePackage().installmentTerms,
      dueDates: dueDates('IRPJ') } }).success).toBe(false);
  });

  it('rejeita faixas de receita sobrepostas para a mesma cobertura', () => {
    const pkg = rulePackage();
    const overlapping = { ...pkg.rules[0]!, id: 'IRPJ-SALES-OVERLAP', revenueMinimumCents: 50, revenueMaximumCents: 150 };
    const ranged = { ...pkg.rules[0]!, revenueMinimumCents: 0, revenueMaximumCents: 100 };
    expect(CorporateTaxRulePackageSchema.safeParse({ ...pkg, rules: [ranged, overlapping, pkg.rules[1]] }).success).toBe(false);
  });

  it('exige base explícita de agregação para faixa normativa de receita', () => {
    const pkg = rulePackage();
    const ranged = { ...pkg.rules[0]!, revenueMinimumCents: 0, revenueMaximumCents: 100 };
    expect(CorporateTaxRulePackageSchema.safeParse({ ...pkg, rules: [ranged, pkg.rules[1]] }).success).toBe(false);
    expect(CorporateTaxRulePackageSchema.safeParse({ ...pkg, rules: [{ ...ranged, revenueBasis: 'QUARTER' }, pkg.rules[1]] }).success).toBe(true);
  });

  it('exige exatamente as regras de IRPJ e CSLL para cada receita declarada', () => {
    const declaration = { quarter: '2026-Q1', recognition: 'ACCRUAL', recognitionOptionValid: true, regimeVerified: true,
      activityVerified: true, revenueReconciled: true, revenue: [{ id: 'r1', activityCode: 'AUTO_PARTS', revenueNatureCode: 'SALES',
        month: '2026-01', grossCents: 100, adjustmentCents: 0, directAdditionCents: 0, lineType: 'FISCAL_ITEM', adjustmentReason: null,
        ruleIds: ['IRPJ-SALES'], sourceIds: ['document:1'] }], deductions: [],
      evidence: [{ kind: 'RECONCILIACAO_RECEITAS', description: 'Conciliação fiscal anexa.', sourceReference: 'book:1', recognizedOn: null, amountCents: null, relatedFiscalSourceIds: [] }],
      justification: 'Conferência estrutural das evidências anexadas.' };
    expect(CorporateTaxDeclarationSchema.safeParse(declaration).success).toBe(false);
    expect(CorporateTaxDeclarationSchema.safeParse({ ...declaration, revenue: [{ ...declaration.revenue[0], ruleIds: ['IRPJ-SALES','CSLL-SALES'] }] }).success).toBe(true);
  });

  it('exige data de reconhecimento de dedução dentro do trimestre civil', () => {
    const declaration = { quarter: '2026-Q1', recognition: 'ACCRUAL', recognitionOptionValid: true, regimeVerified: true,
      activityVerified: true, revenueReconciled: true, revenue: [],
      deductions: [{ tax: 'IRPJ', kind: 'WITHHOLDING', amountCents: 100, evidenceKind: 'RETENCAO_IRPJ', evidenceIndex: 0, ruleId: 'RETENCAO-1' }],
      evidence: [{ kind: 'RETENCAO_IRPJ', description: 'Comprovante fiscal.', sourceReference: 'receipt:1', recognizedOn: '2026-02-15', amountCents: 100 }],
      justification: 'Conferência estrutural das evidências anexadas.' };
    expect(CorporateTaxDeclarationSchema.safeParse(declaration).success).toBe(true);
    expect(CorporateTaxDeclarationSchema.safeParse({ ...declaration,
      evidence: [{ ...declaration.evidence[0], recognizedOn: '2025-12-31' }] }).success).toBe(false);
    expect(CorporateTaxDeclarationSchema.safeParse({ ...declaration,
      evidence: [{ ...declaration.evidence[0], recognizedOn: null }] }).success).toBe(false);
  });
});
