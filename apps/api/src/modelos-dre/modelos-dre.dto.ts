import { z } from "zod";

const uuid = z.string().uuid();
const component = z.object({
  code: z.string().trim().min(1).max(40),
  operator: z.enum(["ADD", "SUBTRACT"]),
}).strict();
const line = z.object({
  code: z.string().trim().min(1).max(40),
  title: z.string().trim().min(1).max(160),
  type: z.enum(["DETAIL", "SUBTOTAL"]),
  order: z.number().int().min(1).max(1000),
  level: z.number().int().min(0).max(8),
  parentCode: z.string().trim().min(1).max(40).nullable(),
  presentationSign: z.union([z.literal(1), z.literal(-1)]),
  components: z.array(component).max(1000),
  verticalBasis: z.boolean(),
}).strict();

export const templateIdParamsSchema = z.object({ templateId: uuid });
export const templateVersionParamsSchema = z.object({ templateId: uuid, version: z.coerce.number().int().positive() });
export const criarModeloSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable().optional(),
}).strict();
export const criarModeloOrigemSchema = criarModeloSchema.extend({
  companyId: uuid,
  sourceVersionId: uuid,
}).strict();
export const atualizarModeloSchema = criarModeloSchema;
export const salvarLinhasModeloSchema = z.object({
  expectedRevision: z.number().int().min(0),
  lines: z.array(line).max(1000),
}).strict();
export const publicarModeloSchema = z.object({ expectedRevision: z.number().int().min(0) }).strict();
export const aplicarModeloSchema = z.object({
  templateVersion: z.number().int().positive(),
  companyId: uuid,
  expectedCompanyRevision: z.number().int().min(0),
  idempotencyKey: z.string().trim().min(8).max(128),
}).strict();

export type CriarModelo = z.infer<typeof criarModeloSchema>;
export type CriarModeloOrigem = z.infer<typeof criarModeloOrigemSchema>;
export type SalvarLinhasModelo = z.infer<typeof salvarLinhasModeloSchema>;
export type AplicarModelo = z.infer<typeof aplicarModeloSchema>;
