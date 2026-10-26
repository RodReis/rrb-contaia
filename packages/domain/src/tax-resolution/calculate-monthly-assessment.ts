/**
 * Cálculo mensal de DAS (Anexo I) e ICMS próprio. O motor não contém valores
 * tributários: faixas, repartições, segregações, fórmulas e arredondamento
 * vêm exclusivamente de pacote normativo aprovado e versionado.
 */
export type MonthlyAssessmentKind = 'SIMPLES_NACIONAL_DAS' | 'LUCRO_PRESUMIDO_ICMS_DARE';
export type MonthlyAssessmentStatus = 'INDETERMINATE' | 'READY_FOR_REVIEW';

export type MonthlyTaxComponent = Readonly<{
  code: string;
  baseCents: number;
  rateScaled: string | null;
  amountCents: number | null;
  ruleId: string;
  sourceIds: readonly string[];
}>;

export type MonthlyAssessment = Readonly<{
  kind: MonthlyAssessmentKind;
  status: MonthlyAssessmentStatus;
  competence: string;
  rulePackageVersion: string | null;
  components: readonly MonthlyTaxComponent[];
  totalCents: number | null;
  gapCodes: readonly string[];
}>;

export type MonthlyAssessmentSource = Readonly<{
  id: string;
  cents: number;
}>;

export type SimpleRevenueSegment = Readonly<{
  code: string;
  cents: number;
  sourceIds: readonly string[];
}>;

export type SimpleBracket = Readonly<{
  id: string;
  minimumRbt12Cents: number;
  maximumRbt12Cents: number | null;
  nominalRateBasisPoints: number;
  deductionCents: number;
  distributionBasisPoints: Readonly<Record<string, number>>;
}>;

export type SimpleSegregation = Readonly<{
  code: string;
  taxParticipationBasisPoints: Readonly<Record<string, number>>;
}>;

export type SimpleRulePackage = Readonly<{
  version: string;
  approved: boolean;
  validFrom: string;
  validThrough: string | null;
  sourceIds: readonly string[];
  brackets: readonly SimpleBracket[];
  segregations: readonly SimpleSegregation[];
  rounding: 'HALF_UP';
}>;

export type SimpleAssessmentInput = Readonly<{
  competence: string;
  package: SimpleRulePackage | null;
  rbt12ByMonth: readonly Readonly<{ month: string; cents: number }> [];
  revenue: readonly SimpleRevenueSegment[];
  revenueReconciled: boolean;
  activityVerified: boolean;
  optionValid: boolean;
}>;

export type IcmsOwnRulePackage = Readonly<{
  version: string;
  approved: boolean;
  validFrom: string;
  validThrough: string | null;
  sourceIds: readonly string[];
  allowedOperations: readonly string[];
  rounding: 'HALF_UP';
}>;

export type IcmsOwnAdjustment = Readonly<{
  id: string;
  cents: number;
  effect: 'INCREASE_DUE' | 'REDUCE_DUE';
}>;

export type IcmsOwnAssessmentInput = Readonly<{
  competence: string;
  package: IcmsOwnRulePackage | null;
  debits: readonly MonthlyAssessmentSource[];
  credits: readonly MonthlyAssessmentSource[];
  estornos: readonly IcmsOwnAdjustment[];
  adjustments: readonly IcmsOwnAdjustment[];
  priorCreditCents: number | null;
  priorCreditProven: boolean;
  allOperationsCovered: boolean;
}>;

const isMonth = (value: string): boolean => /^\d{4}-(0[1-9]|1[0-2])$/u.test(value);
const isCents = (value: number): boolean => Number.isSafeInteger(value) && value >= 0;
const safe = (value: bigint): number | null =>
  value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
const RATE_SCALE = 100_000_000n;

const roundHalfUp = (numerator: bigint, denominator: bigint): bigint => {
  if (denominator <= 0n || numerator < 0n) throw new Error('razão monetária inválida');
  return (numerator * 2n + denominator) / (2n * denominator);
};

