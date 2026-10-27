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
