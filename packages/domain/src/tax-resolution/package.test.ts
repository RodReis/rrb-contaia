import { describe, expect, it } from 'vitest';

import { hashTaxPackage, validateTaxPackage, type CuratedTaxPackage } from '../index.js';

const fixtureFacts = {
  factDate: '2026-06-15', regime: 'LUCRO_PRESUMIDO', originUf: 'GO', destinationUf: 'GO',
  documentModel: '55', authorized: true, operationType: 'COMPRA_INTERNA_REVENDA', purpose: 'RESALE',
  cfop: '1102', ncm: '12345678', cst: '00', hasSubstitutionTax: false, isImport: false,
  isMonophase: false, hasUnmodeledBenefit: false, isReturnOrTransfer: false, declaredCents: 1000,
} as const;

const pkg: CuratedTaxPackage = {
  schemaVersion: 1, packageId: 'go-entry', semanticVersion: '1.0.0', jurisdiction: 'GO', regimes: ['LUCRO_PRESUMIDO'],
  document: { model: '55', direction: 'ENTRY', purpose: 'RESALE' }, operations: ['COMPRA_INTERNA_REVENDA','COMPRA_INTERESTADUAL_REVENDA'], validFrom: '2026-01-01', validUntil: null,
  consultedOn: '2026-09-19', coverage: ['revenda'], exclusions: ['ST'],
  sources: [{ id: 'src', authority: 'SEFAZ-GO', title: 'Norma', url: 'https://goias.gov.br/economia/', provision: 'art. 1', publishedOn: '2025-01-01', consultedOn: '2026-09-19', validFrom: '2026-01-01', validUntil: null }],
  rules: [{ id: 'r1', taxType: 'ICMS', regime: 'LUCRO_PRESUMIDO', operationType: 'COMPRA_INTERNA_REVENDA', cfop: ['1102'], ncm: ['12345678'], cst: ['00'], validFrom: '2026-01-01', validUntil: null, treatment: 'APPLICABLE', creditEligibility: 'ALLOWED', sourceIds: ['src'], rationale: 'Regra de fixture; não publicada.' }],
  fixtures: [{ id: 'fixture-r1', ruleId: 'r1', taxType: 'ICMS', facts: fixtureFacts, expected: 'APPLICABLE' }],
};

describe('pacote tributário curado', () => {
  it('recusa pacote sem fixture de conformidade', () => {
    expect(validateTaxPackage({ ...pkg, fixtures: [] }).errors).toContain('PACKAGE_FIXTURES_EMPTY');
  });

  it('executa fixture com fatos independentes contra a regra e recusa expectativa divergente', () => {
    const invalid = { ...pkg, fixtures: [{ ...pkg.fixtures[0]!, facts: { ...fixtureFacts, cfop: '3102' } }] };
    expect(validateTaxPackage(invalid).errors).toContain('FIXTURE_EXPECTATION_MISMATCH:fixture-r1');
  });

  it('recusa fixture de tributo diferente do tributo da regra', () => {
    const invalid = { ...pkg, fixtures: [{ ...pkg.fixtures[0]!, taxType: 'PIS' as const }] };
    expect(validateTaxPackage(invalid).errors).toContain('FIXTURE_TAX_TYPE_MISMATCH:fixture-r1');
  });

  it('valida estrutura normativa e gera hash estável da forma canônica', async () => {
    expect(validateTaxPackage(pkg)).toEqual({ valid: true, errors: [] });
    expect(await hashTaxPackage(pkg)).toMatch(/^[0-9a-f]{64}$/u);
    expect(await hashTaxPackage(pkg)).toBe(await hashTaxPackage(pkg));
    const reordered: CuratedTaxPackage = {
      fixtures: pkg.fixtures, rules: pkg.rules, sources: pkg.sources, exclusions: pkg.exclusions,
      coverage: pkg.coverage, consultedOn: pkg.consultedOn, validUntil: pkg.validUntil, validFrom: pkg.validFrom,
      operations: pkg.operations, document: pkg.document, regimes: pkg.regimes, jurisdiction: pkg.jurisdiction,
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
      { ...pkg.fixtures[0]!, id: 'fixture-a', ruleId: 'missing' },
      { ...pkg.fixtures[0]!, id: 'fixture-a' },
    ] };
    expect(validateTaxPackage(invalid).errors).toContain('FIXTURE_RULE_NOT_FOUND:fixture-a:missing');
    expect(validateTaxPackage(invalid).errors).toContain('FIXTURE_DUPLICATE:fixture-a');
  });
});
