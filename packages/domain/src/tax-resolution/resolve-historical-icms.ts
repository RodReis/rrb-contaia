import { lerDataCivil, type DataCivil } from '../datas/data-civil.js';

export type HistoricalTaxLiabilityKind =
  | 'ICMS_ST_RECIPIENT_DUE'
  | 'ICMS_ENTRY_ADVANCE'
  | 'ICMS_ST_JOINT_LIABILITY';

export type HistoricalIcmsRule = Readonly<{
  id: string;
  liabilityKind: HistoricalTaxLiabilityKind;
  relation: 'EXCLUSIVE' | 'ALTERNATIVE' | 'COEXISTENT';
  regime: 'SIMPLES_NACIONAL' | 'LUCRO_PRESUMIDO';
  operationType: 'COMPRA_INTERNA_REVENDA' | 'COMPRA_INTERESTADUAL_REVENDA';
  cfop: readonly string[];
  ncm: readonly string[];
  cest: readonly string[];
  cst: readonly string[];
  originStates: readonly string[];
  validFrom: DataCivil;
  validUntil: DataCivil;
  method: 'MVA_ORIGINAL' | 'MVA_ADJUSTED';
  mvaBasisPoints: number | null;
  internalRateBasisPoints: number | null;
  interstateRateBasisPoints: number | null;
  rounding: 'HALF_UP' | null;
  formulaVersion: string | null;
  dueDate: DataCivil | null;
  revenueCode: string | null;
  sourceIds: readonly string[];
}>;

export type HistoricalIcmsFacts = Readonly<{
  factDate: string | null;
  regime: string | null;
  documentModel: string;
  authorized: boolean;
  purpose: string | null;
  originUf: string | null;
  destinationUf: string | null;
  operationType: HistoricalIcmsRule['operationType'] | null;
  cfop: string | null;
  ncm: string | null;
  cest: string | null;
  cst: string | null;
  hasValidRetention: boolean | null;
  operationAmountCents: number | null;
  freightAmountCents: number | null;
  insuranceAmountCents: number | null;
  otherExpensesAmountCents: number | null;
  discountAmountCents: number | null;
  ownIcmsAmountCents: number | null;
}>;

export type HistoricalIcmsMemory = Readonly<{
  method: HistoricalIcmsRule['method'];
  formulaVersion: string;
  calculationBaseCents: number;
  adjustedBaseCents: number;
  adjustedBaseExact: Readonly<{ numerator: string; denominator: string }>;
  mvaBasisPoints: number;
  internalRateBasisPoints: number;
  interstateRateBasisPoints: number | null;
  ownIcmsDeductionCents: number;
  unroundedDueExact: Readonly<{ numerator: string; denominator: string }>;
  rounding: 'HALF_UP';
  dueDate: DataCivil;
  revenueCode: string;
}>;

export type HistoricalIcmsObligation = Readonly<{
  liabilityKind: HistoricalTaxLiabilityKind;
  relation: HistoricalIcmsRule['relation'] | null;
  status: 'APPLICABLE' | 'NOT_APPLICABLE' | 'INDETERMINATE';
  reasonCodes: readonly string[];
  ruleId: string | null;
  sourceIds: readonly string[];
  amountDueCents: number | null;
  memory: HistoricalIcmsMemory | null;
}>;

export type HistoricalIcmsResolution = Readonly<{
  revisionStatus: 'RESOLVED' | 'ABORTED';
  obligations: readonly HistoricalIcmsObligation[];
}>;

const LIABILITY_KINDS: readonly HistoricalTaxLiabilityKind[] = [
  'ICMS_ST_RECIPIENT_DUE', 'ICMS_ENTRY_ADVANCE', 'ICMS_ST_JOINT_LIABILITY',
];
const HISTORICAL_CUTOFF = '2018-02-28';
export const HISTORICAL_CUTOFF_SOURCE_ID = 'GO_DECREE_9147_2018_CUTOFF';
const SCALE = 10_000n;
const isMoney = (value: number | null): value is number => value !== null && Number.isSafeInteger(value) && value >= 0;
const isBasisPoints = (value: number | null): value is number => value !== null && Number.isSafeInteger(value) && value >= 0 && value <= 10_000;

