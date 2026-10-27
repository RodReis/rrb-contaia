import { z } from 'zod';

const uuidPersistido = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu);
const competencia = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/u);
const dataCivil = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
});
const bps = z.number().int().min(0).max(10_000);
const codigo = z.string().trim().min(1).max(100);
const fonteId = z.string().trim().min(1).max(200);
const centavos = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const fonteFederalOficial = (value: string): boolean => {
  try { const url = new URL(value); return url.protocol === 'https:' && (url.hostname === 'gov.br' || url.hostname.endsWith('.gov.br')); }
  catch { return false; }
};

export const MonthlyAssessmentKindSchema = z.enum(['SIMPLES_NACIONAL_DAS', 'LUCRO_PRESUMIDO_ICMS_DARE', 'LUCRO_PRESUMIDO_PIS_COFINS']);
export const MonthlyRulePackageKindSchema = z.enum(['SIMPLES_NACIONAL_DAS', 'LUCRO_PRESUMIDO_ICMS_DARE',
  'LUCRO_PRESUMIDO_PIS_COFINS', 'PIS_COFINS_TRANSITION_2026']);
export const MonthlyAssessmentStatusSchema = z.enum([
  'DRAFT', 'INCOMPLETE', 'INDETERMINATE', 'READY_FOR_REVIEW', 'APPROVED', 'REJECTED', 'POSSIBLY_OUTDATED', 'SUPERSEDED',
]);

const distribuicao = z.record(codigo, bps).refine((value) => Object.values(value).reduce((sum, part) => sum + part, 0) === 10_000);
const participacao = z.record(codigo, bps);
const simpleBracket = z.strictObject({
  id: codigo,
  minimumRbt12Cents: centavos,
  maximumRbt12Cents: centavos.nullable(),
  nominalRateBasisPoints: bps,
  deductionCents: centavos,
  distributionBasisPoints: distribuicao,
});
const simpleSegregation = z.strictObject({ code: codigo, taxParticipationBasisPoints: participacao });
const icmsOperation = z.strictObject({
  id: codigo,
  cfops: z.array(z.string().regex(/^\d{4}$/u)).min(1).max(100),
  cstCsosn: z.array(z.string().regex(/^\d{2,3}$/u)).min(1).max(100),
  effect: z.enum(['DEBIT', 'CREDIT', 'EXCLUDED']),
  amountSource: z.enum(['DECLARED_ICMS', 'BASE_RATE']),
  rateBasisPoints: bps.nullable(),
}).superRefine((value, context) => {
  if ((value.amountSource === 'BASE_RATE') !== (value.rateBasisPoints !== null))
    context.addIssue({ code: 'custom', message: 'Alíquota é obrigatória somente para BASE_RATE.', path: ['rateBasisPoints'] });
});
const pisCofinsTreatment = z.strictObject({
  code: codigo,
  ncmCodes: z.array(z.string().regex(/^\d{8}$/u)).min(1).max(500),
  cfops: z.array(z.string().regex(/^\d{4}$/u)).min(1).max(100),
  cstCodes: z.array(z.string().regex(/^\d{2}$/u)).min(1).max(100),
  pisRateScaled: z.string().regex(/^\d+(?:\.\d{1,6})?$/u),
  cofinsRateScaled: z.string().regex(/^\d+(?:\.\d{1,6})?$/u),
  sourceIds: z.array(fonteId).min(1).max(20),
  requiredEvidenceKinds: z.array(codigo).min(1).max(30),
});
const pisCofinsTransitionPackage = z.strictObject({
  kind: z.literal('PIS_COFINS_TRANSITION_2026'), version: codigo, validFrom: dataCivil, validThrough: dataCivil.nullable(),
  consultedAt: dataCivil, officialBasis: z.string().trim().min(1).max(1000), sourceUrl: z.string().url().max(2000),
  offsetOrder: z.array(z.enum(['PIS_PASEP', 'COFINS'])).length(2).refine((value) => new Set(value).size === 2),
  maximumOffsets: z.strictObject({ PIS_PASEP: centavos, COFINS: centavos }),
  requiredEvidenceKinds: z.array(codigo).min(1).max(30), rounding: z.literal('HALF_UP'),
}).superRefine((value, context) => {
  if (value.validFrom < '2026-01-01' || (value.validThrough !== null && value.validThrough > '2026-12-31'))
    context.addIssue({ code: 'custom', message: 'Pacote de transição deve cobrir somente vigência de 2026.', path: ['validFrom'] });
});

