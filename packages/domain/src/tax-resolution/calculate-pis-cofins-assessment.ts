export type PisCofinsContribution = 'PIS_PASEP' | 'COFINS';
export type PisCofinsRevenueRecognition = 'ACCRUAL' | 'CASH';

export type PisCofinsTreatment = Readonly<{
  code: string;
  ncmCodes: readonly string[];
  cfops: readonly string[];
  cstCodes: readonly string[];
  pisRateScaled: string;
  cofinsRateScaled: string;
  sourceIds: readonly string[];
}>;

export type PisCofinsRulePackage = Readonly<{
  version: string;
  approved: boolean;
  validFrom: string;
  validThrough: string | null;
  sourceIds: readonly string[];
  treatments: readonly PisCofinsTreatment[];
  rounding: 'HALF_UP';
}>;

export type PisCofinsRevenue = Readonly<{
  id: string;
  recognizedAt: string;
  cents: number;
  ncm: string;
  cfop: string;
  cst: string;
  treatmentCode: string;
  sourceIds: readonly string[];
  evidenceComplete: boolean;
  postSaleReconciled: boolean;
}>;

export type PisCofinsTransition = Readonly<{
  applies: boolean;
  notApplicableProven: boolean;
  approved?: boolean;
  version?: string;
  sourceIds?: readonly string[];
  evidenceProven?: boolean;
  offsetOrder?: readonly PisCofinsContribution[];
  totalOffsetCents?: number;
  maximumPisOffsetCents?: number;
  maximumCofinsOffsetCents?: number;
}>;

export type PisCofinsAssessmentInput = Readonly<{
  competence: string;
  recognition: PisCofinsRevenueRecognition | null;
  recognitionOptionProven: boolean;
  package: PisCofinsRulePackage | null;
  regimeEligible: boolean;
  activityVerified: boolean;
  revenueReconciled: boolean;
  revenue: readonly PisCofinsRevenue[];
  transition: PisCofinsTransition | null;
}>;

export type PisCofinsComponent = Readonly<{
  contribution: PisCofinsContribution;
  treatmentCode: string;
  baseCents: number;
  rateScaled: string | null;
  grossAmountCents: number | null;
  transitionOffsetCents: number;
  netAmountCents: number | null;
  ruleId: string;
  sourceIds: readonly string[];
}>;

export type PisCofinsAssessment = Readonly<{
  status: 'INDETERMINATE' | 'READY_FOR_REVIEW';
  competence: string;
  revenueRecognition: PisCofinsRevenueRecognition | null;
  rulePackageVersion: string | null;
  transitionPackageVersion: string | null;
  components: readonly PisCofinsComponent[];
  pisPayableCents: number | null;
  cofinsPayableCents: number | null;
  unallocatedTransitionOffsetCents: number | null;
  gapCodes: readonly string[];
}>;

const isCents = (value: number): boolean => Number.isSafeInteger(value) && value >= 0;
const isDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
};
const isMonth = (value: string): boolean => /^2026-(0[1-9]|1[0-2])$/u.test(value);
const dateMonth = (value: string): string => value.slice(0, 7);
const monthEnd = (value: string): string => {
  const [year, month] = value.split('-').map(Number);
  return new Date(Date.UTC(year!, month!, 0)).toISOString().slice(0, 10);
};

const calculateRate = (baseCents: number, percent: string): number | null => {
  if (!/^\d+(?:\.\d{1,6})?$/u.test(percent)) return null;
  const [whole = '', fraction = ''] = percent.split('.');
  const numerator = BigInt(baseCents) * BigInt(`${whole}${fraction}`);
  const denominator = 100n * (10n ** BigInt(fraction.length));
  const rounded = (numerator * 2n + denominator) / (denominator * 2n);
  const amount = Number(rounded);
  return Number.isSafeInteger(amount) ? amount : null;
};

const parseRate = (value: string): string | null => /^\d+(?:\.\d{1,6})?$/u.test(value) ? value : null;

