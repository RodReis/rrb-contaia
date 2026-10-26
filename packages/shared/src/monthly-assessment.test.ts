import { describe, expect, it } from 'vitest';

import { MonthlyDeclarationSchema, MonthlyRulePackageSchema } from './monthly-assessment.js';

const bands = Array.from({ length: 6 }, (_, index) => ({ id: `faixa-${index + 1}`, minimumRbt12Cents: index * 100,
  maximumRbt12Cents: index === 5 ? null : (index + 1) * 100 - 1, nominalRateBasisPoints: 0, deductionCents: 0,
  distributionBasisPoints: { TRIBUTO_FONTE: 10_000 } }));
const simplePackage = (brackets = bands) => ({ kind: 'SIMPLES_NACIONAL_DAS', version: 'fonte-2026', validFrom: '2026-09-01', validThrough: null,
  consultedAt: '2026-10-25', officialBasis: 'Pacote sintético de validação estrutural', sourceUrl: 'https://example.org/fonte',
  brackets, segregations: [{ code: 'RECEITA_FONTE', taxParticipationBasisPoints: { TRIBUTO_FONTE: 10_000 } }], rounding: 'HALF_UP' });

describe('contratos de apuração mensal', () => {
  it('exige seis faixas contíguas e cobertura aberta no último intervalo do Anexo I', () => {
    expect(MonthlyRulePackageSchema.safeParse(simplePackage()).success).toBe(true);
    expect(MonthlyRulePackageSchema.safeParse(simplePackage(bands.slice(0, 5))).success).toBe(false);
    const gap = bands.map((item, index) => index === 2 ? { ...item, minimumRbt12Cents: 250 } : item);
    expect(MonthlyRulePackageSchema.safeParse(simplePackage(gap)).success).toBe(false);
  });

  it('exige justificativa e anexo em cada declaração complementar', () => {
    const declaration = { competence: '2026-09', kind: 'SIMPLES_NACIONAL_DAS', declaration: {},
      evidence: [{ kind: 'DOCUMENTO_CONTABIL', description: 'Comprovante contábil anexado.' }] };
    expect(MonthlyDeclarationSchema.safeParse({ ...declaration, justification: 'Conferência conforme o documento anexo.' }).success).toBe(true);
    expect(MonthlyDeclarationSchema.safeParse(declaration).success).toBe(false);
  });

  it('valida pacote cumulativo PIS/Cofins para 2026 sem taxas padrão embutidas', () => {
    const packageInput = { kind: 'LUCRO_PRESUMIDO_PIS_COFINS', version: 'fixture', validFrom: '2026-01-01', validThrough: '2026-12-31',
      consultedAt: '2026-10-26', officialBasis: 'Fixture sintética de contrato.', sourceUrl: 'https://example.org/pis-cofins', rounding: 'HALF_UP',
      treatments: [{ code: 'TEST_ONLY', ncmCodes: ['12345678'], cfops: ['5102'], cstCodes: ['01'], pisRateScaled: '1',
        cofinsRateScaled: '2', sourceIds: ['fixture-source'], requiredEvidenceKinds: ['TEST_TREATMENT_PROOF'] }] };
    expect(MonthlyRulePackageSchema.safeParse(packageInput).success).toBe(true);
    expect(MonthlyRulePackageSchema.safeParse({ ...packageInput, validThrough: '2027-01-01' }).success).toBe(false);
    expect(MonthlyRulePackageSchema.safeParse({ ...packageInput, treatments: [] }).success).toBe(false);
  });

  it('exige limites e evidências no pacote de transição CBS/IBS de 2026', () => {
    const packageInput = { kind: 'PIS_COFINS_TRANSITION_2026', version: 'fixture', validFrom: '2026-01-01', validThrough: '2026-12-31',
      consultedAt: '2026-10-26', officialBasis: 'Fixture sintética de contrato.', sourceUrl: 'https://example.org/transition',
      offsetOrder: ['PIS_PASEP', 'COFINS'], maximumOffsets: { PIS_PASEP: 10_000, COFINS: 100_000 },
      requiredEvidenceKinds: ['RECOLHIMENTO_COMPROVADO'], rounding: 'HALF_UP' };
    expect(MonthlyRulePackageSchema.safeParse(packageInput).success).toBe(true);
    expect(MonthlyRulePackageSchema.safeParse({ ...packageInput, requiredEvidenceKinds: [] }).success).toBe(false);
  });
});
