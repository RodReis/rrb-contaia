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
