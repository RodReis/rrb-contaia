/**
 * Contratos públicos do catálogo e da simulação tributária (SPEC-016 §6.2).
 *
 * O cliente nunca envia estado, autor, total calculado nem expressão livre: `strictObject` recusa
 * qualquer campo fora do contrato. Dinheiro em centavos inteiros e percentuais em centésimos de
 * ponto percentual (I-3); datas civis `aaaa-mm-dd` (I-11).
 */
import { TAX_REGIMES, TAX_RULE_STATUSES, TAX_TYPES, lerDataCivil } from '@contaia/domain';
import type { TaxCalculationMemory, TaxRegime, TaxRuleStatus, TaxType } from '@contaia/domain';
import { z } from 'zod';

/**
 * Catálogo tipado de tipos de operação (SPEC-016 §3.1). São categorias de teste das fixtures da
 * F16, sem pretensão de refletir a legislação.
 */
export const TAX_OPERATION_TYPES = [
  'VENDA_MERCADORIA',
  'PRESTACAO_SERVICO',
  'COMPRA_INSUMO',
  'DEVOLUCAO_VENDA',
  'TRANSFERENCIA_ENTRE_ESTABELECIMENTOS',
] as const;
export type TaxOperationType = (typeof TAX_OPERATION_TYPES)[number];

const MAX_BASIS_POINTS = 10_000;
const MAX_TEXT = 500;
const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 25;

/** Só `aaaa-mm-dd` de um dia que existe: `lerDataCivil` também aceita `dd/mm/aaaa`, aqui recusada. */
const civilDate = z.string().refine((value) => lerDataCivil(value) === value, {
  message: 'Informe uma data civil existente no formato aaaa-mm-dd.',
});

const basisPoints = z.number().int().min(0).max(MAX_BASIS_POINTS);

const taxType = z.enum(TAX_TYPES);
const regime = z.enum(TAX_REGIMES);
const operationType = z.enum(TAX_OPERATION_TYPES);
const expectedVersion = z.number().int().min(1);

const validityOrder = <T extends { validFrom: string; validUntil: string | null }>(value: T): boolean =>
  value.validUntil === null || value.validUntil >= value.validFrom;

const VALIDITY_ISSUE = { path: ['validUntil'], message: 'A vigência final não pode ser anterior à inicial.' };

const editShape = {
  validFrom: civilDate,
  validUntil: civilDate.nullable(),
  baseReductionBasisPoints: basisPoints.nullable(),
  rateBasisPoints: basisPoints,
  source: z.string().trim().min(1).max(MAX_TEXT),
  fixtureNote: z.string().max(MAX_TEXT),
};

/** POST /tax-rules: cria um rascunho (e a próxima versão da identidade). */
export const CreateTaxRuleSchema = z
  .strictObject({ taxType, regime, operationType, ...editShape })
  .refine(validityOrder, VALIDITY_ISSUE);
export type CreateTaxRule = z.infer<typeof CreateTaxRuleSchema>;

/** PUT /tax-rules/:id: a identidade é fixa; só vigência, operação e fonte mudam. */
export const UpdateTaxRuleSchema = z
  .strictObject({ expectedVersion, ...editShape })
  .refine(validityOrder, VALIDITY_ISSUE);
export type UpdateTaxRule = z.infer<typeof UpdateTaxRuleSchema>;

/** POST /tax-rules/:id/publish e /archive: comando explícito com a versão esperada. */
export const TaxRuleCommandSchema = z.strictObject({ expectedVersion });
export type TaxRuleCommand = z.infer<typeof TaxRuleCommandSchema>;

/** GET /tax-rules: filtros e paginação. Os números chegam como texto na query string. */
export const ListTaxRulesQuerySchema = z.strictObject({
  taxType: taxType.optional(),
  regime: regime.optional(),
  operationType: operationType.optional(),
  status: z.enum(TAX_RULE_STATUSES).optional(),
  validOn: civilDate.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});
export type ListTaxRulesQuery = z.infer<typeof ListTaxRulesQuerySchema>;

/** POST /tax-simulations/manual: sem regra, alíquota ou fórmula vindas do navegador. */
export const ManualTaxSimulationSchema = z.strictObject({
  factDate: civilDate,
  regime,
  taxType,
  operationType,
  baseCents: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
});
export type ManualTaxSimulation = z.infer<typeof ManualTaxSimulationSchema>;

/**
 * Leiaute de NF-e aceito (SPEC-016 §3.6, §14): fixado de forma explícita, sem compatibilidade
 * silenciosa. A SPEC fixa a NT 2025.002 v1.50; existe versão mais nova (v1.51), e adotá-la exige
 * fixture, parser e testes próprios, por decisão do PI.
 */
