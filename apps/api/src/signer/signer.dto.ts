/**
 * DTOs do Signer na API (SPEC-012 §5). Entrada validada com Zod no limite do sistema. Nenhum DTO
 * carrega XML, URL, caminho do Vault, PKCS#12, senha ou token: o teste manual só escolhe a
 * finalidade, dentro do catálogo fechado.
 */
import { FINALIDADES, LIMITE_DE_EMPRESAS_POR_CONSULTA, RESULTADOS_DO_HISTORICO } from '@contaia/shared';
import { z } from 'zod';

// Mesmo regex dos demais DTOs: `app.uuid_v7()` grava a variante no byte errado e `z.uuid()`
// recusaria ~3/4 dos ids do sistema.
const identificador = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu);

const finalidade = z.enum(FINALIDADES);

export const estadosSchema = z.object({
  empresaIds: z
    .string()
    .transform((valor) => valor.split(','))
    .pipe(z.array(identificador).min(1).max(LIMITE_DE_EMPRESAS_POR_CONSULTA)),
});

export type EstadosDto = z.infer<typeof estadosSchema>;

export const filtroDoHistoricoDoSignerSchema = z
  .object({
    pagina: z.coerce.number().int().min(1).max(100_000).default(1),
    finalidade: finalidade.optional(),
    resultado: z.enum(RESULTADOS_DO_HISTORICO).optional(),
  })
  // `z.object` já descarta o desconhecido; o `.strict()` seria mais rígido que o resto da API.
  .transform((consulta) => ({
    pagina: consulta.pagina,
    ...(consulta.finalidade === undefined ? {} : { finalidade: consulta.finalidade }),
    ...(consulta.resultado === undefined ? {} : { resultado: consulta.resultado }),
  }));

export type FiltroDoHistoricoDoSignerDto = z.infer<typeof filtroDoHistoricoDoSignerSchema>;

export const testeManualSchema = z.strictObject({ finalidade: finalidade.optional() });

export type TesteManualDto = z.infer<typeof testeManualSchema>;