const roundHalfUp = (numerator: bigint, denominator: bigint): bigint => {
  if (denominator <= 0n) throw new Error('denominador de arredondamento inválido');
  const sign = numerator < 0n ? -1n : 1n;
  const absolute = numerator < 0n ? -numerator : numerator;
  return sign * ((2n * absolute + denominator) / (2n * denominator));
};

const indeterminate = (
  liabilityKind: HistoricalTaxLiabilityKind,
  reasonCodes: readonly string[],
  rule: HistoricalIcmsRule | null = null,
): HistoricalIcmsObligation => ({
  liabilityKind, relation: rule?.relation ?? null, status: 'INDETERMINATE', reasonCodes,
  ruleId: rule?.id ?? null, sourceIds: rule?.sourceIds ?? [], amountDueCents: null, memory: null,
});

const notApplicable = (liabilityKind: HistoricalTaxLiabilityKind, reason: string, sourceIds: readonly string[] = []): HistoricalIcmsObligation => ({
  liabilityKind, relation: null, status: 'NOT_APPLICABLE', reasonCodes: [reason],
  ruleId: null, sourceIds, amountDueCents: null, memory: null,
});

const candidatesFor = (rules: readonly HistoricalIcmsRule[], facts: HistoricalIcmsFacts, liabilityKind: HistoricalTaxLiabilityKind) =>
  rules.filter((rule) => rule.liabilityKind === liabilityKind && rule.regime === facts.regime &&
    rule.operationType === facts.operationType && rule.cfop.includes(facts.cfop ?? '') &&
    rule.ncm.includes(facts.ncm ?? '') && rule.cest.includes(facts.cest ?? '') && rule.cst.includes(facts.cst ?? '') &&
    rule.originStates.includes(facts.originUf ?? '') &&
    rule.validFrom <= (facts.factDate ?? '') && (facts.factDate ?? '') <= rule.validUntil);