export const NFE_RTC_LAYOUT = { nt: '2025.002', ntVersion: '1.50', nfeVersion: '4.00' } as const;

/** Limite do upload do XML, explícito no contrato (SPEC-016 §3.6, PLAN-016 tarefa 5). */
export const LIMITE_DA_NFE_BYTES = 2 * 1024 * 1024;

/** A NF-e numera os itens de 1 a 990. */
const MAX_NFE_ITEMS = 990;

/**
 * Complemento de simulação por NF-e (multipart, campo `complemento`): só o que o XML não traz ou
 * não mapeia de forma inequívoca. O tipo de operação nunca vem do XML. A data do fato é a emissão
 * do documento e a alíquota é a da regra publicada: nenhuma das duas é aceita do navegador.
 */
export const NfeComplementSchema = z.strictObject({
  operationType,
  regime: regime.optional(),
  itemBases: z
    .record(
      z.string().regex(/^[1-9]\d{0,2}$/u).refine((item) => Number(item) <= MAX_NFE_ITEMS),
      z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    )
    .optional(),
});
export type NfeComplement = z.infer<typeof NfeComplementSchema>;

/** Valor declarado no XML: o percentual fica como texto (exibição) e o valor, em centavos. */
export type NfeDeclaredTaxDto = Readonly<{ ratePercent: string | null; valueCents: number }>;

export type NfeItemExtractionDto = Readonly<{
  number: number;
  productCents: number;
  /** `null` = o item não traz o grupo IBS/CBS; a ausência fica explícita. */
  ibsCbs: Readonly<{
    baseCents: number;
    ibsUf: NfeDeclaredTaxDto | null;
    ibsMun: NfeDeclaredTaxDto | null;
    cbs: NfeDeclaredTaxDto | null;
  }> | null;
}>;

export type NfeExtractionDto = Readonly<{
  layout: typeof NFE_RTC_LAYOUT;
  /** Data civil da emissão: o fato gerador da simulação. */
  issueDate: string;
  /** `null` quando o CRT não mapeia de forma inequívoca para um regime do catálogo. */
  regime: TaxRegime | null;
  items: readonly NfeItemExtractionDto[];
  declaredTotals: Readonly<{ ibsCents: number | null; cbsCents: number | null }> | null;
}>;

export type NfeComplementRequiredDto = Readonly<{
  field: 'operationType' | 'regime' | `itemBases.${number}`;
  reason: 'NOT_IN_XML' | 'AMBIGUOUS_IN_XML';
}>;

/** Calculado × declarado, sem dizer qual é juridicamente correto. */
export type NfeComparisonDto = Readonly<{
  declaredCents: number;
  calculatedCents: number;
  differenceCents: number;
  diverges: boolean;
}>;

export type NfeTaxLineDto = Readonly<{
  taxType: 'IBS_UF' | 'IBS_MUN' | 'CBS';
  simulation: TaxSimulationResultDto;
  comparison: NfeComparisonDto | null;
}>;

export type NfeItemResultDto = Readonly<{ number: number; baseCents: number; taxes: readonly NfeTaxLineDto[] }>;

export type NfeSimulationResultDto = Readonly<{
  items: readonly NfeItemResultDto[];
  totals: Readonly<{
    calculated: Readonly<{ ibsUfCents: number; ibsMunCents: number; ibsCents: number; cbsCents: number }>;
    ibs: NfeComparisonDto | null;
    cbs: NfeComparisonDto | null;
  }>;
}>;

/** Resposta de POST /tax-simulations/nfe: extração sempre; resultado só sem complemento pendente. */
export type NfeSimulationDto = Readonly<{
  extraction: NfeExtractionDto;
  complementsRequired: readonly NfeComplementRequiredDto[];
  result: NfeSimulationResultDto | null;
}>;

/** Versão de regra como a API a devolve: instantes em ISO 8601 UTC, datas civis em texto. */
export type TaxRuleVersionDto = Readonly<{
  id: string;
  taxRuleId: string;
  versionNumber: number;
  /** Versão otimista: devolvida em `expectedVersion` no próximo comando. */
  lockVersion: number;
  status: TaxRuleStatus;
  taxType: TaxType;
  regime: TaxRegime;
  operationType: string;
  validFrom: string;
  validUntil: string | null;
  baseReductionBasisPoints: number | null;
  rateBasisPoints: number;
  source: string;
  fixtureNote: string;
  createdBy: string;
  createdAt: string;
  publishedAt: string | null;
  archivedAt: string | null;
}>;

