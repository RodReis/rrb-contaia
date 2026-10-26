import { describe, expect, it } from 'vitest';
import { calculateMonthlyOwnIcmsAssessment, calculateMonthlySimpleAssessment, type SimpleRulePackage } from './calculate-monthly-assessment.js';

const monthsFor = (competence: string) => {
  const [yearPart, monthPart] = competence.split('-');
  const year = Number(yearPart);
  const month = Number(monthPart);
  return Array.from({ length: 12 }, (_, index) => {
    const offset = year * 12 + month - 1 - 12 + index;
    return { month: `${Math.floor(offset / 12).toString().padStart(4, '0')}-${(offset % 12 + 1).toString().padStart(2, '0')}`, cents: 10_000_000 };
  });
};

// Fixture sintética exclusiva para teste: não representa faixa ou regra vigente.
const simplePackage: SimpleRulePackage = {
  version: 'TEST_ONLY', approved: true, validFrom: '2026-01-01', validThrough: null, sourceIds: ['official-source-test-fixture'], rounding: 'HALF_UP',
  brackets: [{ id: 'TEST_BRACKET', minimumRbt12Cents: 1, maximumRbt12Cents: null, nominalRateBasisPoints: 600,
    deductionCents: 1_000_000, distributionBasisPoints: { IRPJ: 500, CSLL: 500, COFINS: 1_000, PIS: 500, CPP: 4_100, ICMS: 3_400 } }],
  segregations: [{ code: 'NORMAL', taxParticipationBasisPoints: { IRPJ: 10_000, CSLL: 10_000, COFINS: 10_000, PIS: 10_000, CPP: 10_000, ICMS: 10_000 } }],
};

describe('apuração mensal F36', () => {
  it('calcula DAS por alíquota efetiva, faixa e repartição de pacote aprovado', () => {
    const result = calculateMonthlySimpleAssessment({ competence: '2026-09', package: simplePackage,
      rbt12ByMonth: monthsFor('2026-09'), revenue: [{ code: 'NORMAL', cents: 10_000_000, sourceIds: ['document-1'] }],
      revenueReconciled: true, activityVerified: true, optionValid: true });
    expect(result.status).toBe('READY_FOR_REVIEW');
    expect(result.totalCents).toBe(516_666);
    expect(result.components.map((item) => item.code)).toEqual(['NORMAL:IRPJ', 'NORMAL:CSLL', 'NORMAL:COFINS', 'NORMAL:PIS', 'NORMAL:CPP', 'NORMAL:ICMS']);
    expect(result.components.every((item) => item.sourceIds.includes('document-1'))).toBe(true);
  });

  it('bloqueia DAS diante de lacuna de pacote, RBT12 ou segregação', () => {
    const base = { competence: '2026-09', package: simplePackage, rbt12ByMonth: monthsFor('2026-09'),
      revenue: [{ code: 'UNKNOWN', cents: 10_000_000, sourceIds: ['document-1'] }], revenueReconciled: true, activityVerified: true, optionValid: true };
    expect(calculateMonthlySimpleAssessment({ ...base, package: null }).gapCodes).toContain('MONTHLY_ASSESSMENT_RULE_MISSING');
    expect(calculateMonthlySimpleAssessment({ ...base, rbt12ByMonth: monthsFor('2026-09').slice(1) }).gapCodes).toContain('MONTHLY_ASSESSMENT_RBT12_INCOMPLETE');
    expect(calculateMonthlySimpleAssessment(base).status).toBe('INDETERMINATE');
    expect(calculateMonthlySimpleAssessment(base).totalCents).toBeNull();
  });

  it('não calcula DAS sem prova da atividade de revenda de autopeças', () => {
    const result = calculateMonthlySimpleAssessment({ competence: '2026-09', package: simplePackage,
      rbt12ByMonth: monthsFor('2026-09'), revenue: [{ code: 'NORMAL', cents: 100_000, sourceIds: ['document-1'] }],
      revenueReconciled: true, activityVerified: false, optionValid: true });
    expect(result.status).toBe('INDETERMINATE');
    expect(result.gapCodes).toContain('MONTHLY_ASSESSMENT_ACTIVITY_UNPROVEN');
    expect(result.totalCents).toBeNull();
  });

  const icmsPackage = { version: 'TEST_ONLY', approved: true, validFrom: '2026-09-01', validThrough: null,
    sourceIds: ['official-source-test-fixture'], allowedOperations: ['TEST_CFOP'], rounding: 'HALF_UP' as const };

  it('apura ICMS próprio, saldo transportável e DARE prévio sem compensação com outra trilha', () => {
    const result = calculateMonthlyOwnIcmsAssessment({ competence: '2026-09', package: icmsPackage,
      debits: [{ id: 'out-1', cents: 50_000 }], credits: [{ id: 'in-1', cents: 10_000 }],
      estornos: [{ id: 'reversal-1', cents: 2_000, effect: 'INCREASE_DUE' }],
      adjustments: [{ id: 'adjustment-1', cents: 1_000, effect: 'REDUCE_DUE' }],
      priorCreditCents: 5_000, priorCreditProven: true, allOperationsCovered: true });
    expect(result.status).toBe('READY_FOR_REVIEW');
    expect(result.totalCents).toBe(36_000);
    expect(result.components.find((item) => item.code === 'ICMS_SALDO_CREDOR_TRANSPORTAVEL')?.amountCents).toBe(0);
  });

  it('preserva crédito em saldo e bloqueia ausência de crédito anterior comprovado', () => {
    const input = { competence: '2026-09', package: icmsPackage, debits: [{ id: 'out-1', cents: 3_000 }],
      credits: [{ id: 'in-1', cents: 10_000 }], estornos: [], adjustments: [], priorCreditCents: 0,
      priorCreditProven: true, allOperationsCovered: true };
    const result = calculateMonthlyOwnIcmsAssessment(input);
    expect(result.status).toBe('READY_FOR_REVIEW');
    expect(result.totalCents).toBeNull();
    expect(result.components.find((item) => item.code === 'ICMS_SALDO_CREDOR_TRANSPORTAVEL')?.amountCents).toBe(7_000);
    const indeterminate = calculateMonthlyOwnIcmsAssessment({ ...input, priorCreditProven: false });
    expect(indeterminate.status).toBe('INDETERMINATE');
    expect(indeterminate.totalCents).toBeNull();
  });
});
