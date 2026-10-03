/**
 * DTOs do cofre de certificados (SPEC-011). Entrada validada com Zod no limite do sistema;
 * nenhum DTO de leitura ou escrita carrega arquivo, senha, chave privada ou token — a senha e o
 * PKCS#12 só existem no corpo da ingestão navegador → cofre, que não passa por aqui.
 */
import { CODIGOS_DE_RECUSA_DA_INGESTAO, ESTADOS_NO_COFRE } from '@contaia/shared';
import { z } from 'zod';

// Mesmo regex dos demais DTOs: `app.uuid_v7()` grava a variante no byte errado e `z.uuid()`
// recusaria ~3/4 dos ids do sistema.
const identificador = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu);

const ESTADOS_DO_FILTRO = [...ESTADOS_NO_COFRE, 'SEM_RESPONSAVEL'] as const;

export const filtroDoCofreSchema = z.object({
  busca: z
    .string()
    .trim()
    .max(100)
    .nullish()
    .transform((valor) => (valor === undefined || valor === null || valor === '' ? null : valor)),
  estado: z
    .enum(ESTADOS_DO_FILTRO)
    .nullish()
    .transform((valor) => valor ?? null),
  ordem: z
    .enum(['EMPRESA', 'VENCIMENTO', 'ESTADO'])
    .nullish()
    .transform((valor) => valor ?? 'EMPRESA'),
  pagina: z.coerce.number().int().min(1).max(100_000).default(1),
  limite: z.coerce.number().int().min(1).max(100).default(25),
});

export type FiltroDoCofreDto = z.infer<typeof filtroDoCofreSchema>;

export const ingestaoSchema = z.object({ responsavelId: identificador });
export type IngestaoDto = z.infer<typeof ingestaoSchema>;

export const trocaDeResponsavelSchema = z.object({ responsavelId: identificador });
export type TrocaDeResponsavelDto = z.infer<typeof trocaDeResponsavelSchema>;

// O domínio também bloqueia o motivo vazio (`planejarDesativacao`); aqui falha cedo, com o campo.
export const desativacaoSchema = z.object({ motivo: z.string().trim().min(1).max(500) });
export type DesativacaoDto = z.infer<typeof desativacaoSchema>;

export const filtroDoHistoricoDeCertificadosSchema = z.object({
  empresaId: identificador.nullish().transform((valor) => valor ?? null),
  acao: z
    .enum([
      'CADASTRO',
      'SUBSTITUICAO',
      'DESATIVACAO',
      'RESPONSAVEL_ALTERADO',
      'RESPONSAVEL_PERDIDO',
      'ALERTA_EMITIDO',
      'RECUSA',
    ])
    .nullish()
    .transform((valor) => valor ?? null),
  resultado: z
    .enum(['SUCESSO', 'RECUSADO'])
    .nullish()
    .transform((valor) => valor ?? null),
  limite: z.coerce.number().int().min(1).max(100).default(25),
  deslocamento: z.coerce.number().int().min(0).default(0),
});

export type FiltroDoHistoricoDeCertificadosDto = z.infer<typeof filtroDoHistoricoDeCertificadosSchema>;

// -- Rotas internas (cofre → API) ------------------------------------------------------

const texto = (maximo: number) => z.string().trim().min(1).max(maximo);

/** `PedidoDeAtivacao`: metadados que o cofre extraiu — nunca o conteúdo do PKCS#12. */
export const pedidoDeAtivacaoSchema = z.object({
  ticket: texto(4_096),
  referenciaDoSegredo: identificador,
  metadados: z.object({
    titular: texto(500),
    cnpjTitular: texto(20),
    autoridadeCertificadora: texto(500),
    cadeia: z.array(texto(500)).min(1).max(20),
    numeroSerie: texto(200),
    impressaoDigital: texto(128),
    naoAntes: z.iso.datetime({ offset: true }),
    naoDepois: z.iso.datetime({ offset: true }),
  }),
});

export type PedidoDeAtivacaoDto = z.infer<typeof pedidoDeAtivacaoSchema>;

export const pedidoDeRecusaSchema = z.object({
  ticket: texto(4_096),
  codigo: z.enum(CODIGOS_DE_RECUSA_DA_INGESTAO),
});

export type PedidoDeRecusaDto = z.infer<typeof pedidoDeRecusaSchema>;
