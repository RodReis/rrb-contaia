import { describe, expect, it } from 'vitest';

import { resolveEntryTax, statusSubstituicaoTributariaComEvidencia, type CuratedTaxPackage, type EntryTaxFacts } from '../index.js';

const pacote: CuratedTaxPackage = {
  schemaVersion: 1, packageId: 'go-entry', semanticVersion: '1.0.0', jurisdiction: 'GO',
  regimes: ['LUCRO_PRESUMIDO'], document: { model: '55', direction: 'ENTRY', purpose: 'RESALE' },
  validFrom: '2026-01-01', validUntil: null, consultedOn: '2026-09-19', coverage: ['revenda'], exclusions: ['ST'],
  sources: [{ id: 'fonte-1', authority: 'SEFAZ-GO', title: 'Norma', url: 'https://goias.gov.br/economia/', provision: 'art. 1', publishedOn: '2025-01-01', consultedOn: '2026-09-19', validFrom: '2026-01-01', validUntil: null }],
  rules: [{ id: 'icms-go', taxType: 'ICMS', regime: 'LUCRO_PRESUMIDO', operationType: 'COMPRA_INTERNA_REVENDA', cfop: ['1102'], ncm: ['12345678'], cst: ['00'], validFrom: '2026-01-01', validUntil: null, treatment: 'APPLICABLE', creditEligibility: 'ALLOWED', sourceIds: ['fonte-1'], rationale: 'Fixture de teste; não é regra fiscal publicada.' }],
  fixtures: [],
};

describe('fatos fiscais da NF-e', () => {
  it('confirma ST com evidência ICMS_ST e mantém desconhecido sem evidência', () => {
    expect(statusSubstituicaoTributariaComEvidencia([{ codigo: 'ICMS_ST' }])).toBe(true);
    expect(statusSubstituicaoTributariaComEvidencia([{ codigo: 'ICMS' }])).toBeNull();
    expect(statusSubstituicaoTributariaComEvidencia([])).toBeNull();
  });
});

const fatos: EntryTaxFacts = {
  factDate: '2026-09-19', regime: 'LUCRO_PRESUMIDO', originUf: 'GO', destinationUf: 'GO', documentModel: '55',
  authorized: true, operationType: 'COMPRA_INTERNA_REVENDA', purpose: 'RESALE', cfop: '1102', ncm: '12345678', cst: '00',
  hasSubstitutionTax: false, isImport: false, isMonophase: false, hasUnmodeledBenefit: false, isReturnOrTransfer: false,
  declaredCents: 1200,
};

describe('resolveEntryTax', () => {
  it('seleciona regra única e preserva valor declarado como evidência', () => {
    const result = resolveEntryTax(pacote, fatos, 'ICMS', 'a'.repeat(64));
    expect(result.status).toBe('APPLICABLE');
    expect(result.declaredCents).toBe(1200);
    expect(result.packageHash).toBe('a'.repeat(64));
  });

  it('abstém para ST e para lacuna de cobertura', () => {
    expect(resolveEntryTax(pacote, { ...fatos, hasSubstitutionTax: true }, 'ICMS', 'a'.repeat(64)).reasonCodes).toContain('SUBSTITUTION_TAX_OUTSIDE_COVERAGE');
    expect(resolveEntryTax(pacote, fatos, 'PIS', 'a'.repeat(64)).reasonCodes).toContain('NO_APPLICABLE_RULE');
  });

  it('abstém quando o regime histórico ou a finalidade não estão disponíveis', () => {
    const result = resolveEntryTax(pacote,{ ...fatos,regime:null,purpose:null },'ICMS','a'.repeat(64));
    expect(result.status).toBe('INDETERMINATE');
    expect(result.reasonCodes).toContain('REGIME_HISTORY_UNAVAILABLE');
    expect(result.reasonCodes).toContain('PURPOSE_MISSING');
  });

  it('bloqueia colisão entre regras coincidentes', () => {
    const duplicada = { ...pacote, rules: [...pacote.rules, { ...pacote.rules[0]!, id: 'icms-go-2' }] };
    expect(resolveEntryTax(duplicada, fatos, 'ICMS', 'a'.repeat(64)).reasonCodes).toEqual(['AMBIGUOUS_RULES']);
  });

  it('abstém quando operação e exceções não foram observadas', () => {
    const result = resolveEntryTax(pacote, {
      ...fatos, operationType: null, hasSubstitutionTax: null, isImport: null,
      isMonophase: null, hasUnmodeledBenefit: null, isReturnOrTransfer: null,
    }, 'ICMS', 'a'.repeat(64));
    expect(result.status).toBe('INDETERMINATE');
    expect(result.reasonCodes).toEqual(expect.arrayContaining([
      'OPERATION_TYPE_UNAVAILABLE', 'SUBSTITUTION_TAX_STATUS_UNAVAILABLE',
      'IMPORT_STATUS_UNAVAILABLE', 'MONOPHASE_STATUS_UNAVAILABLE',
      'BENEFIT_STATUS_UNAVAILABLE', 'RETURN_TRANSFER_STATUS_UNAVAILABLE',
    ]));
  });

  it('usa operationType recebido; não deduz operação pela UF', () => {
    const result = resolveEntryTax(pacote, { ...fatos, operationType: 'COMPRA_INTERESTADUAL_REVENDA' }, 'ICMS', 'a'.repeat(64));
    expect(result.status).toBe('INDETERMINATE');
    expect(result.reasonCodes).toContain('NO_APPLICABLE_RULE');
  });

  it('distingue regime histórico não coberto de regime ausente', () => {
    const result = resolveEntryTax(pacote, { ...fatos, regime: 'LUCRO_REAL' }, 'ICMS', 'a'.repeat(64));
    expect(result.status).toBe('INDETERMINATE');
    expect(result.reasonCodes).toContain('TAX_REGIME_UNSUPPORTED');
    expect(result.reasonCodes).not.toContain('REGIME_HISTORY_UNAVAILABLE');
  });
});
