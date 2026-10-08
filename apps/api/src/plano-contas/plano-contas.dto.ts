/**
 * DTOs da importação do plano de contas na API (SPEC-013 §5.1, §5.2).
 *
 * Entrada validada com Zod no limite do sistema. Nenhum DTO carrega arquivo — o upload
 * vai direto ao object storage (MinIO), a API só recebe referência + mapeamento.
 */
import {
  ESTADOS_DA_IMPORTACAO,
  TIPOS_DE_CONTA,
  NATUREZAS_DE_CONTA,
  VERSAO_DO_CONTRATO_DO_PLANO_CONTAS,
} from '@contaia/shared';
import { z } from 'zod';

const identificador = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu);

export const criarTentativaSchema = z.strictObject({
  hashArquivo: z.string().regex(/^[0-9a-f]{64}$/),
  arquivoNome: z.string().min(1).max(255),
  arquivoTamanho: z.number().int().min(1).max(10_485_760),
});

export type CriarTentativaDto = z.infer<typeof criarTentativaSchema>;

export const mapeamentoSchema = z.record(z.string(), z.string());

export type MapeamentoDto = z.infer<typeof mapeamentoSchema>;

export const salvarMapeamentoSchema = z.strictObject({ mapeamento: mapeamentoSchema });

export type SalvarMapeamentoDto = z.infer<typeof salvarMapeamentoSchema>;

export const confirmarImportacaoSchema = z.strictObject({
  planoVersao: z.number().int().min(0),
});

export type ConfirmarImportacaoDto = z.infer<typeof confirmarImportacaoSchema>;

export const cancelarPreviaSchema = z.strictObject({});

export type CancelarPreviaDto = z.infer<typeof cancelarPreviaSchema>;

export const listarHistoricoSchema = z
  .object({
    pagina: z.coerce.number().int().min(1).default(1),
    itensPorPagina: z.coerce.number().int().min(1).max(100).default(15),
  })
  .transform((q) => ({ pagina: q.pagina, itensPorPagina: q.itensPorPagina }));

export type ListarHistoricoDto = z.infer<typeof listarHistoricoSchema>;

export const listarRejeicoesSchema = z
  .object({
    pagina: z.coerce.number().int().min(1).default(1),
    itensPorPagina: z.coerce.number().int().min(1).max(100).default(50),
  })
  .transform((q) => ({ pagina: q.pagina, itensPorPagina: q.itensPorPagina }));

export type ListarRejeicoesDto = z.infer<typeof listarRejeicoesSchema>;

export const versaoDoContrato = VERSAO_DO_CONTRATO_DO_PLANO_CONTAS;