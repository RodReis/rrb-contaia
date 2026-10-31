import { z } from "zod";

const competence = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/u);
const uuid = z.string().uuid();
const component = z
  .object({
    code: z.string().trim().min(1).max(40),
    operator: z.enum(["ADD", "SUBTRACT"]),
  })
  .strict();
const line = z
  .object({
    code: z.string().trim().min(1).max(40),
    title: z.string().trim().min(1).max(160),
    type: z.enum(["DETAIL", "SUBTOTAL"]),
    order: z.number().int().min(1).max(1000),
    level: z.number().int().min(0).max(8),
    parentCode: z.string().trim().min(1).max(40).nullable(),
    presentationSign: z.union([z.literal(1), z.literal(-1)]),
    accountIds: z.array(uuid).max(1000),
    components: z.array(component).max(1000),
    verticalBasis: z.boolean(),
  })
  .strict();

export const criarRascunhoSchema = z
  .object({ fromVersion: z.number().int().positive().optional() })
  .strict();
export const salvarEstruturaSchema = z
  .object({
    expectedRevision: z.number().int().min(0),
    lines: z.array(line).max(1000),
  })
  .strict();
export const publicarEstruturaSchema = z
  .object({
    expectedRevision: z.number().int().min(0),
    effectiveFrom: competence,
  })
  .strict();
export const consultaDreSchema = z
  .object({
    competence,
    periodMode: z.enum(["MONTH", "YEAR_TO_DATE"]).default("MONTH"),
    viewMode: z.enum(["SYNTHETIC", "ANALYTIC"]).default("SYNTHETIC"),
  })
  .strict();
export const exportarDreSchema = z
  .object({
    competence,
    periodMode: z.enum(["MONTH", "YEAR_TO_DATE"]).default("MONTH"),
  })
  .strict();
export const statementVersionIdSchema = z.object({ versionId: uuid }).strict();
export type StatementLineInput = z.infer<typeof line>;
export type ConsultaDre = z.infer<typeof consultaDreSchema>;
export type ExportarDre = z.infer<typeof exportarDreSchema>;