export type TaxRulePageDto = Readonly<{
  items: readonly TaxRuleVersionDto[];
  total: number;
  page: number;
  pageSize: number;
  /**
   * Só o administrador da plataforma cria, edita, publica e arquiva (SPEC-016 §3.7). A tela usa
   * isto para não oferecer ação que a API recusaria; a decisão continua sendo da API.
   */
  canAdminister: boolean;
}>;

/** Resultado de qualquer simulação: a regra escolhida e a memória de cálculo reproduzível. */
export type TaxSimulationResultDto = Readonly<{
  rule: Readonly<{
    id: string;
    versionNumber: number;
    taxType: TaxType;
    regime: TaxRegime;
    operationType: string;
    validFrom: string;
    validUntil: string | null;
    source: string;
    fixtureNote: string;
  }>;
  memory: TaxCalculationMemory;
}>;

const taxPackageSourceSchema = z.strictObject({
  id: z.string().trim().min(1).max(120), authority: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(500), url: z.string().url().max(2000),
  provision: z.string().trim().min(1).max(500), publishedOn: civilDate, consultedOn: civilDate,
  validFrom: civilDate, validUntil: civilDate.nullable(),
});
const taxPackageRuleSchema = z.strictObject({
  id: z.string().trim().min(1).max(120), taxType, regime: z.enum(['SIMPLES_NACIONAL','LUCRO_PRESUMIDO']),
  operationType: z.enum(['COMPRA_INTERNA_REVENDA','COMPRA_INTERESTADUAL_REVENDA']),
  cfop: z.array(z.string().regex(/^\d{4}$/u)).min(1).max(100),
  ncm: z.array(z.string().regex(/^\d{8}$/u)).min(1).max(500),
  cest: z.array(z.string().regex(/^\d{7}$/u)).min(1).max(500).optional(),
  cst: z.array(z.string().regex(/^\d{2,3}$/u)).min(1).max(50),
  validFrom: civilDate, validUntil: civilDate.nullable(),
  treatment: z.enum(['APPLICABLE','NOT_APPLICABLE']),
  creditEligibility: z.enum(['ALLOWED','BLOCKED','NOT_RELEVANT']),
  sourceIds: z.array(z.string().trim().min(1).max(120)).min(1).max(50),
  rationale: z.string().trim().min(1).max(2000),
  liabilityKind: z.enum(['ICMS_ST_RECIPIENT_DUE','ICMS_ENTRY_ADVANCE','ICMS_ST_JOINT_LIABILITY']).optional(),
  relation: z.enum(['EXCLUSIVE','ALTERNATIVE','COEXISTENT']).optional(),
  taxSegment: z.literal('AUTO_PARTS').optional(),
  legalDescription: z.string().trim().min(1).max(1000).optional(),
  originStates: z.array(z.string().regex(/^[A-Z]{2}$/u)).min(1).max(27).optional(),
  calculationMethod: z.enum(['MVA_ORIGINAL','MVA_ADJUSTED']).optional(),
  mvaBasisPoints: z.number().int().nonnegative().nullable().optional(),
  internalRateBasisPoints: z.number().int().min(0).max(9999).nullable().optional(),
  interstateRateBasisPoints: z.number().int().min(0).max(9999).nullable().optional(),
  rounding: z.literal('HALF_UP').optional(),
  formulaVersion: z.string().trim().min(1).max(80).optional(),
  dueDate: civilDate.nullable().optional(),
  revenueCode: z.string().trim().min(1).max(40).nullable().optional(),
}).superRefine((rule, context) => {
  if (rule.taxType === 'ICMS' && rule.cest !== undefined && rule.cest.length === 0) {
    context.addIssue({ code: 'custom', message: 'Regra ICMS com seletor CEST exige combinação explícita.', path: ['cest'] });
  }
  if (rule.liabilityKind !== undefined && rule.taxType !== 'ICMS') {
    context.addIssue({ code: 'custom', message: 'Obrigação histórica F28 só aceita ICMS.', path: ['taxType'] });
  }
  if (rule.liabilityKind !== undefined && (rule.validUntil === null || rule.validUntil > '2018-02-28')) {
    context.addIssue({ code: 'custom', message: 'Regra F28 deve terminar até 28/02/2018.', path: ['validUntil'] });
  }
  if (rule.liabilityKind !== undefined && rule.calculationMethod === 'MVA_ADJUSTED' && rule.interstateRateBasisPoints === undefined) {
    context.addIssue({ code: 'custom', message: 'MVA ajustada exige alíquota interestadual versionada.', path: ['interstateRateBasisPoints'] });
  }
});
const taxPackageFixtureFactsSchema = z.strictObject({
  factDate: civilDate.nullable(), regime: z.enum(['SIMPLES_NACIONAL','LUCRO_PRESUMIDO']).nullable(),
  originUf: z.string().length(2).nullable(), destinationUf: z.string().length(2).nullable(),
  documentModel: z.string().min(1).max(10), authorized: z.boolean(),
  operationType: z.enum(['COMPRA_INTERNA_REVENDA','COMPRA_INTERESTADUAL_REVENDA']).nullable(),
  purpose: z.string().nullable(), cfop: z.string().regex(/^\d{4}$/u).nullable(),
  ncm: z.string().regex(/^\d{8}$/u).nullable(), cst: z.string().regex(/^\d{2,3}$/u).nullable(),
  cest: z.string().regex(/^\d{7}$/u).nullable().optional(),
  hasSubstitutionTax: z.boolean().nullable(), isImport: z.boolean().nullable(), isMonophase: z.boolean().nullable(),
  hasUnmodeledBenefit: z.boolean().nullable(), isReturnOrTransfer: z.boolean().nullable(),
  declaredCents: z.number().int().nonnegative().nullable(),
});
const historicalIcmsFixtureFactsSchema = z.strictObject({
  factDate: civilDate.nullable(), regime: z.enum(['SIMPLES_NACIONAL','LUCRO_PRESUMIDO']).nullable(),
  documentModel: z.string().min(1).max(10), authorized: z.boolean(), purpose: z.string().nullable(),
  originUf: z.string().length(2).nullable(), destinationUf: z.string().length(2).nullable(),
  operationType: z.enum(['COMPRA_INTERNA_REVENDA','COMPRA_INTERESTADUAL_REVENDA']).nullable(),
  cfop: z.string().regex(/^\d{4}$/u).nullable(), ncm: z.string().regex(/^\d{8}$/u).nullable(), cest: z.string().regex(/^\d{7}$/u).nullable(),
  cst: z.string().regex(/^\d{2,3}$/u).nullable(),
  hasValidRetention: z.boolean().nullable(), operationAmountCents: z.number().int().nonnegative().nullable(),
  freightAmountCents: z.number().int().nonnegative().nullable(), insuranceAmountCents: z.number().int().nonnegative().nullable(),
  otherExpensesAmountCents: z.number().int().nonnegative().nullable(), discountAmountCents: z.number().int().nonnegative().nullable(),
  ownIcmsAmountCents: z.number().int().nonnegative().nullable(),
});

