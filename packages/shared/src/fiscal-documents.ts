import { z } from 'zod';

export const FISCAL_DOCUMENTS_QUEUE = 'fiscal-documents';
export const FISCAL_DOCUMENTS_DLQ = 'fiscal-documents-dead';
export const FISCAL_DOCUMENTS_JOB = 'process-staging';
export const FISCAL_DOCUMENTS_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: 'exponential' as const, delay: 1_000, jitter: 0.5 },
  removeOnComplete: { count: 500 },
  removeOnFail: false,
} as const;
export const FiscalDocumentCommandSchema = z.strictObject({
  tenantId: z.string().uuid(), companyId: z.string().uuid(), stagingId: z.string().uuid(), correlationId: z.string().min(8).max(128),
});
export type FiscalDocumentCommand = z.infer<typeof FiscalDocumentCommandSchema>;
