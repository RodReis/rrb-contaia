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
});
