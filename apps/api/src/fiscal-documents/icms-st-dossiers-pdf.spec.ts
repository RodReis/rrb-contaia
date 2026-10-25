import { describe, expect, it } from 'vitest';
import { renderIcmsStDossierPdf } from './icms-st-dossiers-pdf.js';

describe('PDF do dossiê interno ICMS-ST', () => {
  it('gera PDF legível com hash, trilhas e histórico', () => {
    const pdf = renderIcmsStDossierPdf({
      dossierId: 'dossier-1', contractVersion: 'SPEC-035-v1', status: 'PARTIALLY_DECIDED',
      sourceReconstructionPackageId: 'f33-1', sourceLegalAccrualResultId: 'f34-1',
      regime: 'SIMPLES_NACIONAL', generatedAtUtc: '2026-10-24T00:00:00Z',
      restitution: { status: 'APPROVED', principalCents: 100, legalAccrualsCents: 20, totalCents: 120, reason: 'Revisado' },
      complement: { status: 'PENDING' },
    }, 'a'.repeat(64), [{ occurred_at: '2026-10-24T00:00:00Z', action: 'APPROVED', track: 'RESTITUTION', actor_id: 'reviewer' }]);

    const text = pdf.toString('latin1');
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('/Type /Catalog');
    expect(text).toContain('Hash canonico SHA-256');
    expect(text).toContain('RESTITUICAO');
    expect(text).toContain('Historico append-only');
    expect(text).toContain('%%EOF');
  });
});
