import { z } from 'zod';

export const AUDIT_EXPORT_QUEUE = 'audit-export';
export const AUDIT_EXPORT_JOB = 'generate-audit-export';
export const AUDIT_EXPORT_EXPIRY_JOB = 'expire-audit-export';
export const AUDIT_EXPORT_TTL_MS = 24 * 60 * 60 * 1000;

export const AuditExportCommandSchema = z.strictObject({
  tenantId: z.string().uuid(), userId: z.string().uuid(), jobId: z.string().uuid(), correlationId: z.string().min(8).max(128),
});
export type AuditExportCommand = z.infer<typeof AuditExportCommandSchema>;

export const AuditExportExpiryCommandSchema = z.strictObject({
  tenantId: z.string().uuid(), userId: z.string().uuid(), jobId: z.string().uuid(), correlationId: z.string().min(8).max(128),
});
export type AuditExportExpiryCommand = z.infer<typeof AuditExportExpiryCommandSchema>;
