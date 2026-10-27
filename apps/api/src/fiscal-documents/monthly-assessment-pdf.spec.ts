import { describe, expect, it } from 'vitest';
import { renderMonthlyDarfDraftPdf } from './monthly-assessment-pdf';

describe('rascunhos locais de DARF F37', () => {
  const assessment = {
    assessmentId: 'assessment-1', competence: '2026-03', kind: 'LUCRO_PRESUMIDO_PIS_COFINS', status: 'APPROVED',
    pisPayableCents: 60, cofinsPayableCents: 300, canonicalJsonHash: 'a'.repeat(64),
    components: [
      { contribution: 'PIS_PASEP', code: 'PIS:NORMAL', amountCents: 60, sourceIds: ['doc:1'] },
      { contribution: 'COFINS', code: 'COFINS:NORMAL', amountCents: 300, sourceIds: ['doc:1'] },
    ], gapCodes: [],
  };

  it('gera PDF PIS sem Cofins, linha digitável ou identificador pagável', () => {
    const pdf = renderMonthlyDarfDraftPdf(assessment, 'PIS_PASEP').toString('latin1');
    expect(pdf).toContain('Rascunho local de DARF PIS_PASEP');
    expect(pdf).toContain('Valor preliminar 60 centavos');
    expect(pdf).not.toContain('COFINS:NORMAL');
    expect(pdf).not.toMatch(/codigo de barras|linha digitavel|autenticacao|pagavel\s*:/iu);
  });

  it('gera PDF Cofins separado do PIS', () => {
    const pdf = renderMonthlyDarfDraftPdf(assessment, 'COFINS').toString('latin1');
    expect(pdf).toContain('Rascunho local de DARF COFINS');
    expect(pdf).toContain('Valor preliminar 300 centavos');
    expect(pdf).not.toContain('PIS:NORMAL');
  });
});
