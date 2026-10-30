import { z } from 'zod';

const uuid=z.string().uuid();
export const openingIdSchema=z.object({id:uuid});
export const openingDraftSchema=z.object({baseDate:z.string(),lines:z.array(z.object({accountId:uuid,costCenterId:uuid.nullable().default(null),debitCents:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),creditCents:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),note:z.string().trim().max(500).nullable().default(null)})).max(10000),expectedRevision:z.number().int().positive(),source:z.enum(['MANUAL','CSV']).default('MANUAL')});
export const openingCreateSchema=openingDraftSchema.omit({expectedRevision:true});
export const openingCreateLineSchema=z.object({accountId:uuid,costCenterId:uuid.nullable().default(null),debitCents:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),creditCents:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),note:z.string().trim().max(500).nullable().default(null)});
export const openingApproveSchema=z.object({expectedRevision:z.number().int().positive(),expectedActiveVersion:z.number().int().positive().nullable(),replacementReason:z.string().trim().max(500).nullable()});
export const openingApproveInitialSchema=openingApproveSchema.extend({expectedActiveVersion:z.null(),replacementReason:z.null()});
export const openingApproveReplacementSchema=openingApproveSchema.extend({expectedActiveVersion:z.number().int().positive(),replacementReason:z.string().trim().min(1).max(500)});
export const openingCsvConfirmSchema=z.object({previewId:uuid,fileHash:z.string().regex(/^[a-f0-9]{64}$/u),expectedRevision:z.number().int().positive(),expectedPreviewRevision:z.number().int().positive()});
export const openingListSchema=z.object({});