const blocked = (
  kind: MonthlyAssessmentKind,
  competence: string,
  gapCodes: readonly string[],
  rulePackageVersion: string | null = null,
  components: readonly MonthlyTaxComponent[] = [],
): MonthlyAssessment => ({
  kind,
  status: 'INDETERMINATE',
  competence,
  rulePackageVersion,
  components,
  totalCents: null,
  gapCodes: [...new Set(gapCodes)].sort(),
});

const packageGaps = (
  competence: string,
  pkg: Readonly<{ approved: boolean; validFrom: string; validThrough: string | null; sourceIds: readonly string[]; rounding: string }> | null,
): string[] => {
  if (!pkg) return ['MONTHLY_ASSESSMENT_RULE_MISSING'];
  const gaps: string[] = [];
  if (!pkg.approved) gaps.push('MONTHLY_ASSESSMENT_RULE_NOT_APPROVED');
  if (pkg.validFrom.slice(0, 7) > competence || (pkg.validThrough !== null && pkg.validThrough.slice(0, 7) < competence))
    gaps.push('MONTHLY_ASSESSMENT_RULE_NOT_APPLICABLE');
  if (pkg.sourceIds.length === 0) gaps.push('MONTHLY_ASSESSMENT_RULE_SOURCE_MISSING');
  if (pkg.rounding !== 'HALF_UP') gaps.push('MONTHLY_ASSESSMENT_ROUNDING_UNSUPPORTED');
  return gaps;
};