const calculate = (rule: HistoricalIcmsRule, facts: HistoricalIcmsFacts): HistoricalIcmsObligation => {
  const missing: string[] = [];
  const amounts = [facts.operationAmountCents, facts.freightAmountCents, facts.insuranceAmountCents,
    facts.otherExpensesAmountCents, facts.discountAmountCents, facts.ownIcmsAmountCents];
  if (!amounts.every(isMoney)) missing.push('TAX_CALCULATION_INPUT_INVALID');
  if (!isBasisPoints(rule.mvaBasisPoints)) missing.push('TAX_MVA_NOT_FOUND');
  if (!isBasisPoints(rule.internalRateBasisPoints) || rule.internalRateBasisPoints === 10_000) missing.push('TAX_RATE_NOT_FOUND');
  if (rule.method === 'MVA_ADJUSTED' && (!isBasisPoints(rule.interstateRateBasisPoints) || rule.interstateRateBasisPoints === 10_000)) missing.push('TAX_RATE_NOT_FOUND');
  if (rule.dueDate === null) missing.push('TAX_DUE_DATE_NOT_FOUND');
  if (rule.revenueCode === null || rule.revenueCode.trim() === '') missing.push('TAX_REVENUE_CODE_NOT_FOUND');
  if (rule.rounding !== 'HALF_UP' || rule.formulaVersion === null || rule.formulaVersion.trim() === '') missing.push('TAX_FORMULA_NOT_VERSIONED');
  if (rule.sourceIds.length === 0) missing.push('TAX_SOURCE_EVIDENCE_MISSING');
  if (missing.length > 0) return indeterminate(rule.liabilityKind, [...new Set(missing)], rule);

  const operation = facts.operationAmountCents;
  const freight = facts.freightAmountCents;
  const insurance = facts.insuranceAmountCents;
  const other = facts.otherExpensesAmountCents;
  const discount = facts.discountAmountCents;
  const ownIcms = facts.ownIcmsAmountCents;
  const mva = rule.mvaBasisPoints;
  const internalRate = rule.internalRateBasisPoints;
  if (operation === null || freight === null || insurance === null || other === null || discount === null || ownIcms === null ||
      mva === null || internalRate === null || rule.dueDate === null || rule.revenueCode === null || rule.formulaVersion === null) {
    return indeterminate(rule.liabilityKind, ['TAX_CALCULATION_INPUT_INVALID'], rule);
  }

  const base = BigInt(operation) + BigInt(freight) + BigInt(insurance) + BigInt(other) - BigInt(discount);
  if (base < 0n) return indeterminate(rule.liabilityKind, ['TAX_CALCULATION_INPUT_INVALID'], rule);

  let adjustedBaseNumerator: bigint;
  let adjustedBaseDenominator: bigint;
  let interstateRate: number | null = null;
  if (rule.method === 'MVA_ADJUSTED') {
    if (facts.operationType !== 'COMPRA_INTERESTADUAL_REVENDA' || rule.interstateRateBasisPoints === null) {
      return indeterminate(rule.liabilityKind, ['TAX_CALCULATION_INPUT_INVALID'], rule);
    }
    interstateRate = rule.interstateRateBasisPoints;
    const denominator = SCALE * (SCALE - BigInt(internalRate));
    const mvaAdjustedNumerator = (SCALE + BigInt(mva)) * (SCALE - BigInt(interstateRate)) - denominator;
    if (mvaAdjustedNumerator < 0n) return indeterminate(rule.liabilityKind, ['TAX_MVA_NOT_FOUND'], rule);
    adjustedBaseNumerator = base * (denominator + mvaAdjustedNumerator);
    adjustedBaseDenominator = denominator;
  } else {
    adjustedBaseNumerator = base * (SCALE + BigInt(mva));
    adjustedBaseDenominator = SCALE;
  }

  const unroundedTaxNumerator = adjustedBaseNumerator * BigInt(internalRate) - BigInt(ownIcms) * adjustedBaseDenominator * SCALE;
  const unroundedTaxDenominator = adjustedBaseDenominator * SCALE;
  const amount = roundHalfUp(unroundedTaxNumerator, unroundedTaxDenominator);
  const adjustedBaseCents = roundHalfUp(adjustedBaseNumerator, adjustedBaseDenominator);
  if (amount < 0n || amount > BigInt(Number.MAX_SAFE_INTEGER) || adjustedBaseCents > BigInt(Number.MAX_SAFE_INTEGER)) {
    return indeterminate(rule.liabilityKind, ['TAX_CALCULATION_INPUT_INVALID'], rule);
  }

  return {
    liabilityKind: rule.liabilityKind, relation: rule.relation, status: 'APPLICABLE', reasonCodes: [],
    ruleId: rule.id, sourceIds: rule.sourceIds, amountDueCents: Number(amount),
    memory: {
      method: rule.method, formulaVersion: rule.formulaVersion,
      calculationBaseCents: Number(base), adjustedBaseCents: Number(adjustedBaseCents),
      adjustedBaseExact: { numerator: String(adjustedBaseNumerator), denominator: String(adjustedBaseDenominator) },
      mvaBasisPoints: mva, internalRateBasisPoints: internalRate, interstateRateBasisPoints: interstateRate,
      ownIcmsDeductionCents: ownIcms,
      unroundedDueExact: { numerator: String(unroundedTaxNumerator), denominator: String(unroundedTaxDenominator) },
      rounding: 'HALF_UP', dueDate: rule.dueDate, revenueCode: rule.revenueCode,
    },
  };
};

