import { describe, expect, it } from 'vitest';
import { buildHistoricalIcmsStPackage, type HistoricalIcmsStSourceSnapshot } from './build-icms-st-history.js';

const memory = { ruleId: 'rule-1', formulaVersion: 'F29-v1', inputSha256: 'a'.repeat(64) };
const snapshot = (overrides: Partial<HistoricalIcmsStSourceSnapshot> = {}): HistoricalIcmsStSourceSnapshot => ({
  id: 'snapshot-2017-01', revision: 1, competence: '2017-01-01', regime: 'SIMPLES_NACIONAL', status: 'APPROVED',
  stale: false, superseded: false, possibleOutdated: false, grossRestitutionCents: 1_000, grossComplementCents: 0,
  lines: [{ id: 'line-1', documentId: 'doc-1', itemId: 'item-1', documentSha256: 'c'.repeat(64), documentDate: '2017-01-15', documentModel: '55', accessKey: '1'.repeat(44),
    productCode: 'SKU-1', competence: '2017-01-01', differenceKind: 'RESTITUTION', restitutionCents: 1_000,
    complementCents: 0, sourceIds: ['entrada-1'], memory, efdRecordCode: null }],
  ...overrides,
});

describe('buildHistoricalIcmsStPackage', () => {
  it('soma principal e estornos em centavos e conserva os valores brutos separados', () => {
    const result = buildHistoricalIcmsStPackage({ companyId: 'company-1', regime: 'SIMPLES_NACIONAL',
      periodStart: '2017-01', periodEnd: '2017-02', snapshots: [snapshot(), snapshot({ id: 'snapshot-2017-02',
        competence: '2017-02-01', grossRestitutionCents: 0, grossComplementCents: 700,
        lines: [{ ...snapshot().lines[0]!, id: 'line-2', competence: '2017-02-01', differenceKind: 'COMPLEMENT', restitutionCents: 0,
          complementCents: 700 }] })], reversals: [{ id: 'return-1', competence: '2017-02-01', originalLineId: 'line-1',
        eventDate: '2017-02-03', reversedRestitutionCents: 200, reversedComplementCents: 100, evidenceSha256: 'b'.repeat(64),
        reviewApproved: true, c002SnapshotApproved: true, c002SnapshotId: 'c002-1', sourceIds: ['event-1'], memory,
        originalSnapshotId: 'snapshot-2017-01', originalLineVerified: true, c002SnapshotStale: false }],
    });

    expect(result).toMatchObject({ grossRestitutionCents: 1_000, grossComplementCents: 700, reversedRestitutionCents: 200,
      reversedComplementCents: 100, netRestitutionPrincipalCents: 800, netComplementPrincipalCents: 600,
      netPrincipalBalanceCents: 200, status: 'BLOQUEADO_POR_ACRESCIMOS_LEGAIS', periodComplete: true });
    expect(result.excludedCompetences).toEqual([]);
    expect(result.lines.map((line) => line.sourceKind)).toEqual(['APPROVED_SETTLEMENT', 'APPROVED_RETURN_REVERSAL', 'APPROVED_SETTLEMENT']);
    expect(result.regimeOutput).toMatchObject({ kind: 'SIMPLES_NACIONAL', carriedBalanceCents: null,
      possibleDestinations: ['SALDO_TRANSPORTADO', 'RESSARCIMENTO_AO_SUBSTITUTO', 'COMPENSACAO_NO_DAS', 'PEDIDO_DE_RESTITUICAO'] });
  });

  it('exclui revisão rejeitada, pendente, obsoleta, substituída e sem memória causal', () => {
    const result = buildHistoricalIcmsStPackage({ companyId: 'company-1', regime: 'LUCRO_PRESUMIDO', periodStart: '2017-01',
      periodEnd: '2017-01', snapshots: [snapshot({ regime: 'LUCRO_PRESUMIDO', status: 'PENDING_REVIEW' }), snapshot({ id: 'stale', regime: 'LUCRO_PRESUMIDO', stale: true }),
        snapshot({ id: 'superseded', regime: 'LUCRO_PRESUMIDO', superseded: true }), snapshot({ id: 'missing-memory', regime: 'LUCRO_PRESUMIDO', lines: [{ ...snapshot().lines[0]!, memory: null }] })],
      reversals: [{ id: 'unapproved-return', competence: '2017-01-01', originalLineId: 'line-1', eventDate: '2017-01-03',
        reversedRestitutionCents: 500, reversedComplementCents: 0, evidenceSha256: 'b'.repeat(64), c002SnapshotId: 'c002-1', sourceIds: ['event-1'], reviewApproved: false,
        c002SnapshotApproved: false, memory, originalSnapshotId: 'snapshot-2017-01', originalLineVerified: true, c002SnapshotStale: false }],
    });

    expect(result.lines).toEqual([]);
    expect(result.periodComplete).toBe(false);
    expect(result.excludedCompetences).toEqual([{ competence: '2017-01', reasonCodes: ['SOURCE_MEMORY_MISSING'] }]);
    expect(result.grossRestitutionCents).toBe(0);
    expect(result.regimeOutput).toMatchObject({ kind: 'LUCRO_PRESUMIDO', efdAdjustmentDrafts: [] });
  });

  it('inclui apenas a revisão aprovada vigente de cada competência', () => {
    const old = snapshot({ revision: 1 });
    const current = snapshot({ id: 'snapshot-new', revision: 3, grossRestitutionCents: 2_000,
      lines: [{ ...snapshot().lines[0]!, id: 'line-current', restitutionCents: 2_000 }] });
    const result = buildHistoricalIcmsStPackage({ companyId: 'company-1', regime: 'SIMPLES_NACIONAL', periodStart: '2017-01',
      periodEnd: '2017-01', snapshots: [current, old], reversals: [] });

    expect(result.grossRestitutionCents).toBe(2_000);
    expect(result.sourceRevisionIds).toEqual(['snapshot-new']);
  });

  it('mantém última revisão aprovada quando uma revisão posterior foi rejeitada', () => {
    const approved = snapshot({ id: 'approved', revision: 2, lines: [{ ...snapshot().lines[0]!, sourceIds: ['entrada-1'] }] });
    const rejected = snapshot({ id: 'rejected', revision: 3, status: 'REJECTED', grossRestitutionCents: 9_000 });
    const result = buildHistoricalIcmsStPackage({ companyId: 'company-1', regime: 'SIMPLES_NACIONAL', periodStart: '2017-01',
      periodEnd: '2017-01', snapshots: [rejected, approved], reversals: [] });
    expect(result.grossRestitutionCents).toBe(1_000);
    expect(result.sourceRevisionIds).toEqual(['approved']);
  });

  it('rejeita dinheiro fora do intervalo inteiro seguro e hashes inválidos', () => {
    expect(() => buildHistoricalIcmsStPackage({ companyId: 'company-1', regime: 'SIMPLES_NACIONAL', periodStart: '2017-01',
      periodEnd: '2017-01', snapshots: [snapshot({ grossRestitutionCents: Number.MAX_SAFE_INTEGER + 1 })], reversals: [] })).toThrow();
    const incomplete = buildHistoricalIcmsStPackage({ companyId: 'company-1', regime: 'SIMPLES_NACIONAL', periodStart: '2017-01',
      periodEnd: '2017-01', snapshots: [snapshot({ lines: [{ ...snapshot().lines[0]!, accessKey: 'bad' }] })], reversals: [] });
    expect(incomplete.lines).toEqual([]);
    expect(incomplete.excludedCompetences[0]?.reasonCodes).toEqual(['SOURCE_MEMORY_MISSING']);
  });

  it('produz o mesmo JSON canônico para a mesma seleção em qualquer ordem de entrada', () => {
    const first = snapshot();
    const second = snapshot({ id: 'snapshot-2017-02', competence: '2017-02-01' });
    const build = (snapshots: readonly HistoricalIcmsStSourceSnapshot[]) => buildHistoricalIcmsStPackage({ companyId: 'company-1',
      regime: 'SIMPLES_NACIONAL', periodStart: '2017-01', periodEnd: '2017-02', snapshots, reversals: [] }).canonicalJson;

    expect(build([first, second])).toBe(build([second, first]));
  });

  it('inclui estorno na competência do evento mesmo quando a origem fica fora do período', () => {
    const result = buildHistoricalIcmsStPackage({ companyId: 'company-1', regime: 'SIMPLES_NACIONAL', periodStart: '2017-02',
      periodEnd: '2017-02', snapshots: [], reversals: [{ id: 'return-1', competence: '2017-02-01', originalLineId: 'line-1',
        eventDate: '2017-02-03', reversedRestitutionCents: 200, reversedComplementCents: 0, evidenceSha256: 'b'.repeat(64),
        reviewApproved: true, c002SnapshotApproved: true, c002SnapshotId: 'c002-1', sourceIds: ['event-1'], memory,
        originalSnapshotId: 'snapshot-2017-01', originalLineVerified: true, c002SnapshotStale: false }] });

    expect(result).toMatchObject({ grossRestitutionCents: 0, reversedRestitutionCents: 200, netRestitutionPrincipalCents: -200,
      periodComplete: true, excludedCompetences: [] });
    expect(result.sourceRevisionIds).toEqual(['c002-1', 'snapshot-2017-01']);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]?.sourceKind).toBe('APPROVED_RETURN_REVERSAL');
  });

  it('não usa estorno com snapshot C002 obsoleto', () => {
    const result = buildHistoricalIcmsStPackage({ companyId: 'company-1', regime: 'SIMPLES_NACIONAL', periodStart: '2017-02',
      periodEnd: '2017-02', snapshots: [], reversals: [{ id: 'return-1', competence: '2017-02-01', originalLineId: 'line-1',
        eventDate: '2017-02-03', reversedRestitutionCents: 200, reversedComplementCents: 0, evidenceSha256: 'b'.repeat(64),
        reviewApproved: true, c002SnapshotApproved: true, c002SnapshotId: 'c002-1', sourceIds: ['event-1'], memory,
        originalSnapshotId: 'snapshot-2017-01', originalLineVerified: true, c002SnapshotStale: true }] });

    expect(result.reversedRestitutionCents).toBe(0);
    expect(result.unresolvedEvidence[0]?.sourceKind).toBe('UNREVIEWED_RETURN');
  });
});