export const MonthlyRulePackageSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('SIMPLES_NACIONAL_DAS'), version: codigo, validFrom: dataCivil, validThrough: dataCivil.nullable(),
    consultedAt: dataCivil, officialBasis: z.string().trim().min(1).max(1000), sourceUrl: z.string().url().max(2000),
    brackets: z.array(simpleBracket).length(6), segregations: z.array(simpleSegregation).min(1).max(100), rounding: z.literal('HALF_UP'),
  }).superRefine((value, context) => {
    const ordered = [...value.brackets].sort((left, right) => left.minimumRbt12Cents - right.minimumRbt12Cents);
    if (ordered[0]?.minimumRbt12Cents !== 0 || ordered.at(-1)?.maximumRbt12Cents !== null)
      context.addIssue({ code: 'custom', message: 'As seis faixas precisam cobrir do início ao limite aberto.', path: ['brackets'] });
    for (let index = 0; index < ordered.length; index += 1) {
      const current = ordered[index]!;
      const next = ordered[index + 1];
      if (current.maximumRbt12Cents !== null && current.maximumRbt12Cents < current.minimumRbt12Cents)
        context.addIssue({ code: 'custom', message: 'Limite máximo inferior ao mínimo da faixa.', path: ['brackets', index] });
      if (next && (current.maximumRbt12Cents === null || current.maximumRbt12Cents + 1 !== next.minimumRbt12Cents))
        context.addIssue({ code: 'custom', message: 'Faixas sobrepostas ou com lacuna.', path: ['brackets', index] });
    }
    if (new Set(value.brackets.map((item) => item.id)).size !== value.brackets.length ||
        new Set(value.segregations.map((item) => item.code)).size !== value.segregations.length)
      context.addIssue({ code: 'custom', message: 'Faixas e segregações precisam de identidades únicas.' });
    const taxCodes = Object.keys(value.brackets[0]?.distributionBasisPoints ?? {}).sort().join('|');
    if (value.brackets.some((item) => Object.keys(item.distributionBasisPoints).sort().join('|') !== taxCodes))
      context.addIssue({ code: 'custom', message: 'Todas as faixas precisam repartir os mesmos tributos.' });
  }),
  z.strictObject({
    kind: z.literal('LUCRO_PRESUMIDO_ICMS_DARE'), version: codigo, validFrom: dataCivil, validThrough: dataCivil.nullable(),
    consultedAt: dataCivil, officialBasis: z.string().trim().min(1).max(1000), sourceUrl: z.string().url().max(2000),
    operations: z.array(icmsOperation).min(1).max(500), rounding: z.literal('HALF_UP'),
    allowedAdjustments: z.array(z.strictObject({ id: codigo, effect: z.enum(['INCREASE_DUE', 'REDUCE_DUE']) })).max(200),
  }),
  z.strictObject({
    kind: z.literal('LUCRO_PRESUMIDO_PIS_COFINS'), version: codigo, validFrom: dataCivil, validThrough: dataCivil.nullable(),
    consultedAt: dataCivil, officialBasis: z.string().trim().min(1).max(1000), sourceUrl: z.string().url().max(2000),
    treatments: z.array(pisCofinsTreatment).min(1).max(500), rounding: z.literal('HALF_UP'),
  }).superRefine((value, context) => {
    if (value.validFrom < '2026-01-01' || (value.validThrough !== null && value.validThrough > '2026-12-31'))
      context.addIssue({ code: 'custom', message: 'Pacote F37 deve cobrir somente vigência de 2026.', path: ['validFrom'] });
    if (new Set(value.treatments.map((item) => item.code)).size !== value.treatments.length)
      context.addIssue({ code: 'custom', message: 'Tratamentos precisam de códigos únicos.', path: ['treatments'] });
  }),
  pisCofinsTransitionPackage,
]);
export type MonthlyRulePackageInput = z.infer<typeof MonthlyRulePackageSchema>;

