import { describe, expect, it } from 'vitest';
import { renderIcmsStDossierPdf } from './icms-st-dossiers-pdf.js';

describe('PDF do dossiê interno ICMS-ST', () => {
  it('gera PDF legível com hash, trilhas e histórico', () => {
    const pdf = renderIcmsStDossierPdf({
      dossierId: 'dossier-1', contractVersion: 'SPEC-035-v1', status: 'PARTIALLY_DECIDED',
      sourceReconstructionPackageId: 'f33-1', sourceLegalAccrualResultId: 'f34-1',
      sourceHashes: { f33: 'b'.repeat(64), f34: 'c'.repeat(64) }, originalPeriod: { start: '2017-01', end: '2017-12' }, referenceDate: '2026-10-24',
      evidenceManifest: [{ id: 'evidence-1', track: 'RESTITUTION', kind: 'Nota', description: 'Documento comprobatório', fileName: 'nota.pdf', contentSha256: 'd'.repeat(64) }],
      regime: 'SIMPLES_NACIONAL', generatedAtUtc: '2026-10-24T00:00:00Z',
      restitution: { status: 'APPROVED', principalCents: 100, legalAccrualsCents: 20, totalCents: 120, reason: 'Revisado', rulePackageSnapshot: { id: 'rule-1', version: 'go-v1', officialBasis: 'Ato oficial, artigo 3', sourceUrl: 'https://example.gov.br/ato', validFrom: '2016-10-01', validThrough: '2018-02-28', sourceSha256: 'e'.repeat(64), conditions: ['Condição 1'] } },
      complement: { status: 'PENDING' },
    }, 'a'.repeat(64), [{ occurred_at: '2026-10-24T00:00:00Z', action: 'APPROVED', track: 'RESTITUTION', actor_id: 'reviewer' }]);

    const text = pdf.toString('latin1');
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('/Type /Catalog');
    expect(text).toContain('Hash canonico SHA-256');
    expect(text).toContain('RESTITUICAO');
    expect(text).toContain('2017-01');
    expect(text).toContain('2026-10-24');
    expect(text).toContain('Hashes de origem F33/F34');
    expect(text).toContain('Ato oficial');
    expect(text).toContain('https://example.gov.br/ato');
    expect(text).toContain('nota.pdf');
    expect(text).toContain('d'.repeat(64));
    expect(text).toContain('Historico append-only');
    expect(text).toContain('%%EOF');
  });
});
