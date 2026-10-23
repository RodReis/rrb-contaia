import { describe, expect, it } from 'vitest';
import { buildHistoricalIcmsStPackage } from '@contaia/domain';
import { renderHistoricalIcmsStPdf } from './icms-st-history-pdf';

describe('renderHistoricalIcmsStPdf', () => {
  it('preserva todas as linhas em páginas sucessivas', () => {
    const lines = Array.from({ length: 60 }, (_, indice) => ({
      id: `line-${indice}`,
      documentId: `document-${indice}`,
      itemId: String(indice + 1),
      documentSha256: 'a'.repeat(64),
      documentDate: '2017-01-15',
      documentModel: '55' as const,
      accessKey: String(indice).padStart(44, '1'),
      productCode: `SKU-${indice}`,
      competence: '2017-01-01',
      differenceKind: 'RESTITUTION' as const,
      restitutionCents: 100,
      complementCents: 0,
      sourceIds: [`source-${indice}`],
      memory: { ruleId: 'GO-FIXTURE', formulaVersion: 'F29-FIXTURE', inputSha256: 'b'.repeat(64) },
      efdRecordCode: null,
    }));
    const pkg = buildHistoricalIcmsStPackage({
      companyId: 'company-1',
      regime: 'SIMPLES_NACIONAL',
      periodStart: '2017-01',
      periodEnd: '2017-01',
      snapshots: [{
        id: 'snapshot-1', revision: 1, competence: '2017-01-01', regime: 'SIMPLES_NACIONAL', status: 'APPROVED',
        stale: false, superseded: false, possibleOutdated: false, grossRestitutionCents: 6_000, grossComplementCents: 0, lines,
      }],
      reversals: [],
    });

    const pdf = renderHistoricalIcmsStPdf(pkg, 'c'.repeat(64)).toString('latin1');

    expect(pdf).toContain('/Count 2');
    expect(pdf).toContain('(2017-01 | APPROVED_SETTLEMENT | document-0 | item 1 | rest 100 | comp 0) Tj');
    expect(pdf).toContain('(2017-01 | APPROVED_SETTLEMENT | document-59 | item 60 | rest 100 | comp 0) Tj');
    expect(pdf).toContain('%%EOF');
  });
});
