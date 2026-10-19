import { resolveEntryTax } from './resolve-entry.js';

export type TaxPackageSource = Readonly<{
  id: string;
  authority: string;
  title: string;
  url: string;
  provision: string;
  publishedOn: string;
  consultedOn: string;
  validFrom: string;
  validUntil: string | null;
}>;

export type CuratedTaxPackage = Readonly<{
  schemaVersion: 1;
  packageId: string;
  semanticVersion: string;
  jurisdiction: 'BR' | 'GO';
  regimes: readonly ('SIMPLES_NACIONAL' | 'LUCRO_PRESUMIDO')[];
  document: Readonly<{ model: '55'; direction: 'ENTRY'; purpose: 'RESALE' }>;
  validFrom: string;
  validUntil: string | null;
  consultedOn: string;
  coverage: readonly string[];
  exclusions: readonly string[];
  sources: readonly TaxPackageSource[];
  rules: readonly Readonly<{
    id: string;
    taxType: 'ICMS' | 'PIS' | 'COFINS' | 'IBS_UF' | 'IBS_MUN' | 'CBS';
    regime: 'SIMPLES_NACIONAL' | 'LUCRO_PRESUMIDO';
    operationType: 'COMPRA_INTERNA_REVENDA' | 'COMPRA_INTERESTADUAL_REVENDA';
    cfop: readonly string[];
    ncm: readonly string[];
    cst: readonly string[];
    validFrom: string;
    validUntil: string | null;
    treatment: 'APPLICABLE' | 'NOT_APPLICABLE';
    creditEligibility: 'ALLOWED' | 'BLOCKED' | 'NOT_RELEVANT';
    sourceIds: readonly string[];
    rationale: string;
  }>[];
  fixtures: readonly Readonly<{ id: string; ruleId: string; expected: 'APPLICABLE' | 'NOT_APPLICABLE' }> [];
}>;

export type PackageValidation = Readonly<{ valid: boolean; errors: readonly string[] }>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;
const validDate = (value: string): boolean => {
  if (!ISO_DATE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};

const canonicalize = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonicalize(child)}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