export const MonthlyDeclarationSchema = z.strictObject({
  competence: competencia,
  kind: MonthlyAssessmentKindSchema,
  justification: z.string().trim().min(10).max(1000),
  declaration: z.record(z.string().trim().min(1).max(100), z.unknown()),
  evidence: z.array(z.strictObject({ kind: codigo, description: z.string().trim().min(1).max(1000) })).min(1).max(10),
  supersedesId: uuidPersistido.nullable().optional(),
});

export const PrepareMonthlyAssessmentSchema = z.strictObject({
  competence: competencia,
  kind: MonthlyAssessmentKindSchema,
  rulePackageId: uuidPersistido,
  transitionPackageId: uuidPersistido.nullable().optional(),
});

export const ReviewMonthlyAssessmentSchema = z.strictObject({
  action: z.enum(['APPROVED', 'REJECTED', 'RETURNED_FOR_EVIDENCE']),
  reason: z.string().trim().min(10).max(500),
  expectedHash: z.string().regex(/^[0-9a-f]{64}$/u),
});

export const MonthlyTaxComponentSchema = z.strictObject({
  code: codigo,
  baseCents: z.number().int().nonnegative(),
  rateScaled: z.string().regex(/^\d+(?:\.\d{1,6})?$/u).nullable(),
  amountCents: z.number().int().nonnegative().nullable(),
  ruleId: codigo,
  sourceIds: z.array(fonteId),
  contribution: z.enum(['PIS_PASEP', 'COFINS']).optional(),
  treatmentCode: codigo.optional(),
  grossAmountCents: z.number().int().nonnegative().nullable().optional(),
  transitionOffsetCents: z.number().int().nonnegative().optional(),
  netAmountCents: z.number().int().nonnegative().nullable().optional(),
});

export const MonthlyAssessmentSchema = z.strictObject({
  assessmentId: uuidPersistido,
  tenantId: uuidPersistido,
  companyId: uuidPersistido,
  competence: competencia,
  kind: MonthlyAssessmentKindSchema,
  status: MonthlyAssessmentStatusSchema,
  rulePackageVersion: codigo,
  transitionPackageVersion: codigo.nullable().optional(),
  revenueRecognition: z.enum(['ACCRUAL', 'CASH']).nullable().optional(),
  pisPayableCents: z.number().int().nonnegative().nullable().optional(),
  cofinsPayableCents: z.number().int().nonnegative().nullable().optional(),
  components: z.array(MonthlyTaxComponentSchema),
  totalCents: z.number().int().nonnegative().nullable(),
  gapCodes: z.array(codigo),
  preparedBy: uuidPersistido,
  approvedBy: uuidPersistido.nullable(),
  approvedAtUtc: z.string().datetime({ offset: true }).nullable(),
  contractVersion: z.string().min(1).max(50),
  canonicalJsonHash: z.string().regex(/^[0-9a-f]{64}$/u),
  revisionCreatedAtUtc: z.string().datetime({ offset: true }),
});

export const MonthlyAssessmentListQuerySchema = z.strictObject({
  competence: competencia.optional(),
  kind: MonthlyAssessmentKindSchema.optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(25),
});

