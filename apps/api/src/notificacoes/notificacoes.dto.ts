/**
 * DTOs de Notificações (SPEC-006). Mesmo padrão de `pendencias.dto.ts`:
 * `analisar(schema, corpo)` no controller.
 */
import { z } from 'zod';

// Mesmo regex de `pendencias.dto.ts` (`identificador`): NÃO use `z.string().uuid()`
// — a função `app.uuid_v7()` grava a variante RFC 4122 no byte errado e produz
// ids que `z.uuid()` recusa.
const identificador = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu);

export const filtroDoHistoricoSchema = z.object({
  limite: z.coerce.number().int().min(1).max(100).default(25),
  deslocamento: z.coerce.number().int().min(0).default(0),
});

export type FiltroDoHistoricoDto = z.infer<typeof filtroDoHistoricoSchema>;

export const marcacaoEmLoteSchema = z.object({
  ids: z.array(identificador).min(1).max(15),
});

export type MarcacaoEmLoteDto = z.infer<typeof marcacaoEmLoteSchema>;
