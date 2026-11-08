import { describe, expect, it } from 'vitest';
import {
  avaliarAplicabilidadeReferencial,
  hashMapeamentoReferencial,
  resolverDecisaoReferencial,
  validarPublicacaoReferencial,
  type PacoteReferencial,
  type ContaReferencialDaEmpresa,
  type DecisaoReferencial,
  type ReferenciaContabil,
} from './plano-referencial.js';

const packageUnavailable: PacoteReferencial = {
  id: 'ecf-layout-12-2026-09-07', status: 'UNAVAILABLE', calendarYears: [], specialSituations: [],
};

describe('plano referencial contábil — SPEC-047', () => {
  it('mantém exercício sem pacote oficial em INDETERMINATE, sem aproximação', () => {
    expect(avaliarAplicabilidadeReferencial({ regime: 'LUCRO_PRESUMIDO', year: 2025, situation: null, packages: [packageUnavailable] }))
      .toEqual({ status: 'INDETERMINATE', packageId: null });
    expect(avaliarAplicabilidadeReferencial({ regime: 'LUCRO_PRESUMIDO', year: 2026, situation: null, packages: [] }))
      .toEqual({ status: 'INDETERMINATE', packageId: null });
  });

  it('não declara Simples como obrigação e só indica configuração opcional com pacote coberto', () => {
    const pkg: PacoteReferencial = { id: 'pkg-2025', status: 'AVAILABLE', calendarYears: [2025], specialSituations: [] };
    expect(avaliarAplicabilidadeReferencial({ regime: 'SIMPLES_NACIONAL', year: 2025, situation: null, packages: [pkg] }))
      .toEqual({ status: 'OPTIONAL', packageId: 'pkg-2025' });
    expect(avaliarAplicabilidadeReferencial({ regime: 'SIMPLES_NACIONAL', year: 2026, situation: null, packages: [pkg] }))
      .toEqual({ status: 'INDETERMINATE', packageId: null });
  });

  it('exige decisão em toda conta analítica ativa e justificativa revisada em NOT_APPLICABLE', () => {
    const accounts: ContaReferencialDaEmpresa[] = [
      { id: 'a1', active: true, analytical: true, complete: true, normalBalance: 'DEBIT' },
      { id: 'a2', active: true, analytical: true, complete: true, normalBalance: 'CREDIT' },
      { id: 's1', active: true, analytical: false, complete: true, normalBalance: 'DEBIT' },
    ];
    const decisions: DecisaoReferencial[] = [
      { accountId: 'a1', centerId: null, kind: 'MAPPED', referenceCode: '1.01', reason: null, authorId: 'user-1', reviewedBy: null },
      { accountId: 'a2', centerId: null, kind: 'NOT_APPLICABLE', referenceCode: null, reason: 'Conta sem correspondência legal.', authorId: 'user-1', reviewedBy: 'user-2' },
    ];
    const references: ReferenciaContabil[] = [{ code: '1.01', packageId: 'pkg', active: true, normalBalance: 'DEBIT' }];
    expect(validarPublicacaoReferencial({ packageId: 'pkg', accounts, costCenters: [], decisions, references })).toEqual([]);
    expect(validarPublicacaoReferencial({ packageId: 'pkg', accounts, costCenters: [], decisions: decisions.slice(0, 1), references }))
      .toContainEqual({ code: 'REFERENCE_MAPPING_INCOMPLETE', accountId: 'a2', centerId: null });
    expect(validarPublicacaoReferencial({
      packageId: 'pkg', accounts, costCenters: [],
      decisions: [{ ...decisions[1]!, reason: '  ', authorId: null, reviewedBy: null }], references,
    })).toContainEqual({ code: 'REFERENCE_MAPPING_NOT_APPLICABLE_REVIEW_REQUIRED', accountId: 'a2', centerId: null });
  });

  it('rejeita par conta/centro duplicado, referência fora do pacote e natureza divergente', () => {
    const accounts: ContaReferencialDaEmpresa[] = [{ id: 'a1', active: true, analytical: true, complete: true, normalBalance: 'CREDIT' }];
    const centers = [{ id: 'cc1', active: true, analytical: true }];
    const decision: DecisaoReferencial = { accountId: 'a1', centerId: null, kind: 'MAPPED', referenceCode: '1.01', reason: null, authorId: 'user-1', reviewedBy: null };
    const override: DecisaoReferencial = { ...decision, centerId: 'cc1', referenceCode: '2.01' };
    const references: ReferenciaContabil[] = [
      { code: '1.01', packageId: 'pkg', active: true, normalBalance: 'DEBIT' },
      { code: '2.01', packageId: 'other', active: true, normalBalance: 'CREDIT' },
    ];
    const errors = validarPublicacaoReferencial({ packageId: 'pkg', accounts, costCenters: centers, decisions: [decision, override, override], references });
    expect(errors).toContainEqual({ code: 'REFERENCE_ACCOUNT_NATURE_MISMATCH', accountId: 'a1', centerId: null });
    expect(errors).toContainEqual({ code: 'REFERENCE_MAPPING_DUPLICATE_PAIR', accountId: 'a1', centerId: 'cc1' });
    expect(errors).toContainEqual({ code: 'REFERENCE_ACCOUNT_NOT_FOUND', accountId: 'a1', centerId: 'cc1' });
  });

  it('impede exceção por centro inativo, sintético ou ligado a conta sem cobertura', () => {
    const accounts: ContaReferencialDaEmpresa[] = [{ id: 'a1', active: true, analytical: true, complete: true, normalBalance: 'DEBIT' }];
    const centers = [{ id: 'cc1', active: false, analytical: true }];
    const decision: DecisaoReferencial = { accountId: 'missing', centerId: 'cc1', kind: 'MAPPED', referenceCode: '1.01', reason: null, authorId: 'user-1', reviewedBy: null };
    const errors = validarPublicacaoReferencial({ packageId: 'pkg', accounts, costCenters: centers, decisions: [decision], references: [] });
    expect(errors).toContainEqual({ code: 'REFERENCE_MAPPING_ACCOUNT_INELIGIBLE', accountId: 'missing', centerId: 'cc1' });
    expect(errors).toContainEqual({ code: 'REFERENCE_MAPPING_COST_CENTER_INELIGIBLE', accountId: 'missing', centerId: 'cc1' });
  });

  it('resolve exceção por centro sobre o vínculo-base e gera hash independente da ordem', () => {
    const base: DecisaoReferencial = { accountId: 'a1', centerId: null, kind: 'MAPPED', referenceCode: '1.01', reason: null, authorId: 'user-1', reviewedBy: null };
    const override: DecisaoReferencial = { ...base, centerId: 'cc1', referenceCode: '2.01' };
    expect(resolverDecisaoReferencial([base, override], 'a1', 'cc1')).toEqual(override);
    expect(resolverDecisaoReferencial([base, override], 'a1', 'cc2')).toEqual(base);
    const payload = { packageId: 'pkg', packageCanonicalSha256: 'a'.repeat(64), calendarYear: 2025,
      taxRegime: 'LUCRO_PRESUMIDO' as const, specialSituation: null, decisions: [base, override], centerCodes: [{ id: 'cc1', code: 'NORTE' }] };
    expect(hashMapeamentoReferencial(payload)).toBe(hashMapeamentoReferencial({ ...payload, decisions: [override, base], centerCodes: [...payload.centerCodes].reverse() }));
    expect(hashMapeamentoReferencial(payload)).toBe(hashMapeamentoReferencial({ ...payload,
      decisions: payload.decisions.map((item) => ({ ...item, authorId: 'outro-autor', reviewedBy: 'outro-revisor' })) }));
    expect(hashMapeamentoReferencial(payload)).not.toBe(hashMapeamentoReferencial({ ...payload, taxRegime: 'SIMPLES_NACIONAL' }));
    expect(hashMapeamentoReferencial(payload)).toMatch(/^[0-9a-f]{64}$/);
  });
});