/** Cálculo do DAS Anexo I a partir de pacote curado; nunca escolhe uma regra. */
export const calculateMonthlySimpleAssessment = (input: SimpleAssessmentInput): MonthlyAssessment => {
  const kind: MonthlyAssessmentKind = 'SIMPLES_NACIONAL_DAS';
  const gaps: string[] = [];
  if (!isMonth(input.competence) || input.competence < '2026-09') gaps.push('MONTHLY_ASSESSMENT_COMPETENCE_OUT_OF_SCOPE');
  if (!input.optionValid) gaps.push('MONTHLY_ASSESSMENT_OPTION_UNPROVEN');
  if (!input.activityVerified) gaps.push('MONTHLY_ASSESSMENT_ACTIVITY_UNPROVEN');
  if (!input.revenueReconciled) gaps.push('MONTHLY_ASSESSMENT_REVENUE_RECONCILIATION_FAILED');
  if (!Array.isArray(input.rbt12ByMonth) || input.rbt12ByMonth.length !== 12) gaps.push('MONTHLY_ASSESSMENT_RBT12_INCOMPLETE');
  if (input.rbt12ByMonth.some((item) => !isMonth(item.month) || !isCents(item.cents)) ||
      new Set(input.rbt12ByMonth.map((item) => item.month)).size !== input.rbt12ByMonth.length)
    gaps.push('MONTHLY_ASSESSMENT_RBT12_INVALID');
  if (input.revenue.some((item) => !isCents(item.cents) || item.sourceIds.length === 0))
    gaps.push('MONTHLY_ASSESSMENT_REVENUE_SOURCE_MISSING');
  if (input.revenue.length === 0) gaps.push('MONTHLY_ASSESSMENT_DOCUMENT_GAP');

  if (gaps.some((gap) => ['MONTHLY_ASSESSMENT_COMPETENCE_OUT_OF_SCOPE', 'MONTHLY_ASSESSMENT_RBT12_INVALID'].includes(gap)))
    return blocked(kind, input.competence, gaps);

  const pkg = input.package;
  gaps.push(...packageGaps(input.competence, pkg));
  if (!pkg) return blocked(kind, input.competence, gaps);
  if (gaps.length > 0) return blocked(kind, input.competence, gaps, pkg.version);
  if (pkg.brackets.length === 0 || pkg.segregations.length === 0) gaps.push('MONTHLY_ASSESSMENT_RULE_COVERAGE_INCOMPLETE');

  const competenceYear = Number(input.competence.slice(0, 4));
  const competenceMonth = Number(input.competence.slice(5, 7));
  const expectedMonths = Array.from({ length: 12 }, (_, index) => {
    const monthOffset = competenceYear * 12 + competenceMonth - 1 - 12 + index;
    return `${Math.floor(monthOffset / 12).toString().padStart(4, '0')}-${(monthOffset % 12 + 1).toString().padStart(2, '0')}`;
  });
  if (input.rbt12ByMonth.length === 12 && expectedMonths.some((month) => !input.rbt12ByMonth.some((entry) => entry.month === month)))
    gaps.push('MONTHLY_ASSESSMENT_RBT12_INCOMPLETE');
  const rbt12 = input.rbt12ByMonth.reduce((sum, item) => sum + BigInt(item.cents), 0n);
  const rbt12Cents = safe(rbt12);
  if (rbt12Cents === null || rbt12Cents <= 0) gaps.push('MONTHLY_ASSESSMENT_RBT12_INVALID');
  const matchingBrackets = rbt12Cents === null ? [] : pkg.brackets.filter((item) =>
    item.minimumRbt12Cents <= rbt12Cents && (item.maximumRbt12Cents === null || rbt12Cents <= item.maximumRbt12Cents));
  const bracket = matchingBrackets[0];
  if (matchingBrackets.length !== 1) gaps.push('MONTHLY_ASSESSMENT_RULE_CONFLICT');

  const segments = new Map(pkg.segregations.map((item) => [item.code, item]));
  for (const revenue of input.revenue) {
    const segregation = segments.get(revenue.code);
    if (!segregation) gaps.push('MONTHLY_ASSESSMENT_SEGREGATION_UNCOVERED');
    else if (Object.values(segregation.taxParticipationBasisPoints).some((value) => !Number.isSafeInteger(value) || value < 0 || value > 10_000))
      gaps.push('MONTHLY_ASSESSMENT_RULE_CONFLICT');
  }
  if (bracket && (Object.values(bracket.distributionBasisPoints).reduce((sum, value) => sum + value, 0) !== 10_000 ||
      Object.values(bracket.distributionBasisPoints).some((value) => !Number.isSafeInteger(value) || value < 0 || value > 10_000) ||
      !Number.isSafeInteger(bracket.nominalRateBasisPoints) || bracket.nominalRateBasisPoints < 0 || bracket.nominalRateBasisPoints > 10_000 ||
      !isCents(bracket.deductionCents))) gaps.push('MONTHLY_ASSESSMENT_RULE_CONFLICT');
  if (bracket) {
    const packageTaxCodes = Object.keys(bracket.distributionBasisPoints).sort();
    for (const segregation of pkg.segregations) {
      if (JSON.stringify(Object.keys(segregation.taxParticipationBasisPoints).sort()) !== JSON.stringify(packageTaxCodes))
        gaps.push('MONTHLY_ASSESSMENT_RULE_COVERAGE_INCOMPLETE');
    }
  }
  if (gaps.length > 0 || !bracket || rbt12Cents === null) return blocked(kind, input.competence, gaps, pkg.version);

  // Alíquota efetiva = (RBT12 * nominal - parcela a deduzir) / RBT12.
  const effectiveNumerator = rbt12 * BigInt(bracket.nominalRateBasisPoints) - BigInt(bracket.deductionCents) * 10_000n;
  if (effectiveNumerator < 0n) return blocked(kind, input.competence, ['MONTHLY_ASSESSMENT_RULE_CONFLICT'], pkg.version);
  const divisor = rbt12 * 10_000n;
  const rateScaled = safe(roundHalfUp(effectiveNumerator * RATE_SCALE, divisor));
  if (rateScaled === null) return blocked(kind, input.competence, ['MONTHLY_ASSESSMENT_AMOUNT_OVERFLOW'], pkg.version);
  const components: MonthlyTaxComponent[] = [];
  for (const revenue of input.revenue) {
    const segregation = segments.get(revenue.code);
    if (!segregation) continue;
    const segmentNumerator = BigInt(revenue.cents) * effectiveNumerator;
    const segmentDenominator = divisor;
    const gross = roundHalfUp(segmentNumerator, segmentDenominator);
    for (const [taxCode, participation] of Object.entries(segregation.taxParticipationBasisPoints)) {
      const distribution = bracket.distributionBasisPoints[taxCode];
      if (distribution === undefined || !Number.isSafeInteger(distribution) || distribution < 0) {
        gaps.push('MONTHLY_ASSESSMENT_RULE_COVERAGE_INCOMPLETE');
        continue;
      }
      const amount = safe(roundHalfUp(gross * BigInt(participation) * BigInt(distribution), 100_000_000n));
      if (amount === null) return blocked(kind, input.competence, ['MONTHLY_ASSESSMENT_AMOUNT_OVERFLOW'], pkg.version);
      components.push({
        code: `${revenue.code}:${taxCode}`,
        baseCents: revenue.cents,
        rateScaled: rateScaled.toString(),
        amountCents: amount,
        ruleId: bracket.id,
        sourceIds: [...new Set([...pkg.sourceIds, ...revenue.sourceIds])].sort(),
      });
    }
  }
  if (gaps.length > 0) return blocked(kind, input.competence, gaps, pkg.version, components);
  const total = components.reduce((sum, item) => sum + BigInt(item.amountCents ?? 0), 0n);
  const totalCents = safe(total);
  if (totalCents === null) return blocked(kind, input.competence, ['MONTHLY_ASSESSMENT_AMOUNT_OVERFLOW'], pkg.version, components);
  return { kind, status: 'READY_FOR_REVIEW', competence: input.competence, rulePackageVersion: pkg.version, components,
    totalCents, gapCodes: [] };
};

