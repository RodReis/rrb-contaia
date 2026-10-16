import { z } from 'zod';

export const FISCAL_RISK_QUEUE = 'fiscal-risk';
export const FISCAL_RISK_DLQ = 'fiscal-risk-dead';
export const FISCAL_RISK_JOB = 'classify-document';
export const FISCAL_RISK_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 1_000 },
  removeOnComplete: { count: 100 },
  removeOnFail: false,
} as const;

export const TIPOS_DE_PROPOSTA_FISCAL = ['210200', '210220', '210240', 'ABSTER_SE'] as const;
export const SEVERIDADES_DE_RISCO_FISCAL = ['baixa', 'media', 'alta'] as const;

const ReferenciaFiscalSchema = z.string().trim().min(1).max(256);
const RiscoFiscalSchema = z.strictObject({
  codigo: z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/u),
  severidade: z.enum(SEVERIDADES_DE_RISCO_FISCAL),
  evidencias: z.array(ReferenciaFiscalSchema).max(50),
});

export const PropostaDeManifestacaoSchema = z.strictObject({
  tipo_manifestacao: z.enum(TIPOS_DE_PROPOSTA_FISCAL),
  confianca: z.number().finite().min(0).max(1),
  justificativa: z.string().trim().min(1).max(2_000),
  riscos: z.array(RiscoFiscalSchema).max(100),
  evidencias: z.array(ReferenciaFiscalSchema).max(100),
  lacunas: z.array(ReferenciaFiscalSchema).max(100),
});
export type PropostaDeManifestacao = z.infer<typeof PropostaDeManifestacaoSchema>;

export const FiscalRiskCommandSchema = z.strictObject({
  tenantId: z.string().uuid(),
  companyId: z.string().uuid(),
  documentId: z.string().uuid(),
  configurationId: z.string().uuid(),
  executionId: z.string().uuid(),
  correlationId: z.string().min(8).max(128),
});
export type FiscalRiskCommand = z.infer<typeof FiscalRiskCommandSchema>;

export const FISCAL_RISK_API_QUEUE = 'FISCAL_RISK_API_QUEUE';
