import { z } from 'zod';

import { CATALOGO_DE_PODERES_RFB } from '@contaia/domain';

const codigoPoder = z.enum(
  CATALOGO_DE_PODERES_RFB.map((poder) => poder.code) as [
    (typeof CATALOGO_DE_PODERES_RFB)[number]['code'],
    ...(typeof CATALOGO_DE_PODERES_RFB)[number]['code'][],
  ],
);

export const rascunhoSchema = z.object({
  validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  powers: z.array(codigoPoder).min(1).max(3),
  expectedRevision: z.number().int().positive().optional(),
});
export const criacaoSchema = rascunhoSchema
  .omit({ expectedRevision: true })
  .extend({ empresaId: z.string().uuid() });

export const revisaoSchema = z.object({
  expectedRevision: z.number().int().positive(),
});
export const confirmacaoSchema = revisaoSchema.extend({
  declaracaoConferida: z.literal(true),
});
export const evidenciaSchema = z.object({
  expectedRevision: z.number().int().positive(),
});
export const paginaSchema = z.object({
  pagina: z.coerce.number().int().min(1).default(1),
});
export const testeSchema = z.object({
  expectedRevision: z.number().int().positive(),
  power: codigoPoder,
});
export const operacaoSchema = z.object({
  power: codigoPoder,
  idempotencyKey: z
    .string()
    .min(8)
    .max(128)
    .regex(/^[A-Za-z0-9._:-]+$/u),
});
export const revogacaoSchema = z.object({
  expectedRevision: z.number().int().positive(),
  motivo: z.string().trim().min(5).max(500),
});
export const filtroSchema = z.object({
  empresaId: z.string().uuid().optional(),
  busca: z.string().trim().max(100).optional(),
  estado: z
    .enum(['DRAFT', 'SCHEDULED', 'ACTIVE', 'EXPIRED', 'REVOKED'])
    .optional(),
  poder: codigoPoder.optional(),
  vencimento: z.enum(['30_DIAS', '7_DIAS', 'VENCIDAS']).optional(),
  ordem: z
    .enum(['VENCIMENTO_ASC', 'VENCIMENTO_DESC', 'EMPRESA_ASC'])
    .default('VENCIMENTO_ASC'),
  limite: z.coerce.number().int().min(1).max(100).default(25),
  pagina: z.coerce.number().int().min(1).default(1),
});

export type EntradaRascunho = z.infer<typeof rascunhoSchema>;
export type EntradaOperacao = z.infer<typeof operacaoSchema>;
