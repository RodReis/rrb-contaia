import { z } from 'zod';

const codigo = z.string().trim().min(1).max(120);
export const codigoCatalogoSchema = z.object({ codigo });
export const consultaCatalogoSchema = z.object({ cursor: z.string().trim().max(120).optional(), busca: z.string().trim().max(120).optional() });
export const camposDaContaSchema = z.object({
  code: codigo, name: z.string().trim().min(1).max(240), type: z.enum(['ANALYTICAL','SYNTHETIC']), parentCode: codigo.nullable(),
  accountClass: z.enum(['ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE','COMPENSATION','OTHER']).nullable(),
  normalBalance: z.enum(['DEBIT','CREDIT']), costCenterPolicy: z.enum(['REQUIRED','OPTIONAL','FORBIDDEN']),
  version: z.number().int().positive().optional().or(z.undefined()),
});
export const camposDoCentroSchema = z.object({
  code: codigo, name: z.string().trim().min(1).max(240), type: z.enum(['ANALYTICAL','SYNTHETIC']), parentCode: codigo.nullable(),
  version: z.number().int().positive().optional().or(z.undefined()),
});
export const versaoCatalogoSchema = z.object({ version: z.number().int().positive() });
export const historicoDoCatalogoSchema = z.object({ catalogo: z.enum(['CONTA','CENTRO_CUSTO']), codigo });
