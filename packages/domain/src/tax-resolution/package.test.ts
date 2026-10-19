import { describe, expect, it } from 'vitest';

import { hashTaxPackage, validateTaxPackage, type CuratedTaxPackage } from '../index.js';

const pkg: CuratedTaxPackage = {
  schemaVersion: 1, packageId: 'go-entry', semanticVersion: '1.0.0', jurisdiction: 'GO', regimes: ['LUCRO_PRESUMIDO'],
  document: { model: '55', direction: 'ENTRY', purpose: 'RESALE' }, validFrom: '2026-01-01', validUntil: null,
  consultedOn: '2026-09-19', coverage: ['revenda'], exclusions: ['ST'],
  sources: [{ id: 'src', authority: 'SEFAZ-GO', title: 'Norma', url: 'https://goias.gov.br/economia/', provision: 'art. 1', publishedOn: '2025-01-01', consultedOn: '2026-09-19', validFrom: '2026-01-01', validUntil: null }],
  rules: [{ id: 'r1', taxType: 'ICMS', regime: 'LUCRO_PRESUMIDO', operationType: 'COMPRA_INTERNA_REVENDA', cfop: ['1102'], ncm: ['12345678'], cst: ['00'], validFrom: '2026-01-01', validUntil: null, treatment: 'APPLICABLE', creditEligibility: 'ALLOWED', sourceIds: ['src'], rationale: 'Regra de fixture; não publicada.' }],
  fixtures: [],
};

describe('pacote tributário curado', () => {
  it('valida estrutura normativa e gera hash estável da forma canônica', async () => {
    expect(validateTaxPackage(pkg)).toEqual({ valid: true, errors: [] });
    expect(await hashTaxPackage(pkg)).toMatch(/^[0-9a-f]{64}$/u);
    expect(await hashTaxPackage(pkg)).toBe(await hashTaxPackage(pkg));
    const reordered: CuratedTaxPackage = {
      fixtures: pkg.fixtures, rules: pkg.rules, sources: pkg.sources, exclusions: pkg.exclusions,
      coverage: pkg.coverage, consultedOn: pkg.consultedOn, validUntil: pkg.validUntil, validFrom: pkg.validFrom,
      document: pkg.document, regimes: pkg.regimes, jurisdiction: pkg.jurisdiction,
      semanticVersion: pkg.semanticVersion, packageId: pkg.packageId, schemaVersion: pkg.schemaVersion,
    };
    expect(await hashTaxPackage(reordered)).toBe(await hashTaxPackage(pkg));
  });

  it('recusa sobreposição de seletores e vigências ambíguas', () => {
    const duplicated = { ...pkg, rules: [...pkg.rules, { ...pkg.rules[0]!, id: 'r2' }] };
    expect(validateTaxPackage(duplicated).errors).toContain('RULE_VALIDITY_OVERLAP:r1:r2');
  });

  it('recusa fonte sem dispositivo ou fora da vigência declarada', () => {
    const invalid = { ...pkg, sources: [{ ...pkg.sources[0]!, provision: '' }] };
    expect(validateTaxPackage(invalid).errors).toContain('SOURCE_REFERENCE_INCOMPLETE:src');
  });

  it('recusa datas civis inexistentes sem normalizar para outro dia', () => {
    const invalid = { ...pkg, validFrom: '2026-02-30' };
    expect(validateTaxPackage(invalid).errors).toContain('PACKAGE_DATE_INVALID');
  });

  it('recusa fixtures duplicadas ou que apontam para regra inexistente', () => {
    const invalid = { ...pkg, fixtures: [
      { id: 'fixture-a', ruleId: 'missing', expected: 'APPLICABLE' },
      { id: 'fixture-a', ruleId: 'r1', expected: 'APPLICABLE' },
    ] };
    expect(validateTaxPackage(invalid).errors).toContain('FIXTURE_RULE_NOT_FOUND:fixture-a:missing');
    expect(validateTaxPackage(invalid).errors).toContain('FIXTURE_DUPLICATE:fixture-a');
  });
});
