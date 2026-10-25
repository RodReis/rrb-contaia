import { describe, expect, it } from 'vitest';
import { reconcileSimpleRevenue } from './monthly-assessments.service';

const rbt12 = Array.from({ length: 12 }, (_, index) => {
  const date = new Date(Date.UTC(2026, 8 - 12 + index, 1));
  const month = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  return { month, cents: month === '2026-08' ? 500 : 0 };
});

describe('reconciliação da declaração do Simples F36', () => {
  it('usa documentos dos 12 meses no RBT12 e compara receita declarada só com a competência atual', () => {
    const gaps = reconcileSimpleRevenue({
      rbt12ByMonth: rbt12,
      revenue: [{ code: 'ANEXO_I_COMERCIO', cents: 1_000, sourceIds: ['doc-atual:hash-atual'] }],
      optionValid: true,
      revenueReconciled: true,
      activityVerified: true,
      historyComplete: true,
    }, [
      { id: 'doc-anterior', hash: 'hash-anterior', competence: '2026-08', documentTotalCents: 500, isSales: true },
      { id: 'doc-atual', hash: 'hash-atual', competence: '2026-09', documentTotalCents: 1_000, isSales: true },
    ], '2026-09');

    expect(gaps).toEqual([]);
  });

  it('rejeita divergência entre receita declarada e documento da competência', () => {
    const gaps = reconcileSimpleRevenue({
      rbt12ByMonth: rbt12,
      revenue: [{ code: 'ANEXO_I_COMERCIO', cents: 900, sourceIds: ['doc-atual:hash-atual'] }],
      optionValid: true,
      revenueReconciled: true,
      activityVerified: true,
      historyComplete: true,
    }, [
      { id: 'doc-anterior', hash: 'hash-anterior', competence: '2026-08', documentTotalCents: 500, isSales: true },
      { id: 'doc-atual', hash: 'hash-atual', competence: '2026-09', documentTotalCents: 1_000, isSales: true },
    ], '2026-09');

    expect(gaps).toContain('MONTHLY_ASSESSMENT_REVENUE_RECONCILIATION_FAILED');
  });

  it('reconcilia o total da competência sem exigir que cada documento corresponda ao total do segmento', () => {
    const gaps = reconcileSimpleRevenue({
      rbt12ByMonth: rbt12,
      revenue: [{ code: 'ANEXO_I_COMERCIO', cents: 1_000, sourceIds: ['doc-atual-1:hash-1', 'doc-atual-2:hash-2'] }],
      optionValid: true,
      revenueReconciled: true,
      activityVerified: true,
      historyComplete: true,
    }, [
      { id: 'doc-anterior', hash: 'hash-anterior', competence: '2026-08', documentTotalCents: 500, isSales: true },
      { id: 'doc-atual-1', hash: 'hash-1', competence: '2026-09', documentTotalCents: 400, isSales: true },
      { id: 'doc-atual-2', hash: 'hash-2', competence: '2026-09', documentTotalCents: 600, isSales: true },
    ], '2026-09');

    expect(gaps).toEqual([]);
  });
});