/** Cálculo de ICMS próprio. Ajustes e operações precisam estar cobertos pelo pacote aprovado. */
export const calculateMonthlyOwnIcmsAssessment = (input: IcmsOwnAssessmentInput): MonthlyAssessment => {
  const kind: MonthlyAssessmentKind = 'LUCRO_PRESUMIDO_ICMS_DARE';
  const gaps: string[] = [];
  if (!isMonth(input.competence) || input.competence < '2026-09') gaps.push('MONTHLY_ASSESSMENT_COMPETENCE_OUT_OF_SCOPE');
  if (!input.priorCreditProven || input.priorCreditCents === null || !isCents(input.priorCreditCents)) gaps.push('MONTHLY_ASSESSMENT_PRIOR_CREDIT_UNPROVEN');
  if (!input.allOperationsCovered) gaps.push('MONTHLY_ASSESSMENT_OPERATION_UNCOVERED');
  for (const source of [...input.debits, ...input.credits, ...input.estornos, ...input.adjustments])
    if (!isCents(source.cents)) gaps.push('MONTHLY_ASSESSMENT_SOURCE_AMOUNT_INVALID');
  const pkg = input.package;
  gaps.push(...packageGaps(input.competence, pkg));
  if (!pkg) return blocked(kind, input.competence, gaps);
  if (pkg.allowedOperations.length === 0) gaps.push('MONTHLY_ASSESSMENT_RULE_COVERAGE_INCOMPLETE');
  if (gaps.length > 0) return blocked(kind, input.competence, gaps, pkg.version);

  const sum = (items: readonly MonthlyAssessmentSource[]) => items.reduce((total, item) => total + BigInt(item.cents), 0n);
  const effectSum = (items: readonly IcmsOwnAdjustment[], effect: IcmsOwnAdjustment['effect']) =>
    items.filter((item) => item.effect === effect).reduce((total, item) => total + BigInt(item.cents), 0n);
  const debits = sum(input.debits);
  const credits = sum(input.credits);
  const reversalsIncrease = effectSum(input.estornos, 'INCREASE_DUE');
  const reversalsReduce = effectSum(input.estornos, 'REDUCE_DUE');
  const adjustmentsIncrease = effectSum(input.adjustments, 'INCREASE_DUE');
  const adjustmentsReduce = effectSum(input.adjustments, 'REDUCE_DUE');
  const increases = effectSum([...input.estornos, ...input.adjustments], 'INCREASE_DUE');
  const reductions = effectSum([...input.estornos, ...input.adjustments], 'REDUCE_DUE');
  const prior = BigInt(input.priorCreditCents ?? 0);
  const net = debits + increases - credits - reductions - prior;
  const due = net > 0n ? net : 0n;
  const carry = net < 0n ? -net : 0n;
  const debitCents = safe(debits);
  const creditCents = safe(credits);
  const reversalIncreaseCents = safe(reversalsIncrease);
  const reversalReduceCents = safe(reversalsReduce);
  const adjustmentIncreaseCents = safe(adjustmentsIncrease);
  const adjustmentReduceCents = safe(adjustmentsReduce);
  const dueCents = safe(due);
  const carryCents = safe(carry);
  if ([debitCents, creditCents, reversalIncreaseCents, reversalReduceCents, adjustmentIncreaseCents, adjustmentReduceCents, dueCents, carryCents]
    .some((value) => value === null)) return blocked(kind, input.competence, ['MONTHLY_ASSESSMENT_AMOUNT_OVERFLOW'], pkg.version);
  const sourceIds = [...new Set([...pkg.sourceIds, ...input.debits.map((item) => item.id), ...input.credits.map((item) => item.id),
    ...input.estornos.map((item) => item.id), ...input.adjustments.map((item) => item.id)])].sort();
  const components: MonthlyTaxComponent[] = [
    { code: 'ICMS_DEBIT', baseCents: debitCents ?? 0, rateScaled: null, amountCents: debitCents, ruleId: 'ICMS_OWN_PACKAGE', sourceIds },
    { code: 'ICMS_CREDIT', baseCents: creditCents ?? 0, rateScaled: null, amountCents: creditCents, ruleId: 'ICMS_OWN_PACKAGE', sourceIds },
    { code: 'ICMS_ESTORNO_AUMENTA', baseCents: reversalIncreaseCents ?? 0, rateScaled: null, amountCents: reversalIncreaseCents, ruleId: 'ICMS_OWN_PACKAGE', sourceIds },
    { code: 'ICMS_ESTORNO_REDUZ', baseCents: reversalReduceCents ?? 0, rateScaled: null, amountCents: reversalReduceCents, ruleId: 'ICMS_OWN_PACKAGE', sourceIds },
    { code: 'ICMS_AJUSTE_AUMENTA', baseCents: adjustmentIncreaseCents ?? 0, rateScaled: null, amountCents: adjustmentIncreaseCents, ruleId: 'ICMS_OWN_PACKAGE', sourceIds },
    { code: 'ICMS_AJUSTE_REDUZ', baseCents: adjustmentReduceCents ?? 0, rateScaled: null, amountCents: adjustmentReduceCents, ruleId: 'ICMS_OWN_PACKAGE', sourceIds },
    { code: 'ICMS_SALDO_CREDOR_ANTERIOR', baseCents: input.priorCreditCents ?? 0, rateScaled: null, amountCents: input.priorCreditCents, ruleId: 'ICMS_OWN_PACKAGE', sourceIds },
    { code: 'ICMS_SALDO_CREDOR_TRANSPORTAVEL', baseCents: carryCents ?? 0, rateScaled: null, amountCents: carryCents, ruleId: 'ICMS_OWN_PACKAGE', sourceIds },
    { code: 'ICMS_PROPRIO_A_RECOLHER', baseCents: dueCents ?? 0, rateScaled: null, amountCents: dueCents, ruleId: 'ICMS_OWN_PACKAGE', sourceIds },
  ];
  return { kind, status: 'READY_FOR_REVIEW', competence: input.competence, rulePackageVersion: pkg.version,
    components, totalCents: dueCents === 0 ? null : dueCents, gapCodes: [] };
};
