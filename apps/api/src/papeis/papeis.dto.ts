/**
 * Entrada da API de papéis personalizados (SPEC-008). Dado externo chega como
 * `unknown` e só vira tipo depois do schema; as regras (nome, matriz, catálogo,
 * revisão) são do domínio e do caso de uso. A matriz entra como `unknown[]` de
 * propósito: é `normalizarMatriz` que distingue chave livre (422) de área
 * exclusiva (403), e um schema de enum esconderia essa diferença.
 */
import { z } from 'zod';

const ESTADOS = ['ATIVO', 'ARQUIVADO'] as const;

const permissoes = z.array(z.unknown()).max(200);
const revisaoEsperada = z.number().int().min(1);

export const criacaoDePapelSchema = z.object({
  nome: z.string().max(500),
  descricao: z.string().max(2000).nullish(),
  papelBase: z.string().max(40),
  permissoes,
});

export const edicaoDePapelSchema = z.object({
  nome: z.string().max(500),
  descricao: z.string().max(2000).nullish(),
  permissoes,
  revisaoEsperada,
  confirmaReducao: z.boolean().default(false),
});

export const arquivamentoDePapelSchema = z.object({ revisaoEsperada });

export const reativacaoDePapelSchema = z.object({
  revisaoEsperada,
  // A matriz revisada: sem ela não há reativação, a matriz preservada nunca volta sozinha.
  permissoes,
  confirmaIncompatibilidades: z.boolean().default(false),
});

export const filtroDePapeisSchema = z
  .object({
    busca: z.string().max(200).optional(),
    estado: z.enum(ESTADOS).optional(),
    // `limite` sem máximo permitiria pedir a base inteira numa requisição.
    limite: z.coerce.number().int().min(1).max(100).default(25),
    deslocamento: z.coerce.number().int().min(0).default(0),
  })
  .transform((filtro) => ({
    ...(filtro.busca === undefined || filtro.busca === '' ? {} : { busca: filtro.busca }),
    ...(filtro.estado === undefined ? {} : { estado: filtro.estado }),
    limite: filtro.limite,
    deslocamento: filtro.deslocamento,
  }));

export type CriacaoDePapel = z.infer<typeof criacaoDePapelSchema>;
export type EdicaoDePapel = z.infer<typeof edicaoDePapelSchema>;
export type ArquivamentoDePapel = z.infer<typeof arquivamentoDePapelSchema>;
export type ReativacaoDePapel = z.infer<typeof reativacaoDePapelSchema>;