const blocked = (input: PisCofinsAssessmentInput, gaps: readonly string[], components: readonly PisCofinsComponent[] = []): PisCofinsAssessment => ({
  status: 'INDETERMINATE', competence: input.competence, revenueRecognition: input.recognition,
  rulePackageVersion: input.package?.version ?? null,
  transitionPackageVersion: input.transition?.approved === true ? input.transition.version ?? null : null,
  components, pisPayableCents: null, cofinsPayableCents: null, unallocatedTransitionOffsetCents: null, gapCodes: [...new Set(gaps)].sort(),
});

/** Motor puro: só calcula com cobertura e prova completas; lacuna não vira zero. */
export const calculatePisCofinsAssessment = (input: PisCofinsAssessmentInput): PisCofinsAssessment => {
  const gaps: string[] = [];
  if (!isMonth(input.competence)) gaps.push('PIS_COFINS_COMPETENCE_OUT_OF_SCOPE');
  if (!input.regimeEligible) gaps.push('PIS_COFINS_REGIME_MISMATCH');
  if (!input.activityVerified) gaps.push('PIS_COFINS_ACTIVITY_UNPROVEN');
  if (!input.recognitionOptionProven || input.recognition === null) gaps.push('PIS_COFINS_RECOGNITION_OPTION_MISSING');
  if (!input.revenueReconciled) gaps.push('PIS_COFINS_REVENUE_RECONCILIATION_FAILED');
  if (input.revenue.length === 0) gaps.push('PIS_COFINS_REVENUE_MISSING');
  if (input.package === null) gaps.push('PIS_COFINS_RULE_MISSING');
  else {
    if (!input.package.approved) gaps.push('PIS_COFINS_RULE_NOT_APPROVED');
    if (input.package.sourceIds.length === 0) gaps.push('PIS_COFINS_RULE_SOURCE_MISSING');
    if (input.package.rounding !== 'HALF_UP') gaps.push('PIS_COFINS_ROUNDING_UNSUPPORTED');
    if (input.package.validFrom > `${input.competence}-01` ||
        (input.package.validThrough !== null && input.package.validThrough < monthEnd(input.competence)))
      gaps.push('PIS_COFINS_RULE_NOT_APPLICABLE');
  }

  const seen = new Set<string>();
  const components: PisCofinsComponent[] = [];
  if (input.package !== null) {
    for (const item of [...input.revenue].sort((left, right) => left.id.localeCompare(right.id))) {
      if (!isDate(item.recognizedAt) || dateMonth(item.recognizedAt) !== input.competence || !isCents(item.cents)) {
        gaps.push('PIS_COFINS_REVENUE_RECONCILIATION_FAILED');
        continue;
      }
      if (seen.has(item.id)) gaps.push('PIS_COFINS_REVENUE_DUPLICATE');
      seen.add(item.id);
      if (item.sourceIds.length === 0 || !item.evidenceComplete) gaps.push('PIS_COFINS_EVIDENCE_REQUIRED');
      if (!item.postSaleReconciled) gaps.push('PIS_COFINS_REVENUE_RECONCILIATION_FAILED');
      const matched = input.package.treatments.filter((rule) => rule.code === item.treatmentCode && rule.ncmCodes.includes(item.ncm) &&
        rule.cfops.includes(item.cfop) && rule.cstCodes.includes(item.cst));
      if (matched.length !== 1) {
        gaps.push(matched.length === 0 ? 'PIS_COFINS_TREATMENT_UNSUPPORTED' : 'PIS_COFINS_RULE_CONFLICT');
        continue;
      }
      const rule = matched[0]!;
      const sourceIds = [...new Set([...item.sourceIds, ...rule.sourceIds, ...input.package.sourceIds])].sort();
      const pisRate = parseRate(rule.pisRateScaled);
      const cofinsRate = parseRate(rule.cofinsRateScaled);
      if (pisRate === null || cofinsRate === null || sourceIds.length === 0) {
        gaps.push('PIS_COFINS_RULE_CONFLICT');
        continue;
      }
      const pisAmount = calculateRate(item.cents, pisRate);
      const cofinsAmount = calculateRate(item.cents, cofinsRate);
      if (pisAmount === null || cofinsAmount === null) {
        gaps.push('PIS_COFINS_CALCULATION_OVERFLOW');
        continue;
      }
      components.push({ contribution: 'PIS_PASEP', treatmentCode: rule.code, baseCents: item.cents, rateScaled: pisRate,
        grossAmountCents: pisAmount, transitionOffsetCents: 0, netAmountCents: pisAmount, ruleId: input.package.version, sourceIds });
      components.push({ contribution: 'COFINS', treatmentCode: rule.code, baseCents: item.cents, rateScaled: cofinsRate,
        grossAmountCents: cofinsAmount, transitionOffsetCents: 0, netAmountCents: cofinsAmount, ruleId: input.package.version, sourceIds });
    }
  }

  const pisGross = components.filter((item) => item.contribution === 'PIS_PASEP').reduce((total, item) => total + (item.grossAmountCents ?? 0), 0);
  const cofinsGross = components.filter((item) => item.contribution === 'COFINS').reduce((total, item) => total + (item.grossAmountCents ?? 0), 0);
  if (!Number.isSafeInteger(pisGross) || !Number.isSafeInteger(cofinsGross)) gaps.push('PIS_COFINS_CALCULATION_OVERFLOW');

  const transition = input.transition;
  let pisOffset = 0;
  let cofinsOffset = 0;
  let unallocatedOffset = 0;
  if (transition === null || transition.approved !== true || transition.evidenceProven !== true ||
      !transition.version || !transition.sourceIds?.length) {
    gaps.push('PIS_COFINS_TRANSITION_EVIDENCE_MISSING');
  } else if (!transition.applies && !transition.notApplicableProven) {
    gaps.push('PIS_COFINS_TRANSITION_EVIDENCE_MISSING');
  } else if (!transition.applies && transition.totalOffsetCents !== undefined && transition.totalOffsetCents !== 0) {
    gaps.push('PIS_COFINS_TRANSITION_OFFSET_INVALID');
  } else if (transition.applies) {
    const total = transition.totalOffsetCents;
    if (total === undefined || !isCents(total) || transition.offsetOrder?.length !== 2 ||
        new Set(transition.offsetOrder).size !== 2 ||
        transition.maximumPisOffsetCents === undefined || transition.maximumCofinsOffsetCents === undefined ||
        !isCents(transition.maximumPisOffsetCents) || !isCents(transition.maximumCofinsOffsetCents) ||
        transition.offsetOrder.some((item) => item !== 'PIS_PASEP' && item !== 'COFINS'))
      gaps.push('PIS_COFINS_TRANSITION_OFFSET_INVALID');
    else {
      let remaining = total;
      for (const contribution of transition.offsetOrder) {
        const gross = contribution === 'PIS_PASEP' ? pisGross : cofinsGross;
        const maximum = contribution === 'PIS_PASEP' ? transition.maximumPisOffsetCents! : transition.maximumCofinsOffsetCents!;
        const offset = Math.min(remaining, gross, maximum);
        if (contribution === 'PIS_PASEP') pisOffset = offset;
        else cofinsOffset = offset;
        remaining -= offset;
      }
      unallocatedOffset = remaining;
    }
  }

  if (gaps.length > 0) return blocked(input, gaps, components);
  let pisRemaining = pisOffset;
  let cofinsRemaining = cofinsOffset;
  const finalComponents = components.map((component) => {
    const remaining = component.contribution === 'PIS_PASEP' ? pisRemaining : cofinsRemaining;
    const netOffset = Math.min(remaining, component.grossAmountCents ?? 0);
    if (component.contribution === 'PIS_PASEP') pisRemaining -= netOffset;
    else cofinsRemaining -= netOffset;
    return { ...component, transitionOffsetCents: netOffset,
      netAmountCents: Math.max(0, (component.grossAmountCents ?? 0) - netOffset) };
  });
  return { status: 'READY_FOR_REVIEW', competence: input.competence, revenueRecognition: input.recognition,
    rulePackageVersion: input.package?.version ?? null, transitionPackageVersion: transition?.version ?? null,
    components: finalComponents, pisPayableCents: pisGross - pisOffset, cofinsPayableCents: cofinsGross - cofinsOffset,
    unallocatedTransitionOffsetCents: unallocatedOffset, gapCodes: [] };
};
