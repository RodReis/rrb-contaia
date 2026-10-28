import { z } from 'zod';

const uuid = z.string().uuid();
const texto = (max: number) => z.string().trim().min(1).max(max);
const partida = z.object({
  lineId: uuid.optional(), accountId: uuid, side: z.enum(['DEBIT','CREDIT']), amountCents: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  costCenterId: uuid.nullable().default(null), memo: z.string().trim().max(240).nullable().default(null), position: z.number().int().nonnegative(),
});
export const rascunhoSchema = z.object({
  version: z.number().int().positive().optional(), accountingDate: z.string(), competence: z.string(), history: texto(500),
  externalReference: z.string().trim().max(240).nullable().default(null), lines: z.array(partida).max(500),
});
export const motivoSchema = z.object({ reason: texto(500), version: z.number().int().positive().optional() });
export const descarteSchema = z.object({ reason: texto(500), version: z.number().int().positive() });
export const efetivacaoSchema = z.object({ version: z.number().int().positive() });
export const estornoSchema = z.object({ accountingDate: z.string(), competence: z.string(), reason: texto(430) });
export const cancelamentoSchema = z.object({ reason: texto(500), version: z.number().int().positive() });
export const consultaLancamentosSchema = z.object({ competence: z.string().optional(), status: z.enum(['DRAFT','POSTED','DISCARDED','CANCELLED','REVERSED']).optional(), limit: z.coerce.number().int().min(1).max(200).default(50) });
export const idSchema = z.object({ id: uuid });
