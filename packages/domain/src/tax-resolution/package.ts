import { resolveEntryTax, type EntryTaxFacts } from './resolve-entry.js';
import { resolveHistoricalIcms, type HistoricalIcmsFacts, type HistoricalIcmsRule } from './resolve-historical-icms.js';

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
  operations: readonly ('COMPRA_INTERNA_REVENDA' | 'COMPRA_INTERESTADUAL_REVENDA')[];
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
    cest?: readonly string[] | undefined;
    cst: readonly string[];
    validFrom: string;
    validUntil: string | null;
    treatment: 'APPLICABLE' | 'NOT_APPLICABLE';
    creditEligibility: 'ALLOWED' | 'BLOCKED' | 'NOT_RELEVANT';
    sourceIds: readonly string[];
    rationale: string;
    /** F28 fields. Their presence activates the historical MVA rule contract. */
    liabilityKind?: 'ICMS_ST_RECIPIENT_DUE' | 'ICMS_ENTRY_ADVANCE' | 'ICMS_ST_JOINT_LIABILITY';
    relation?: 'EXCLUSIVE' | 'ALTERNATIVE' | 'COEXISTENT';
    taxSegment?: 'AUTO_PARTS';
    legalDescription?: string;
    originStates?: readonly string[];
    calculationMethod?: 'MVA_ORIGINAL' | 'MVA_ADJUSTED';
    mvaBasisPoints?: number | null;
    internalRateBasisPoints?: number | null;
    interstateRateBasisPoints?: number | null;
    rounding?: 'HALF_UP';
    formulaVersion?: string;
    dueDate?: string | null;
    revenueCode?: string | null;
  }>[];
  fixtures: readonly Readonly<{
    id: string;
    ruleId: string;
    taxType: CuratedTaxPackage['rules'][number]['taxType'];
    facts: EntryTaxFacts;
    expected: 'APPLICABLE' | 'NOT_APPLICABLE' | 'INDETERMINATE';
    liabilityKind?: HistoricalIcmsRule['liabilityKind'];
    historicalFacts?: HistoricalIcmsFacts;
    expectedAmountCents?: number | null;
  }>[];
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
  if (input.regimes.length === 0) errors.push('PACKAGE_COVERAGE_EMPTY');
  if (input.rules.length === 0) errors.push('PACKAGE_EXECUTABLE_RULES_EMPTY');
  if (input.rules.length > 0 && input.fixtures.length === 0) errors.push('PACKAGE_FIXTURES_EMPTY');
  if (input.sources.length === 0) errors.push('PACKAGE_SOURCES_EMPTY');
  if (input.coverage.length === 0) errors.push('PACKAGE_COVERAGE_EMPTY');

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
    if (rule.taxType === 'ICMS' && rule.cest !== undefined && rule.cest.some((cest) => !/^\d{7}$/u.test(cest))) errors.push(`RULE_CEST_INVALID:${rule.id}`);
    if (!input.regimes.includes(rule.regime)) errors.push(`RULE_REGIME_NOT_COVERED:${rule.id}`);
    if (!validDate(rule.validFrom) || (rule.validUntil !== null && (!validDate(rule.validUntil) || rule.validUntil < rule.validFrom))) errors.push(`RULE_VALIDITY_INVALID:${rule.id}`);
    if (rule.validFrom < input.validFrom || (input.validUntil !== null && (rule.validUntil === null || rule.validUntil > input.validUntil))) errors.push(`RULE_OUTSIDE_PACKAGE_VALIDITY:${rule.id}`);
    if (rule.sourceIds.length === 0 || rule.sourceIds.some((id) => !sourceIds.has(id))) errors.push(`RULE_SOURCE_MISSING:${rule.id}`);
    if (rule.cfop.length === 0 || rule.ncm.length === 0 || rule.cst.length === 0) errors.push(`RULE_SELECTOR_EMPTY:${rule.id}`);
    if (rule.rationale.trim().length === 0) errors.push(`RULE_RATIONALE_EMPTY:${rule.id}`);
    if (rule.liabilityKind !== undefined) {
      if (rule.taxType !== 'ICMS' || rule.taxSegment !== 'AUTO_PARTS' || rule.legalDescription === undefined || rule.legalDescription.trim() === '' ||
          rule.cest === undefined || rule.cest.length === 0 || rule.ncm.length === 0 || rule.originStates === undefined || rule.originStates.length === 0) {
        errors.push(`HISTORICAL_RULE_SELECTOR_INCOMPLETE:${rule.id}`);
      }
      if (rule.relation === undefined) errors.push(`TAX_LIABILITY_RELATION_MISSING:${rule.id}`);
      if (rule.calculationMethod === undefined || rule.mvaBasisPoints === null || rule.mvaBasisPoints === undefined) errors.push(`TAX_MVA_NOT_FOUND:${rule.id}`);
      if (rule.internalRateBasisPoints === null || rule.internalRateBasisPoints === undefined ||
          (rule.calculationMethod === 'MVA_ADJUSTED' && (rule.interstateRateBasisPoints === null || rule.interstateRateBasisPoints === undefined))) {
        errors.push(`TAX_RATE_NOT_FOUND:${rule.id}`);
      }
      if (rule.rounding !== 'HALF_UP' || rule.formulaVersion === undefined || rule.formulaVersion.trim() === '') errors.push(`TAX_FORMULA_NOT_VERSIONED:${rule.id}`);
      if (rule.dueDate === null || rule.dueDate === undefined) errors.push(`TAX_DUE_DATE_NOT_FOUND:${rule.id}`);
      else if (!validDate(rule.dueDate)) errors.push(`TAX_DUE_DATE_INVALID:${rule.id}`);
      if (rule.revenueCode?.trim() === '' || rule.revenueCode === null || rule.revenueCode === undefined) errors.push(`TAX_REVENUE_CODE_NOT_FOUND:${rule.id}`);
      if (rule.validUntil === null || rule.validUntil > '2018-02-28') errors.push(`HISTORICAL_RULE_AFTER_COVERAGE:${rule.id}`);
      for (const state of rule.originStates ?? []) if (!/^[A-Z]{2}$/u.test(state)) errors.push(`HISTORICAL_RULE_ORIGIN_INVALID:${rule.id}`);
    }
    if (rule.sourceIds.some((id) => {
      const source = input.sources.find((item) => item.id === id);
      return source !== undefined && (rule.validFrom < source.validFrom ||
        (source.validUntil !== null && (rule.validUntil === null || rule.validUntil > source.validUntil)));
    })) errors.push(`RULE_OUTSIDE_SOURCE_VALIDITY:${rule.id}`);
    for (const other of input.rules.slice(index + 1)) {
      const sameSelector = rule.taxType === other.taxType && rule.regime === other.regime &&
        rule.operationType === other.operationType && rule.cfop.some((value) => other.cfop.includes(value)) &&
        rule.ncm.some((value) => other.ncm.includes(value)) && rule.cst.some((value) => other.cst.includes(value)) &&
        rule.liabilityKind === other.liabilityKind &&
        ((rule.cest === undefined && other.cest === undefined) ||
          (rule.cest !== undefined && other.cest !== undefined && rule.cest.some((value) => other.cest?.includes(value))));
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
    if (rule !== undefined) {
      if (rule.taxType !== fixture.taxType) errors.push(`FIXTURE_TAX_TYPE_MISMATCH:${fixture.id}`);
      if (fixture.liabilityKind !== undefined) {
        if (fixture.historicalFacts === undefined || rule.liabilityKind !== fixture.liabilityKind) {
          errors.push(`FIXTURE_HISTORICAL_FACTS_MISSING:${fixture.id}`);
        } else {
          const historicalRules: HistoricalIcmsRule[] = input.rules.flatMap((candidate) => {
            if (candidate.liabilityKind === undefined || candidate.relation === undefined || candidate.taxSegment !== 'AUTO_PARTS' ||
                candidate.calculationMethod === undefined || candidate.mvaBasisPoints === null || candidate.mvaBasisPoints === undefined ||
                candidate.internalRateBasisPoints === null || candidate.internalRateBasisPoints === undefined || candidate.rounding !== 'HALF_UP' ||
                candidate.formulaVersion === undefined || candidate.dueDate === null || candidate.dueDate === undefined ||
                candidate.revenueCode === null || candidate.revenueCode === undefined || candidate.cest === undefined || candidate.validUntil === null) return [];
            return [{
              id: candidate.id, liabilityKind: candidate.liabilityKind, relation: candidate.relation,
              regime: candidate.regime, operationType: candidate.operationType, cfop: candidate.cfop,
              ncm: candidate.ncm, cest: candidate.cest, cst: candidate.cst, originStates: candidate.originStates ?? [],
              validFrom: candidate.validFrom,
              validUntil: candidate.validUntil,
              method: candidate.calculationMethod, mvaBasisPoints: candidate.mvaBasisPoints,
              internalRateBasisPoints: candidate.internalRateBasisPoints,
              interstateRateBasisPoints: candidate.interstateRateBasisPoints ?? null,
              rounding: candidate.rounding, formulaVersion: candidate.formulaVersion,
              dueDate: candidate.dueDate,
              revenueCode: candidate.revenueCode, sourceIds: candidate.sourceIds,
            }];
          });
          const decision = resolveHistoricalIcms(historicalRules, fixture.historicalFacts);
          const obligation = decision.obligations.find((item) => item.liabilityKind === fixture.liabilityKind);
          if (obligation?.ruleId !== rule.id || obligation.status !== fixture.expected ||
              (fixture.expectedAmountCents !== undefined && obligation.amountDueCents !== fixture.expectedAmountCents)) {
            errors.push(`FIXTURE_EXPECTATION_MISMATCH:${fixture.id}`);
          }
        }
      } else {
        const decision = resolveEntryTax(input, fixture.facts, fixture.taxType, null);
        if (decision.ruleId !== rule.id || decision.status !== fixture.expected) errors.push(`FIXTURE_EXPECTATION_MISMATCH:${fixture.id}`);
      }
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