export const validateTaxPackage = (input: CuratedTaxPackage): PackageValidation => {
  const errors: string[] = [];
  if (input.schemaVersion !== 1) errors.push('SCHEMA_VERSION_UNSUPPORTED');
  if (input.jurisdiction !== 'BR' && input.jurisdiction !== 'GO') errors.push('JURISDICTION_UNSUPPORTED');
  if (!validDate(input.validFrom) || !validDate(input.consultedOn)) errors.push('PACKAGE_DATE_INVALID');
  if (input.validUntil !== null && (!validDate(input.validUntil) || input.validUntil < input.validFrom)) errors.push('PACKAGE_VALIDITY_INVALID');
  if (input.regimes.length === 0 || input.rules.length === 0) errors.push('PACKAGE_COVERAGE_EMPTY');
  if (input.fixtures.length === 0) errors.push('PACKAGE_FIXTURES_EMPTY');

  const sourceIds = new Set<string>();
  for (const source of input.sources) {
    if (sourceIds.has(source.id)) errors.push(`SOURCE_DUPLICATE:${source.id}`);
    sourceIds.add(source.id);
    if (!/^https:\/\//u.test(source.url) || source.provision.trim().length === 0) errors.push(`SOURCE_REFERENCE_INCOMPLETE:${source.id}`);
    if (![source.publishedOn, source.consultedOn, source.validFrom].every(validDate) ||
      (source.validUntil !== null && (!validDate(source.validUntil) || source.validUntil < source.validFrom))) {
      errors.push(`SOURCE_DATE_INVALID:${source.id}`);
    }
  }

  for (const [index, rule] of input.rules.entries()) {
    if (!input.regimes.includes(rule.regime)) errors.push(`RULE_REGIME_NOT_COVERED:${rule.id}`);
    if (!validDate(rule.validFrom) || (rule.validUntil !== null && (!validDate(rule.validUntil) || rule.validUntil < rule.validFrom))) errors.push(`RULE_VALIDITY_INVALID:${rule.id}`);
    if (rule.validFrom < input.validFrom || (input.validUntil !== null && (rule.validUntil === null || rule.validUntil > input.validUntil))) errors.push(`RULE_OUTSIDE_PACKAGE_VALIDITY:${rule.id}`);
    if (rule.sourceIds.length === 0 || rule.sourceIds.some((id) => !sourceIds.has(id))) errors.push(`RULE_SOURCE_MISSING:${rule.id}`);
    if (rule.cfop.length === 0 || rule.ncm.length === 0 || rule.cst.length === 0) errors.push(`RULE_SELECTOR_EMPTY:${rule.id}`);
    if (rule.rationale.trim().length === 0) errors.push(`RULE_RATIONALE_EMPTY:${rule.id}`);
    if (rule.sourceIds.some((id) => {
      const source = input.sources.find((item) => item.id === id);
      return source !== undefined && (rule.validFrom < source.validFrom ||
        (source.validUntil !== null && (rule.validUntil === null || rule.validUntil > source.validUntil)));
    })) errors.push(`RULE_OUTSIDE_SOURCE_VALIDITY:${rule.id}`);
    for (const other of input.rules.slice(index + 1)) {
      const sameSelector = rule.taxType === other.taxType && rule.regime === other.regime &&
        rule.operationType === other.operationType && rule.cfop.some((value) => other.cfop.includes(value)) &&
        rule.ncm.some((value) => other.ncm.includes(value)) && rule.cst.some((value) => other.cst.includes(value));
      const end = rule.validUntil ?? '9999-12-31';
      const otherEnd = other.validUntil ?? '9999-12-31';
      if (sameSelector && rule.validFrom <= otherEnd && other.validFrom <= end) {
        errors.push(`RULE_VALIDITY_OVERLAP:${rule.id}:${other.id}`);
      }
    }
  }

  const ruleIds = new Set(input.rules.map((rule) => rule.id));
  const fixtureIds = new Set<string>();
  for (const fixture of input.fixtures) {
    if (fixtureIds.has(fixture.id)) errors.push(`FIXTURE_DUPLICATE:${fixture.id}`);
    fixtureIds.add(fixture.id);
    if (!ruleIds.has(fixture.ruleId)) errors.push(`FIXTURE_RULE_NOT_FOUND:${fixture.id}:${fixture.ruleId}`);
    if (fixture.expected.trim().length === 0) errors.push(`FIXTURE_EXPECTATION_EMPTY:${fixture.id}`);
    const rule = input.rules.find((item) => item.id === fixture.ruleId);
    if (rule !== undefined && rule.cfop[0] !== undefined && rule.ncm[0] !== undefined && rule.cst[0] !== undefined) {
      const internal = rule.operationType === 'COMPRA_INTERNA_REVENDA';
      const decision = resolveEntryTax(input, {
        factDate: rule.validFrom, regime: rule.regime,
        originUf: internal ? 'GO' : 'SP', destinationUf: 'GO', documentModel: '55', authorized: true,
        operationType: rule.operationType, purpose: 'RESALE', cfop: rule.cfop[0], ncm: rule.ncm[0], cst: rule.cst[0],
        hasSubstitutionTax: false, isImport: false, isMonophase: false,
        hasUnmodeledBenefit: false, isReturnOrTransfer: false, declaredCents: null,
      }, rule.taxType, null);
      if (decision.ruleId !== rule.id || decision.status !== fixture.expected) errors.push(`FIXTURE_EXPECTATION_MISMATCH:${fixture.id}`);
    }
  }

  return { valid: errors.length === 0, errors };
};

export const hashTaxPackage = async (input: CuratedTaxPackage): Promise<string> => {
  const bytes = new TextEncoder().encode(canonicalize(input));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

export const taxPackageCoversDate = (pkg: CuratedTaxPackage, date: string): boolean =>
  pkg.validFrom <= date && (pkg.validUntil === null || date <= pkg.validUntil);
