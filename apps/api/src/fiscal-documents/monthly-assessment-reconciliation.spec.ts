import { describe, expect, it } from 'vitest';
import type { PisCofinsRevenue } from '@contaia/domain';
import { postSaleCoverageParameters, reconcilePisCofinsRevenue, reconcileSimpleRevenue } from './monthly-assessments.service';

describe('parâmetros da consulta de cobertura pós-venda', () => {
  it('mantém cinco binds no caminho F36 e sete quando F37 restringe a competência', () => {
    const base: [string, string, string, string, string] = ['tenant', 'company', '2025-09-01', '2026-10-01', '12345678000199'];
    expect(postSaleCoverageParameters(...base, false)).toEqual(base);
    expect(postSaleCoverageParameters(...base, true)).toEqual([...base, '2025-09-01', '2026-10-01']);
  });
});

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

describe('reconciliação PIS/Cofins F37', () => {
  const documents = [{ id: 'nfe-1', hash: 'hash-1', competence: '2026-03', itemNumber: 1, itemCents: 10_000,
    ncm: '12345678', cfop: '5102', cst: '01', isSales: true }];
  const revenue: PisCofinsRevenue[] = [{ id: 'line-1', recognizedAt: '2026-03-15', cents: 10_000, ncm: '12345678', cfop: '5102', cst: '01',
    treatmentCode: 'NORMAL', sourceIds: ['nfe-1:hash-1:item:1'], evidenceComplete: true, postSaleReconciled: true }];
  it('reconcilia por item e exige cobertura integral dos documentos na competência por competência', () => {
    expect(reconcilePisCofinsRevenue(revenue, documents, '2026-03', 'ACCRUAL', true, true)).toEqual([]);
    expect(reconcilePisCofinsRevenue([], documents, '2026-03', 'ACCRUAL', true, true)).toContain('PIS_COFINS_REVENUE_RECONCILIATION_FAILED');
  });

  it('aceita recebimento parcial vinculado a item existente e bloqueia excedente ou fonte ausente', () => {
    const receipt: PisCofinsRevenue[] = [{ ...revenue[0]!, id: 'receipt-1', recognizedAt: '2026-03-28', cents: 4_000 }];
    expect(reconcilePisCofinsRevenue(receipt, documents, '2026-03', 'CASH', true, true)).toEqual([]);
    expect(reconcilePisCofinsRevenue([{ ...receipt[0]!, cents: 10_001 }], documents, '2026-03', 'CASH', true, true))
      .toContain('PIS_COFINS_REVENUE_RECONCILIATION_FAILED');
    expect(reconcilePisCofinsRevenue([{ ...receipt[0]!, sourceIds: ['fake-document'] }], documents, '2026-03', 'CASH', true, true))
      .toContain('PIS_COFINS_EVIDENCE_REQUIRED');
    expect(reconcilePisCofinsRevenue([{ ...receipt[0]!, sourceIds: ['nfe-1:hash-1:item:1', 'nfe-2:hash-2:item:2'] }], [
      ...documents, { ...documents[0]!, id: 'nfe-2', hash: 'hash-2', itemNumber: 2 },
    ], '2026-03', 'CASH', true, true)).toContain('PIS_COFINS_REVENUE_RECONCILIATION_FAILED');
  });
});
