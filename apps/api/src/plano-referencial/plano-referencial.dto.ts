import { z } from 'zod';

export const consultaPlanoReferencialSchema = z.object({
  calendarYear: z.coerce.number().int().min(1900).max(2200),
  taxRegime: z.enum(['LUCRO_PRESUMIDO', 'SIMPLES_NACIONAL']),
  specialSituation: z.string().trim().min(1).max(80).optional(),
});

export const criarRascunhoReferencialSchema = z.object({
  calendarYear: z.number().int().min(1900).max(2200),
  taxRegime: z.enum(['LUCRO_PRESUMIDO', 'SIMPLES_NACIONAL']),
  specialSituation: z.string().trim().min(1).max(80).nullable(),
  packageId: z.string().trim().min(1).max(120),
});

export const atualizarDecisoesReferencialSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  decisions: z.array(z.object({
    accountCode: z.string().trim().min(1).max(120),
    centerCode: z.string().trim().min(1).max(120).nullable(),
    kind: z.enum(['MAPPED', 'NOT_APPLICABLE']),
    referenceCode: z.string().trim().min(1).max(120).nullable(),
    reason: z.string().trim().max(1000).nullable(),
  }).strict()).max(10000),
}).strict();

export const publicarReferencialSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
}).strict();
