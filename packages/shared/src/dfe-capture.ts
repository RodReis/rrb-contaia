import { z } from 'zod';

export const DFE_CAPTURE_QUEUE = 'dfe-capture';
export const DFE_CAPTURE_DLQ = 'dfe-capture-dead';
export const DFE_CAPTURE_JOB = 'capture';
export const DFE_CAPTURE_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 1_000, jitter: 0.5 },
  removeOnComplete: { count: 100 },
  removeOnFail: false,
} as const;
export const DFE_CAPTURE_REPEAT_ID = 'dfe-capture-scheduler';
export const DFE_CAPTURE_SCAN_INTERVAL_MS = 60_000;
export const DFE_CAPTURE_TENANT_INTERVAL_MS = 60_000;
export const DFE_CAPTURE_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

const id = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu);
const correlationId = z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/u);
const cnpj = z.string().regex(/^\d{14}$/u);
const nsu = z.string().regex(/^\d{1,15}$/u);

export const DfeCaptureCommandSchema = z.strictObject({
  tenantId: id,
  companyId: id,
  cnpj,
  origin: z.enum(['AUTOMATIC', 'MANUAL']),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/u),
  correlationId,
  originatingUserId: id.optional(),
});
export type DfeCaptureCommand = z.infer<typeof DfeCaptureCommandSchema>;

export const DfeDistributionCommandSchema = z.strictObject({
  tenantId: id,
  companyId: id,
  cnpj,
  lastNsu: nsu,
  limit: z.literal(50),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/u),
  correlationId,
  originatingUserId: id.optional(),
});
export type DfeDistributionCommand = z.infer<typeof DfeDistributionCommandSchema>;

export const DfeDistributionItemSchema = z.strictObject({
  nsu,
  accessKey: z.string().regex(/^\d{44}$/u).nullable(),
  kind: z.enum(['NFE_55', 'CTE']),
  rawContent: z.string().min(1).max(2 * 1024 * 1024),
  availableAt: z.iso.datetime().optional(),
});

export const DfeDistributionResponseSchema = z.strictObject({
  status: z.enum(['SUCCESS', 'NO_DOCUMENTS', 'CONSUMO_INDEVIDO']),
  lastNsu: nsu,
  maxNsu: nsu,
  averageTimeMs: z.number().int().min(0).max(86_400_000),
  retryAt: z.iso.datetime().nullable(),
  providerCode: z.string().max(32),
  items: z.array(DfeDistributionItemSchema).max(50),
}).superRefine((value, context) => {
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > DFE_CAPTURE_MAX_RESPONSE_BYTES) {
    context.addIssue({ code: 'custom', message: 'Resposta de distribuição excede o limite de transporte.' });
  }
});
export type DfeDistributionResponse = z.infer<typeof DfeDistributionResponseSchema>;

export type DfeCaptureSummary = Readonly<{
  state: 'READY' | 'WAITING' | 'CAPTURING' | 'BLOCKED_656' | 'FAILED' | 'DISABLED';
  lastNsu: string;
  maxNsu: string;
  averageTimeMs: number;
  nextAllowedAt: string;
  blockedUntil: string | null;
  consecutiveFailures: number;
  lastSuccessAt: string | null;
  lastErrorCode: string | null;
}>;
