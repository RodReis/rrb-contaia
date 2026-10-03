/**
 * DTOs da Central de Pendências (SPEC-005). Segue o padrão de `empresa.dto.ts`:
 * `analisar(schema, corpo)` no controller, nunca `schema.parse` direto.
 */
import { z } from 'zod';

// Mesmo regex de `apps/api/src/empresa/empresa.dto.ts` (`identificador`): NÃO
// use `z.string().uuid()` — a função `app.uuid_v7()` grava a variante RFC 4122
// no byte errado e produz ids que `z.uuid()` recusa (~3/4 dos ids do sistema).
const identificador = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu);

export const filtroDaCentralSchema = z.object({
  empresaId: identificador.nullish().transform((valor) => valor ?? null),
  origem: z
    .enum(['CADASTRAL', 'DOCUMENTAL', 'CERTIFICADO'])
    .nullish()
    .transform((valor) => valor ?? null),
  tipo: z
    .enum([
      'CAMPO_AUSENTE',
      'CAMPO_INVALIDO',
      'DOCUMENTO_AUSENTE',
      'DOCUMENTO_REJEITADO',
      'DOCUMENTO_VENCIDO',
      'EXIGENCIA_ESPECIFICA',
      'CERTIFICADO_AUSENTE',
      'CERTIFICADO_VENCIDO',
      'CERTIFICADO_SEM_RESPONSAVEL',
    ])
    .nullish()
    .transform((valor) => valor ?? null),
  estado: z
    .enum(['ABERTA', 'RESOLVIDA'])
    .nullish()
    .transform((valor) => valor ?? 'ABERTA'),
  vencimento: z
    .enum(['VENCIDAS', 'PROXIMAS'])
    .nullish()
    .transform((valor) => valor ?? null),
  limite: z.coerce.number().int().min(1).max(100).default(25),
  deslocamento: z.coerce.number().int().min(0).default(0),
});

export type FiltroDaCentralDto = z.infer<typeof filtroDaCentralSchema>;

export const dispensaDePendenciaSchema = z.object({
  justificativa: z.string().trim().min(1).max(500),
});

export type DispensaDePendenciaDto = z.infer<typeof dispensaDePendenciaSchema>;
