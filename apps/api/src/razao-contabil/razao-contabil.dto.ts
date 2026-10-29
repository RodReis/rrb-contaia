import { z } from 'zod';

const competencia = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const uuid = z.string().uuid();

export const consultaRazaoSchema = z.object({
  de: competencia,
  ate: competencia,
  contaId: uuid.optional(),
  centroId: z.union([uuid, z.literal('sem-centro'), z.literal('todos')]).optional(),
  lado: z.enum(['DEBIT', 'CREDIT']).optional(),
  busca: z.string().max(160).optional(),
  pagina: z.coerce.number().int().min(1).max(100_000).default(1),
  limite: z.coerce.number().int().min(1).max(100).default(50),
});

export const consultaBalanceteSchema = z.object({
  de: competencia,
  ate: competencia,
  centroId: z.union([uuid, z.literal('sem-centro'), z.literal('todos')]).optional(),
  somenteMovimento: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
});

export const resultadoReconstrucaoSchema = z.object({
  confirmacaoEmpresa: uuid,
  confirmacaoPeriodoDe: competencia,
  confirmacaoPeriodoAte: competencia,
});
export const movementIdSchema = z.object({ movementId: uuid });

export type ConsultaRazao = z.infer<typeof consultaRazaoSchema>;
export type ConsultaBalancete = z.infer<typeof consultaBalanceteSchema>;