const corporateTaxRule = z.strictObject({
  id: codigo,
  tax: z.enum(['IRPJ', 'CSLL']),
  activityCode: codigo,
  revenueNatureCode: codigo,
  revenueBasis: z.enum(['LINE', 'MONTH', 'QUARTER', 'YEAR_TO_DATE']).optional(),
  revenueMinimumCents: centavos.optional(),
  revenueMaximumCents: centavos.nullable().optional(),
  validFrom: dataCivil,
  validThrough: dataCivil.nullable(),
  presumptionRateScaled: z.string().regex(/^\d+(?:\.\d{1,8})?$/u),
  taxRateScaled: z.string().regex(/^\d+(?:\.\d{1,8})?$/u),
  taxCode: codigo,
  sourceIds: z.array(fonteId).min(1).max(20),
});
const corporateTaxDeductionRule = z.strictObject({
  id: codigo,
  tax: z.enum(['IRPJ', 'CSLL']),
  kind: z.enum(['WITHHOLDING', 'ADVANCE_PAYMENT']),
  evidenceKind: codigo,
  sourceIds: z.array(fonteId).min(1).max(20),
});

export const CorporateTaxRulePackageSchema = z.strictObject({
  version: codigo,
  validFrom: dataCivil,
  validThrough: dataCivil.nullable(),
  consultedAt: dataCivil,
  officialBasis: z.string().trim().min(1).max(1000),
  sourceUrl: z.string().url().max(2000).refine(fonteFederalOficial, 'A fonte normativa precisa usar HTTPS em domínio federal oficial.'),
  rules: z.array(corporateTaxRule).min(1).max(500),
  deductionRules: z.array(corporateTaxDeductionRule).max(200),
  additionalIrpjRateScaled: z.string().regex(/^\d+(?:\.\d{1,8})?$/u),
  additionalIrpjThresholdCentsByMonth: centavos,
  additionalIrpjRuleId: codigo,
  additionalIrpjSourceIds: z.array(fonteId).min(1).max(20),
  installmentTerms: z.strictObject({
    minimumPrincipalCents: centavos,
    maximumInstallments: z.number().int().min(1).max(3),
    additionRateScaled: z.string().regex(/^\d+(?:\.\d{1,8})?$/u),
    dueDates: z.array(z.strictObject({
      quarter: z.enum(['2026-Q1', '2026-Q2', '2026-Q3', '2026-Q4']),
      tax: z.enum(['IRPJ', 'CSLL']),
      installmentNumber: z.number().int().min(1).max(3),
      dueDate: dataCivil,
      additionRateScaled: z.string().regex(/^\d+(?:\.\d{1,8})?$/u),
      sourceIds: z.array(fonteId).min(1).max(20),
    })).min(8).max(24),
  }),
  rounding: z.literal('HALF_UP'),
}).superRefine((value, context) => {
  if (value.validFrom < '2026-01-01' || (value.validThrough !== null && value.validThrough > '2026-12-31') ||
      (value.validThrough !== null && value.validThrough < value.validFrom))
    context.addIssue({ code: 'custom', message: 'O pacote deve ter vigência válida dentro de 2026.', path: ['validFrom'] });
  const identities = value.rules.map((rule) => `${rule.tax}|${rule.activityCode}|${rule.revenueNatureCode}|${rule.revenueMinimumCents ?? 0}|${rule.revenueMaximumCents ?? ''}|${rule.validFrom}|${rule.validThrough ?? ''}`);
  if (new Set(identities).size !== identities.length)
    context.addIssue({ code: 'custom', message: 'Regras repetidas ou conflitantes no mesmo início de vigência.', path: ['rules'] });
  for (let index = 0; index < value.rules.length; index += 1) {
    const rule = value.rules[index]!;
    for (const candidate of value.rules.slice(index + 1)) {
      const sameRule = candidate.tax === rule.tax && candidate.activityCode === rule.activityCode && candidate.revenueNatureCode === rule.revenueNatureCode;
      const sameRange = (candidate.revenueMinimumCents ?? 0) === (rule.revenueMinimumCents ?? 0) &&
        (candidate.revenueMaximumCents ?? null) === (rule.revenueMaximumCents ?? null);
      const overlapsInTime = candidate.validFrom <= (rule.validThrough ?? value.validThrough ?? '2026-12-31') &&
        (candidate.validThrough === null || candidate.validThrough >= rule.validFrom);
      if (sameRule && sameRange && overlapsInTime)
        context.addIssue({ code: 'custom', message: 'Mesma faixa possui regras concorrentes na vigência.', path: ['rules', index] });
    }
  }
  for (const [index, rule] of value.rules.entries()) {
    if ((rule.revenueMinimumCents !== undefined || (rule.revenueMaximumCents !== undefined && rule.revenueMaximumCents !== null)) && !rule.revenueBasis)
      context.addIssue({ code: 'custom', message: 'Faixa de receita exige base de agregação explícita.', path: ['rules', index, 'revenueBasis'] });
    if (rule.validFrom < value.validFrom || (value.validThrough !== null && rule.validFrom > value.validThrough) ||
        (rule.validThrough !== null && rule.validThrough < rule.validFrom))
      context.addIssue({ code: 'custom', message: 'Vigência da regra fora do pacote ou inválida.', path: ['rules', index, 'validFrom'] });
    if (rule.revenueMaximumCents !== undefined && rule.revenueMaximumCents !== null && rule.revenueMaximumCents < (rule.revenueMinimumCents ?? 0))
      context.addIssue({ code: 'custom', message: 'Faixa de receita com limite máximo menor que o mínimo.', path: ['rules', index, 'revenueMaximumCents'] });
  }
  for (const [index, rule] of value.rules.entries()) {
    if (value.rules.some((candidate, candidateIndex) => candidateIndex !== index && candidate.tax === rule.tax && candidate.activityCode === rule.activityCode &&
      candidate.revenueNatureCode === rule.revenueNatureCode && candidate.validFrom <= (rule.validThrough ?? value.validThrough ?? '2026-12-31') &&
      (candidate.validThrough === null || candidate.validThrough >= rule.validFrom) &&
      (candidate.revenueMaximumCents === null || candidate.revenueMaximumCents === undefined || candidate.revenueMaximumCents >= (rule.revenueMinimumCents ?? 0)) &&
      (rule.revenueMaximumCents === null || rule.revenueMaximumCents === undefined || rule.revenueMaximumCents >= (candidate.revenueMinimumCents ?? 0))))
      context.addIssue({ code: 'custom', message: 'Faixas de regra se sobrepõem para atividade, natureza, tributo e vigência.', path: ['rules', index] });
  }
  const installmentKeys = value.installmentTerms.dueDates.map((item) => `${item.quarter}|${item.tax}|${item.installmentNumber}`);
  if (new Set(installmentKeys).size !== installmentKeys.length)
    context.addIssue({ code: 'custom', message: 'Datas de vencimento duplicadas para tributo, trimestre e quota.', path: ['installmentTerms', 'dueDates'] });
  if (value.installmentTerms.dueDates.some((item) => item.installmentNumber > value.installmentTerms.maximumInstallments))
    context.addIssue({ code: 'custom', message: 'Vencimento excede o parcelamento autorizado.', path: ['installmentTerms', 'dueDates'] });
  for (const quarter of ['2026-Q1', '2026-Q2', '2026-Q3', '2026-Q4'] as const) {
    for (const tax of ['IRPJ', 'CSLL'] as const) {
      for (let number = 1; number <= value.installmentTerms.maximumInstallments; number += 1) {
        if (!value.installmentTerms.dueDates.some((item) => item.quarter === quarter && item.tax === tax && item.installmentNumber === number))
          context.addIssue({ code: 'custom', message: 'Pacote sem vencimento comprovado para quota permitida.', path: ['installmentTerms', 'dueDates'] });
      }
    }
  }
  if (value.installmentTerms.dueDates.some((item) => item.dueDate < ({ '2026-Q1':'2026-04-01','2026-Q2':'2026-07-01','2026-Q3':'2026-10-01','2026-Q4':'2027-01-01' } as const)[item.quarter]))
    context.addIssue({ code: 'custom', message: 'Vencimento de quota anterior ao encerramento do trimestre.', path: ['installmentTerms','dueDates'] });
});