export const CuratedTaxPackageSchema = z.strictObject({
  schemaVersion: z.literal(1), packageId: z.string().trim().min(1).max(120),
  semanticVersion: z.string().regex(/^\d+\.\d+\.\d+$/u), jurisdiction: z.enum(['BR','GO']),
  regimes: z.array(z.enum(['SIMPLES_NACIONAL','LUCRO_PRESUMIDO'])).min(1).max(2),
  document: z.strictObject({ model: z.literal('55'), direction: z.literal('ENTRY'), purpose: z.literal('RESALE') }),
  operations: z.array(z.enum(['COMPRA_INTERNA_REVENDA','COMPRA_INTERESTADUAL_REVENDA'])).min(1).max(2),
  validFrom: civilDate, validUntil: civilDate.nullable(), consultedOn: civilDate,
  coverage: z.array(z.string().trim().min(1).max(200)).min(1).max(100),
  exclusions: z.array(z.string().trim().min(1).max(200)).min(1).max(100),
  sources: z.array(taxPackageSourceSchema).min(1).max(500),
  rules: z.array(taxPackageRuleSchema).max(20000),
  fixtures: z.array(z.strictObject({
    id: z.string().min(1).max(120), ruleId: z.string().min(1).max(120),
    taxType, facts: taxPackageFixtureFactsSchema,
    expected: z.enum(['APPLICABLE','NOT_APPLICABLE','INDETERMINATE']),
    liabilityKind: z.enum(['ICMS_ST_RECIPIENT_DUE','ICMS_ENTRY_ADVANCE','ICMS_ST_JOINT_LIABILITY']).optional(),
    historicalFacts: historicalIcmsFixtureFactsSchema.optional(), expectedAmountCents: z.number().int().nonnegative().nullable().optional(),
  })).max(5000),
}).refine((pkg) => pkg.rules.length === 0 || pkg.fixtures.length > 0, {
  message: 'Pacote com regras executáveis exige fixtures de conformidade.',
  path: ['fixtures'],
});
export type CuratedTaxPackageInput = z.infer<typeof CuratedTaxPackageSchema>;
