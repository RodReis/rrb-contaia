import { describe, expect, it } from 'vitest';

import { calculatePisCofinsAssessment, type PisCofinsRulePackage } from './calculate-pis-cofins-assessment.js';

const rulePackage: PisCofinsRulePackage = {
  version: 'TEST_ONLY', approved: true, validFrom: '2026-01-01', validThrough: '2026-12-31',
  sourceIds: ['synthetic-fixture'], rounding: 'HALF_UP',
  treatments: [{ code: 'TEST_NORMAL', ncmCodes: ['12345678'], cfops: ['5102'], cstCodes: ['01'],
    pisRateScaled: '1', cofinsRateScaled: '2', sourceIds: ['synthetic-fixture'] }],
};
const revenue = [{ id: 'sale-1', recognizedAt: '2026-03-15', cents: 10_001, ncm: '12345678', cfop: '5102', cst: '01',
  treatmentCode: 'TEST_NORMAL', sourceIds: ['nfe-1'], evidenceComplete: true, postSaleReconciled: true }] as const;
const input = { competence: '2026-03', recognition: 'ACCRUAL' as const, recognitionOptionProven: true, package: rulePackage,
  regimeEligible: true, activityVerified: true, revenueReconciled: true, revenue, transition: { applies: false, notApplicableProven: true,
    approved: true, version: 'TRANSITION_TEST', sourceIds: ['source'], evidenceProven: true,
    totalOffsetCents: 0, offsetOrder: ['PIS_PASEP', 'COFINS'] as const,
    maximumPisOffsetCents: 1_000, maximumCofinsOffsetCents: 1_000 } };

describe('apuração mensal cumulativa PIS/Cofins F37', () => {
  it('calcula PIS/Pasep e Cofins separadamente com centavos inteiros e arredondamento explícito', () => {
    const result = calculatePisCofinsAssessment(input);
    expect(result.status).toBe('READY_FOR_REVIEW');
    expect(result.pisPayableCents).toBe(100);
    expect(result.cofinsPayableCents).toBe(200);
    expect(result.components.map((item) => item.contribution)).toEqual(['PIS_PASEP', 'COFINS']);
  });

  it('mantém tudo indeterminado quando o pacote não cobre a operação ou não está aprovado', () => {
    const unsupported = calculatePisCofinsAssessment({ ...input, revenue: [{ ...revenue[0], ncm: '87654321' }] });
    expect(unsupported.status).toBe('INDETERMINATE');
    expect(unsupported.pisPayableCents).toBeNull();
    expect(unsupported.cofinsPayableCents).toBeNull();
    const unapproved = calculatePisCofinsAssessment({ ...input, package: { ...rulePackage, approved: false } });
    expect(unapproved.gapCodes).toContain('PIS_COFINS_RULE_NOT_APPROVED');
  });

  it('bloqueia opção anual ausente, reconhecimento fora da competência e lacuna de evidência', () => {
    expect(calculatePisCofinsAssessment({ ...input, recognitionOptionProven: false }).gapCodes).toContain('PIS_COFINS_RECOGNITION_OPTION_MISSING');
    expect(calculatePisCofinsAssessment({ ...input, recognition: 'CASH', revenue: [{ ...revenue[0], recognizedAt: '2026-02-28' }] }).status).toBe('INDETERMINATE');
    expect(calculatePisCofinsAssessment({ ...input, revenue: [{ ...revenue[0], evidenceComplete: false }] }).status).toBe('INDETERMINATE');
  });

  it('não presume dispensa nem compensação CBS/IBS sem pacote e prova aprovados', () => {
    const missing = calculatePisCofinsAssessment({ ...input, transition: { applies: true, notApplicableProven: false } });
    expect(missing.status).toBe('INDETERMINATE');
    expect(missing.gapCodes).toContain('PIS_COFINS_TRANSITION_EVIDENCE_MISSING');
    const offset = calculatePisCofinsAssessment({ ...input, transition: { applies: true, notApplicableProven: false,
      approved: true, version: 'TRANSITION_TEST', sourceIds: ['source'], evidenceProven: true,
      totalOffsetCents: 125, offsetOrder: ['PIS_PASEP', 'COFINS'], maximumPisOffsetCents: 75, maximumCofinsOffsetCents: 50 } });
    expect(offset.status).toBe('READY_FOR_REVIEW');
    expect(offset.pisPayableCents).toBe(25);
    expect(offset.cofinsPayableCents).toBe(150);
    expect(offset.unallocatedTransitionOffsetCents).toBe(0);
  });

  it('exige pacote válido por toda a competência e rejeita compensação quando a transição foi declarada não aplicável', () => {
    expect(calculatePisCofinsAssessment({ ...input, package: { ...rulePackage, validThrough: '2026-03-30' } }).gapCodes)
      .toContain('PIS_COFINS_RULE_NOT_APPLICABLE');
    expect(calculatePisCofinsAssessment({ ...input, transition: { ...input.transition, totalOffsetCents: 1 } }).gapCodes)
      .toContain('PIS_COFINS_TRANSITION_OFFSET_INVALID');
  });
});