export const CorporateTaxDeclarationSchema = z.strictObject({
  quarter: z.enum(['2026-Q1', '2026-Q2', '2026-Q3', '2026-Q4']),
  recognition: z.enum(['ACCRUAL', 'CASH']).nullable(),
  recognitionOptionValid: z.boolean(),
  regimeVerified: z.boolean(),
  activityVerified: z.boolean(),
  revenueReconciled: z.boolean(),
  revenue: z.array(z.strictObject({
    id: codigo,
    activityCode: codigo,
    revenueNatureCode: codigo,
    month: competencia,
    grossCents: centavos,
    adjustmentCents: centavos,
    directAdditionCents: centavos,
    lineType: z.enum(['FISCAL_ITEM', 'FINANCIAL_INCOME', 'CAPITAL_GAIN', 'OTHER_ADDITION']),
    adjustmentReason: codigo.nullable(),
    ruleIds: z.array(codigo).length(2),
    sourceIds: z.array(z.string().trim().min(1).max(300)).min(1).max(200),
  })).max(5000),
  deductions: z.array(z.strictObject({
    tax: z.enum(['IRPJ', 'CSLL']),
    kind: z.enum(['WITHHOLDING', 'ADVANCE_PAYMENT']),
    amountCents: centavos,
    evidenceKind: codigo,
    evidenceIndex: z.number().int().nonnegative(),
    ruleId: codigo,
  })).max(500),
  evidence: z.array(z.strictObject({ kind: codigo, description: z.string().trim().min(1).max(1000), sourceReference: z.string().trim().min(1).max(300).nullable(),
    recognizedOn: dataCivil.nullable(), amountCents: centavos.nullable(), relatedFiscalSourceIds: z.array(z.string().trim().min(1).max(300)).max(100).optional() })).min(1).max(30),
  justification: z.string().trim().min(10).max(2000),
  supersedesId: uuidPersistido.nullable().optional(),
}).superRefine((value, context) => {
  const quarterMonths: Readonly<Record<string, readonly string[]>> = {
    '2026-Q1': ['2026-01', '2026-02', '2026-03'], '2026-Q2': ['2026-04', '2026-05', '2026-06'],
    '2026-Q3': ['2026-07', '2026-08', '2026-09'], '2026-Q4': ['2026-10', '2026-11', '2026-12'],
  };
  if (value.revenue.some((item) => !quarterMonths[value.quarter]?.includes(item.month)))
    context.addIssue({ code: 'custom', message: 'Receita fora do trimestre declarado.', path: ['revenue'] });
  if (value.deductions.some((item) => {
    const recognizedOn = value.evidence[item.evidenceIndex]?.recognizedOn;
    return recognizedOn === undefined || recognizedOn === null || !quarterMonths[value.quarter]?.includes(recognizedOn.slice(0, 7));
  })) context.addIssue({ code: 'custom', message: 'Dedução sem data comprovada no trimestre declarado.', path: ['deductions'] });
});

