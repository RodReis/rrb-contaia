import { CORPORATE_TAX_RATE_SCALE, parseScaledRate, roundHalfUp } from './corporate-tax-arithmetic.js';

export type CorporateTaxKind = 'IRPJ' | 'IRPJ_ADDITIONAL' | 'CSLL';
export type CorporateTaxRecognition = 'ACCRUAL' | 'CASH';

export type CorporateTaxRule = Readonly<{
  id: string;
  tax: CorporateTaxKind;
  activityCode: string;
  revenueNatureCode: string;
  revenueBasis?: 'LINE' | 'MONTH' | 'QUARTER' | 'YEAR_TO_DATE' | undefined;
  revenueMinimumCents?: number | undefined;
  revenueMaximumCents?: number | null | undefined;
  validFrom: string;
  validThrough: string | null;
  presumptionRateScaled: string;
  taxRateScaled: string;
  sourceIds: readonly string[];
}>;

export type CorporateTaxRulePackage = Readonly<{
  version: string;
  approved: boolean;
  validFrom: string;
  validThrough: string | null;
  sourceIds: readonly string[];
  rules: readonly CorporateTaxRule[];
  additionalIrpjRateScaled: string | null;
  additionalIrpjThresholdCentsByMonth: number | null;
  additionalIrpjRuleId: string | null;
  additionalIrpjSourceIds: readonly string[];
  rounding: 'HALF_UP';
}>;

export type CorporateTaxRevenue = Readonly<{
  id: string;
  activityCode: string;
  revenueNatureCode: string;
  month: string;
  grossCents: number;
  adjustmentCents: number;
  directAdditionCents: number;
  lineType?: 'FISCAL_ITEM' | 'FINANCIAL_INCOME' | 'CAPITAL_GAIN' | 'OTHER_ADDITION' | undefined;
  adjustmentReason?: string | null | undefined;
  sourceIds: readonly string[];
}>;

export type CorporateTaxDeductionInput = Readonly<{
  tax: 'IRPJ' | 'CSLL';
  kind: 'WITHHOLDING' | 'ADVANCE_PAYMENT';
  amountCents: number;
  recognizedOn: string | null;
  evidenceId: string;
  ruleId: string;
  sourceIds?: readonly string[];
}>;

export type CorporateTaxComponent = Readonly<{
  tax: CorporateTaxKind;
  activityCode: string;
  revenueNatureCode: string;
  grossRevenueCents: number;
  adjustmentCents: number;
  presumptionRateScaled: string | null;
  presumedBaseCents: number | null;
  directAdditionCents: number;
  taxRateScaled: string | null;
  grossTaxCents: number | null;
  ruleId: string;
  sourceIds: readonly string[];
  calculationTrace: Readonly<{ formula: string; numerator: string; denominator: string; rounding: 'HALF_UP' }>;
}>;

export type CorporateTaxAssessmentCalculation = Readonly<{
  status: 'INDETERMINATE' | 'READY_FOR_REVIEW';
  components: readonly CorporateTaxComponent[];
  deductions: readonly CorporateTaxDeductionInput[];
  irpjPayableCents: number | null;
  csllPayableCents: number | null;
  gapCodes: readonly string[];
}>;

const QUARTER_MONTHS: Readonly<Record<string, readonly string[]>> = {
  '2026-Q1': ['2026-01', '2026-02', '2026-03'],
  '2026-Q2': ['2026-04', '2026-05', '2026-06'],
  '2026-Q3': ['2026-07', '2026-08', '2026-09'],
  '2026-Q4': ['2026-10', '2026-11', '2026-12'],
};
const isCents = (amount: number): boolean => Number.isSafeInteger(amount) && amount >= 0;
const civilDateBelongsToQuarter = (date: string | null, months: readonly string[] | undefined): boolean =>
  date !== null && /^\d{4}-\d{2}-\d{2}$/u.test(date) && months?.includes(date.slice(0, 7)) === true;
const asSafeNumber = (amount: bigint): number | null =>
  amount >= 0n && amount <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(amount) : null;

const blocked = (gapCodes: readonly string[], components: readonly CorporateTaxComponent[] = []): CorporateTaxAssessmentCalculation => ({
  status: 'INDETERMINATE', components, deductions: [], irpjPayableCents: null, csllPayableCents: null,
  gapCodes: [...new Set(gapCodes)].sort(),
});

