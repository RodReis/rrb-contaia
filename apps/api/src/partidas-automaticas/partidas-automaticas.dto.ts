import { z } from 'zod';

const criterio = z.object({ field: z.string().regex(/^[a-z][a-zA-Z0-9.]{0,119}$/u), operator: z.enum(['EQ','IN','GTE','LTE','EXPLICIT_ANY']), value: z.union([z.string(),z.array(z.string()).min(1),z.null()]) });
export const familiaOrigemSchema = z.enum(['DFE','TAX_ASSESSMENT']);
const alocacao = z.object({ costCenterId: z.string().uuid(), percentageBasisPoints: z.number().int().min(1).max(10000), position: z.number().int().nonnegative() });
const linha = z.object({ side: z.enum(['DEBIT','CREDIT']), accountId: z.string().uuid(), amountExpression: z.string().trim().min(1).max(160), allocation: z.array(alocacao).max(100), position: z.number().int().nonnegative() });
export const regraSchema = z.object({ name: z.string().trim().min(1).max(160), source: z.enum(['DFE','TAX_ASSESSMENT']), validFrom: z.string().date(), validUntil: z.string().date().nullable(), criteria: z.array(criterio).min(1).max(100), lines: z.array(linha).min(2).max(200) });
export const consultaRegraSchema = z.object({ source: z.enum(['DFE','TAX_ASSESSMENT']).optional(), status: z.enum(['DRAFT','PUBLISHED','SUPERSEDED','ARCHIVED']).optional() });
export const idRegraSchema = z.object({ id: z.string().uuid() });
export const simularRegraSchema = z.object({ sourceType: z.enum(['DFE','TAX_ASSESSMENT']), sourceId: z.string().uuid() });
export const gerarOrigemSchema = simularRegraSchema;