export const PrepareCorporateTaxAssessmentSchema = z.strictObject({
  quarter: z.enum(['2026-Q1', '2026-Q2', '2026-Q3', '2026-Q4']),
  recognition: z.enum(['ACCRUAL', 'CASH']),
  packageId: uuidPersistido,
  revenueDeclarationId: uuidPersistido,
  deductionEvidenceIds: z.array(uuidPersistido).max(500),
  installmentCount: z.number().int().min(1).max(3),
  idempotencyKey: z.string().uuid(),
});

export const ReviewCorporateTaxRulePackageSchema = z.strictObject({
  action: z.enum(['APPROVED', 'REJECTED']),
  reason: z.string().trim().min(10).max(1000),
});

export const ReviewCorporateTaxAssessmentSchema = z.strictObject({
  action: z.enum(['APPROVED', 'REJECTED', 'RETURNED']),
  justification: z.string().trim().min(10).max(2000),
  declarationsConfirmed: z.literal(true),
  localDraftsAcknowledged: z.literal(true),
  installmentCount: z.number().int().min(1).max(3),
  expectedHash: z.string().regex(/^[0-9a-f]{64}$/u),
});

export const CorporateTaxAssessmentSchema = z.strictObject({
  assessmentId: uuidPersistido,
  tenantId: uuidPersistido,
  companyId: uuidPersistido,
  quarter: z.enum(['2026-Q1', '2026-Q2', '2026-Q3', '2026-Q4']),
  revenueRecognition: z.enum(['ACCRUAL', 'CASH']),
  status: z.enum(['DRAFT','INCOMPLETE','INDETERMINATE','READY_FOR_REVIEW','APPROVED','REJECTED','POSSIBLY_OUTDATED','SUPERSEDED']),
  rulePackageVersion: codigo,
  components: z.array(z.strictObject({
    tax: z.enum(['IRPJ','IRPJ_ADDITIONAL','CSLL']), activityCode: codigo, revenueNatureCode: codigo, grossRevenueCents: centavos,
    adjustmentCents: centavos, presumptionRateScaled: z.string().nullable(), presumedBaseCents: centavos.nullable(), directAdditionCents: centavos,
    taxRateScaled: z.string().nullable(), grossTaxCents: centavos.nullable(), ruleId: codigo, sourceIds: z.array(fonteId),
    calculationTrace: z.strictObject({ formula: z.string().min(1), numerator: z.string().min(1), denominator: z.string().min(1), rounding: z.literal('HALF_UP') }),
  })),
  deductions: z.array(z.strictObject({ tax: z.enum(['IRPJ','CSLL']), kind: z.enum(['WITHHOLDING','ADVANCE_PAYMENT']),
    amountCents: centavos, evidenceId: uuidPersistido, ruleId: codigo, sourceIds: z.array(fonteId).min(1).max(20) })),
  installments: z.array(z.strictObject({ tax: z.enum(['IRPJ','CSLL']), installmentNumber: z.number().int().positive(),
    principalCents: centavos, additionCents: centavos, totalCents: centavos, dueDate: dataCivil, draftArtifactId: uuidPersistido,
    ruleSourceIds: z.array(fonteId), additionRateScaled: z.string(), ruleId: codigo })),
  draftArtifactIds: z.array(uuidPersistido),
  irpjPayableCents: centavos.nullable(), csllPayableCents: centavos.nullable(), installmentCount: z.number().int().min(1).max(3), gapCodes: z.array(codigo),
  preparedBy: uuidPersistido, approvedBy: uuidPersistido.nullable(), approvedAtUtc: z.string().datetime({ offset: true }).nullable(),
  contractVersion: z.string().min(1).max(50), revisionCreatedAtUtc: z.string().datetime({ offset: true }),
  revision: z.number().int().positive(), preparationJsonHash: z.string().regex(/^[0-9a-f]{64}$/u),
  canonicalJsonHash: z.string().regex(/^[0-9a-f]{64}$/u), reproduced: z.boolean().optional(),
});

export type CorporateTaxRulePackageInput = z.infer<typeof CorporateTaxRulePackageSchema>;
export type CorporateTaxDeclarationInput = z.infer<typeof CorporateTaxDeclarationSchema>;
export type ReviewCorporateTaxRulePackageInput = z.infer<typeof ReviewCorporateTaxRulePackageSchema>;
export type PrepareCorporateTaxAssessmentInput = z.infer<typeof PrepareCorporateTaxAssessmentSchema>;
export type ReviewCorporateTaxAssessmentInput = z.infer<typeof ReviewCorporateTaxAssessmentSchema>;
export type CorporateTaxAssessmentDto = z.infer<typeof CorporateTaxAssessmentSchema>;