/** Pure F28 resolver. It never selects or embeds a legal rate, MVA, date, due date or revenue code. */
export const resolveHistoricalIcms = (
  rules: readonly HistoricalIcmsRule[], facts: HistoricalIcmsFacts,
): HistoricalIcmsResolution => {
  if (facts.factDate === null) return { revisionStatus: 'RESOLVED', obligations: LIABILITY_KINDS.map((kind) => indeterminate(kind, ['TAX_FACT_DATE_MISSING'])) };
  try {
    if (lerDataCivil(facts.factDate) !== facts.factDate) throw new Error('data civil divergente');
  } catch {
    return { revisionStatus: 'RESOLVED', obligations: LIABILITY_KINDS.map((kind) => indeterminate(kind, ['TAX_FACT_DATE_INVALID'])) };
  }
  if (facts.factDate > HISTORICAL_CUTOFF) {
    return { revisionStatus: 'RESOLVED', obligations: LIABILITY_KINDS.map((kind) =>
      notApplicable(kind, 'TAX_HISTORICAL_PERIOD_OUT_OF_SCOPE', [HISTORICAL_CUTOFF_SOURCE_ID])) };
  }

  const requiredFacts = [facts.regime, facts.purpose, facts.originUf, facts.destinationUf, facts.operationType,
    facts.cfop, facts.ncm, facts.cest, facts.cst, facts.hasValidRetention];
  const incoherentOperation = facts.operationType === 'COMPRA_INTERNA_REVENDA'
    ? facts.originUf !== 'GO'
    : facts.operationType === 'COMPRA_INTERESTADUAL_REVENDA' && facts.originUf === 'GO';
  if (requiredFacts.some((value) => value === null) || facts.destinationUf !== 'GO' || facts.documentModel !== '55' ||
      !facts.authorized || facts.purpose !== 'RESALE' || facts.hasValidRetention !== false || incoherentOperation ||
      !['SIMPLES_NACIONAL', 'LUCRO_PRESUMIDO'].includes(facts.regime ?? '')) {
    const reason = facts.cest === null || facts.ncm === null ? 'TAX_CEST_NCM_EVIDENCE_MISSING' : 'TAX_LIABILITY_EVIDENCE_MISSING';
    return { revisionStatus: 'RESOLVED', obligations: LIABILITY_KINDS.map((kind) => indeterminate(kind, [reason])) };
  }

  const resolved = LIABILITY_KINDS.map((kind) => {
    const candidates = candidatesFor(rules, facts, kind);
    if (candidates.length === 0) return indeterminate(kind, ['NO_APPLICABLE_HISTORICAL_RULE']);
    if (candidates.length > 1) return indeterminate(kind, ['TAX_TREATMENT_RULE_AMBIGUOUS']);
    const selected = candidates[0];
    if (selected === undefined) return indeterminate(kind, ['NO_APPLICABLE_HISTORICAL_RULE']);
    return calculate(selected, facts);
  });

  const applied = resolved.filter((obligation) => obligation.status === 'APPLICABLE');
  const relationConflict = applied.length > 1 &&
    (applied.some((obligation) => obligation.relation !== 'COEXISTENT') ||
      applied.some((obligation) => obligation.relation !== applied[0]?.relation));
  const ambiguous = resolved.some((obligation) => obligation.reasonCodes.includes('TAX_TREATMENT_RULE_AMBIGUOUS'));
  if (relationConflict || ambiguous) {
    const reason = ambiguous ? 'TAX_TREATMENT_RULE_AMBIGUOUS' : 'TAX_LIABILITY_RELATION_CONFLICT';
    return {
      revisionStatus: 'ABORTED',
      obligations: LIABILITY_KINDS.map((kind) => indeterminate(kind, [reason])),
    };
  }
  return { revisionStatus: 'RESOLVED', obligations: resolved };
};