/** Calcula somente com pacote aprovado; regra ausente ou ambígua nunca recebe fallback. */
export const calculateCorporateTaxAssessment = (input: Readonly<{
  quarter: string;
  recognition: CorporateTaxRecognition | null;
  recognitionOptionValid: boolean;
  regimeVerified: boolean;
  activityVerified: boolean;
  revenueReconciled: boolean;
  deductionsComplete: boolean;
  package: CorporateTaxRulePackage | null;
  revenue: readonly CorporateTaxRevenue[];
  deductions: readonly CorporateTaxDeductionInput[];
}>): CorporateTaxAssessmentCalculation => {
  const months = QUARTER_MONTHS[input.quarter];
  const gaps: string[] = [];
  if (!months) gaps.push('CORPORATE_TAX_QUARTER_UNSUPPORTED');
  if (!input.regimeVerified) gaps.push('CORPORATE_TAX_REGIME_MISMATCH');
  if (!input.activityVerified) gaps.push('CORPORATE_TAX_ACTIVITY_UNSUPPORTED');
  if (!input.revenueReconciled) gaps.push('CORPORATE_TAX_REVENUE_RECONCILIATION_FAILED');
  if (!input.recognition) gaps.push('CORPORATE_TAX_RECOGNITION_OPTION_MISSING');
  if (!input.recognitionOptionValid) gaps.push('CORPORATE_TAX_RECOGNITION_OPTION_CONFLICT');
  if (!input.package) gaps.push('CORPORATE_TAX_RULE_MISSING');
  if (input.revenue.length === 0) gaps.push('CORPORATE_TAX_REVENUE_MISSING');
  if (!input.deductionsComplete) gaps.push('CORPORATE_TAX_DEDUCTION_INVALID');
  if (input.revenue.some((item) => !item.id || !item.activityCode || !item.revenueNatureCode ||
      !months?.includes(item.month) || !isCents(item.grossCents) || !isCents(item.adjustmentCents) ||
      !isCents(item.directAdditionCents) || item.sourceIds.length === 0 || !item.lineType ||
      (item.adjustmentCents > 0 && !item.adjustmentReason) ||
      (item.lineType !== 'FISCAL_ITEM' && (item.sourceIds.length < 2 || item.directAdditionCents === 0)) ||
      (item.lineType === 'FISCAL_ITEM' && (!item.sourceIds.some((source) => !source.startsWith('evidence:') && !source.startsWith('rule:')) ||
        (item.grossCents === 0 && item.directAdditionCents > 0)))))
    gaps.push('CORPORATE_TAX_EVIDENCE_REQUIRED');
  if (input.revenue.some((item) => item.adjustmentCents > item.grossCents))
    gaps.push('CORPORATE_TAX_REVENUE_RECONCILIATION_FAILED');
  if (new Set(input.revenue.map((item) => item.id)).size !== input.revenue.length)
    gaps.push('CORPORATE_TAX_REVENUE_RECONCILIATION_FAILED');
  if (input.deductions.some((item) => !isCents(item.amountCents) || item.amountCents <= 0 ||
      !civilDateBelongsToQuarter(item.recognizedOn, months) || !item.evidenceId || !item.ruleId || !item.sourceIds?.length) ||
      new Set(input.deductions.map((item) => `${item.tax}:${item.evidenceId}:${item.ruleId}`)).size !== input.deductions.length)
    gaps.push('CORPORATE_TAX_DEDUCTION_INVALID');
  if (gaps.length) return blocked(gaps);

  const pkg = input.package;
  if (!pkg || !months) return blocked(['CORPORATE_TAX_RULE_MISSING']);
  const firstMonth = months[0];
  const lastMonth = months[2];
  if (!firstMonth || !lastMonth) return blocked(['CORPORATE_TAX_QUARTER_UNSUPPORTED']);
  const quarterEnd = `${lastMonth}-${String(new Date(Date.UTC(Number(lastMonth.slice(0, 4)), Number(lastMonth.slice(5, 7)), 0)).getUTCDate()).padStart(2, '0')}`;
  if (!pkg.approved || pkg.sourceIds.length === 0 || pkg.rounding !== 'HALF_UP' ||
      pkg.validFrom > `${firstMonth}-01` || (pkg.validThrough !== null && pkg.validThrough < quarterEnd))
    gaps.push('CORPORATE_TAX_RULE_MISSING');
  if (pkg.additionalIrpjRateScaled === null || pkg.additionalIrpjThresholdCentsByMonth === null ||
      !isCents(pkg.additionalIrpjThresholdCentsByMonth) || !pkg.additionalIrpjRuleId || pkg.additionalIrpjSourceIds.length === 0)
    gaps.push('CORPORATE_TAX_RULE_MISSING');
  const components: CorporateTaxComponent[] = [];
  type CorporateTaxGroup = { tax: 'IRPJ' | 'CSLL'; revenue: CorporateTaxRevenue[]; rule: CorporateTaxRule };
  const grouped = new Map<string, CorporateTaxGroup>();
  for (const item of input.revenue) {
    if (!item.id || !item.month) { gaps.push('CORPORATE_TAX_EVIDENCE_REQUIRED'); continue; }
    for (const tax of ['IRPJ', 'CSLL'] as const) {
      const monthEnd = `${item.month}-${String(new Date(Date.UTC(Number(item.month.slice(0, 4)), Number(item.month.slice(5, 7)), 0)).getUTCDate()).padStart(2, '0')}`;
      const candidates = pkg.rules.filter((rule) => rule.tax === tax && rule.activityCode === item.activityCode &&
        rule.revenueNatureCode === item.revenueNatureCode && rule.validFrom <= monthEnd &&
        (rule.validThrough === null || rule.validThrough >= `${item.month}-01`) && (() => {
          const basis = rule.revenueBasis ?? (rule.revenueMinimumCents === undefined && (rule.revenueMaximumCents === undefined || rule.revenueMaximumCents === null) ? 'LINE' : null);
          if (!basis || !months) return false;
          const relevant = input.revenue.filter((candidate) => candidate.activityCode === item.activityCode &&
            candidate.revenueNatureCode === item.revenueNatureCode && (basis === 'LINE' ? candidate.id === item.id :
              basis === 'MONTH' ? candidate.month === item.month : basis === 'QUARTER' ? months.includes(candidate.month) :
                candidate.month <= item.month && candidate.month.slice(0, 4) === item.month.slice(0, 4)));
          const periodRevenue = relevant.reduce((sum, candidate) => sum + BigInt(candidate.grossCents), 0n);
          return (rule.revenueMinimumCents === undefined || periodRevenue >= BigInt(rule.revenueMinimumCents)) &&
            (rule.revenueMaximumCents === undefined || rule.revenueMaximumCents === null || periodRevenue <= BigInt(rule.revenueMaximumCents));
        })());
      const applicable = candidates.filter((rule) => item.sourceIds.includes(`rule:${rule.id}`));
      if (candidates.length > 1 || applicable.length !== 1 || applicable[0]?.sourceIds.length === 0) {
        gaps.push(candidates.length > 1 ? 'CORPORATE_TAX_RULE_CONFLICT' : 'CORPORATE_TAX_REVENUE_NATURE_UNSUPPORTED');
        continue;
      }
      const rule = applicable[0];
      if (!rule) continue;
      const key = `${tax}:${item.activityCode}:${item.revenueNatureCode}:${rule.id}`;
      const group: CorporateTaxGroup = grouped.get(key) ?? { tax, revenue: [], rule };
      group.revenue.push(item);
      grouped.set(key, group);
    }
  }
  for (const group of grouped.values()) {
    const presumptionRate = parseScaledRate(group.rule.presumptionRateScaled);
    const taxRate = parseScaledRate(group.rule.taxRateScaled);
    if (presumptionRate === null || taxRate === null) { gaps.push('CORPORATE_TAX_RULE_MISSING'); continue; }
    const gross = group.revenue.reduce((sum, item) => sum + BigInt(item.grossCents), 0n);
    const adjustment = group.revenue.reduce((sum, item) => sum + BigInt(item.adjustmentCents), 0n);
    const additions = group.revenue.reduce((sum, item) => sum + BigInt(item.directAdditionCents), 0n);
    const netGross = gross >= adjustment ? gross - adjustment : 0n;
    const presumed = roundHalfUp(netGross * presumptionRate, CORPORATE_TAX_RATE_SCALE);
    const taxBase = presumed + additions;
    const grossTax = asSafeNumber(roundHalfUp(taxBase * taxRate, CORPORATE_TAX_RATE_SCALE));
    const safeGross = asSafeNumber(gross), safeAdjustment = asSafeNumber(adjustment), safePresumed = asSafeNumber(presumed), safeAdditions = asSafeNumber(additions);
    if ([grossTax, safeGross, safeAdjustment, safePresumed, safeAdditions].some((value) => value === null)) {
      gaps.push('CORPORATE_TAX_RULE_MISSING'); continue;
    }
    if (grossTax === null || safeGross === null || safeAdjustment === null || safePresumed === null || safeAdditions === null) continue;
    components.push({ tax: group.tax, activityCode: group.rule.activityCode, revenueNatureCode: group.rule.revenueNatureCode,
      grossRevenueCents: safeGross, adjustmentCents: safeAdjustment, presumptionRateScaled: group.rule.presumptionRateScaled,
      presumedBaseCents: safePresumed, directAdditionCents: safeAdditions, taxRateScaled: group.rule.taxRateScaled,
      grossTaxCents: grossTax, ruleId: group.rule.id, sourceIds: [...new Set(group.revenue.flatMap((item) => item.sourceIds).concat(group.rule.sourceIds))].sort(),
      calculationTrace: { formula: 'ROUND_HALF_UP(MAX(0,GROSS-ADJUSTMENT)*PRESUMPTION_RATE/SCALE)+DIRECT_ADDITION;ROUND_HALF_UP(BASE*TAX_RATE/SCALE)',
        numerator: `${netGross.toString()}*${presumptionRate.toString()};${taxBase.toString()}*${taxRate.toString()}`,
        denominator: `${CORPORATE_TAX_RATE_SCALE.toString()};${CORPORATE_TAX_RATE_SCALE.toString()}`, rounding: 'HALF_UP' } });
  }
  if (gaps.length) return blocked(gaps, components);

  const ordinaryIrpj = components.filter((item) => item.tax === 'IRPJ').reduce((sum, item) => sum + BigInt(item.grossTaxCents ?? 0), 0n);
  const csll = components.filter((item) => item.tax === 'CSLL').reduce((sum, item) => sum + BigInt(item.grossTaxCents ?? 0), 0n);
  const totalIrpjBase = components.filter((item) => item.tax === 'IRPJ').reduce((sum, item) => sum + BigInt(item.presumedBaseCents ?? 0) + BigInt(item.directAdditionCents), 0n);
  const thresholdCentsByMonth = pkg.additionalIrpjThresholdCentsByMonth;
  if (thresholdCentsByMonth === null) return blocked(['CORPORATE_TAX_RULE_MISSING'], components);
  const threshold = BigInt(thresholdCentsByMonth) * 3n;
  const additionalBase = totalIrpjBase > threshold ? totalIrpjBase - threshold : 0n;
  const additionalRateScaled = pkg.additionalIrpjRateScaled;
  const additionalRate = additionalRateScaled === null ? null : parseScaledRate(additionalRateScaled);
  if (additionalRate === null) return blocked(['CORPORATE_TAX_RULE_MISSING'], components);
  const additionalTax = asSafeNumber(roundHalfUp(additionalBase * additionalRate, CORPORATE_TAX_RATE_SCALE));
  if (additionalTax === null) return blocked(['CORPORATE_TAX_RULE_MISSING'], components);
  if (additionalBase > 0n) components.push({ tax: 'IRPJ_ADDITIONAL', activityCode: 'COMMERCE_AUTO_PARTS', revenueNatureCode: 'ADDITIONAL_BASE',
    grossRevenueCents: 0, adjustmentCents: 0, presumptionRateScaled: null, presumedBaseCents: asSafeNumber(additionalBase),
    directAdditionCents: 0, taxRateScaled: additionalRateScaled, grossTaxCents: additionalTax,
    ruleId: pkg.additionalIrpjRuleId ?? '', sourceIds: [...new Set([...pkg.additionalIrpjSourceIds, ...pkg.sourceIds])].sort(),
    calculationTrace: { formula: 'ROUND_HALF_UP(MAX(0,IRPJ_BASE-3*MONTHLY_THRESHOLD)*ADDITIONAL_RATE/SCALE)',
      numerator: `${additionalBase.toString()}*${additionalRate.toString()}`, denominator: CORPORATE_TAX_RATE_SCALE.toString(), rounding: 'HALF_UP' } });
  const irpjGross = ordinaryIrpj + BigInt(additionalTax);
  const irpjDeductions = input.deductions.filter((item) => item.tax === 'IRPJ').reduce((sum, item) => sum + BigInt(item.amountCents), 0n);
  const csllDeductions = input.deductions.filter((item) => item.tax === 'CSLL').reduce((sum, item) => sum + BigInt(item.amountCents), 0n);
  if (irpjDeductions > irpjGross || csllDeductions > csll) return blocked(['CORPORATE_TAX_DEDUCTION_INVALID'], components);
  const irpjPayable = asSafeNumber(irpjGross - irpjDeductions), csllPayable = asSafeNumber(csll - csllDeductions);
  if (irpjPayable === null || csllPayable === null) return blocked(['CORPORATE_TAX_RULE_MISSING'], components);
  return { status: 'READY_FOR_REVIEW', components, deductions: input.deductions, irpjPayableCents: irpjPayable,
    csllPayableCents: csllPayable, gapCodes: [] };
};
