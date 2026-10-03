/**
 * Entrada da API de carteiras (SPEC-009). Dado externo chega como `unknown` e só
 * vira tipo depois do schema; as regras do lote (estados, revisão, tenant) são do
 * domínio e do caso de uso.
 */
import { z } from 'zod';

import {
  dataCivil,
  identificador,
  inicioDoDia,
  inicioDoDiaSeguinte,
} from '../usuarios/usuarios.dto';

const ESTADOS = ['CONVIDADO', 'ATIVO', 'SUSPENSO', 'ARQUIVADO'] as const;
const PAPEIS = ['admin_escritorio', 'contador', 'auxiliar', 'auditor_readonly'] as const;
const ORIGENS = [
  'INDIVIDUAL',
  'LOTE',
  'AUTOATRIBUICAO',
  'ARQUIVAMENTO_USUARIO',
  'ARQUIVAMENTO_EMPRESA',
] as const;

/** Teto de uma operação: um lote além disso é um erro de uso, não um caso legítimo. */
export const TETO_DO_LOTE = 500;

const lista = <T extends z.ZodType>(item: T) => z.array(item).max(TETO_DO_LOTE);

export const alteracaoSchema = z.object({
  origem: z.enum(['INDIVIDUAL', 'LOTE']),
  /** Cada colaborador devolve a revisão da carteira que a tela mostrou. */
  usuarios: lista(z.object({ id: identificador, revisao: z.number().int().min(0) })),
  adicionar: lista(identificador).default([]),
  remover: lista(identificador).default([]),
});

export type AlteracaoDeEntrada = z.infer<typeof alteracaoSchema>;

const busca = z.string().trim().max(120).optional();
const pagina = {
  limite: z.coerce.number().int().min(1).max(100).default(25),
  deslocamento: z.coerce.number().int().min(0).default(0),
};

export const filtroDeColaboradoresSchema = z
  .object({
    busca,
    // A Central abre com colaboradores ativos; arquivados só por seleção explícita.
    estado: z.enum(ESTADOS).default('ATIVO'),
    papel: z.enum(PAPEIS).optional(),
    carteira: z.enum(['COM_EMPRESAS', 'SEM_EMPRESAS']).optional(),
    ...pagina,
  })
  .transform((filtro) => ({
    ...(filtro.busca === undefined || filtro.busca === '' ? {} : { busca: filtro.busca }),
    estado: filtro.estado,
    ...(filtro.papel === undefined ? {} : { papel: filtro.papel }),
    ...(filtro.carteira === undefined ? {} : { carteira: filtro.carteira }),
    limite: filtro.limite,
    deslocamento: filtro.deslocamento,
  }));

export const filtroDeEmpresasSchema = z
  .object({
    busca,
    situacao: z.enum(['ATRIBUIDAS', 'DISPONIVEIS']).optional(),
    ...pagina,
  })
  .transform((filtro) => ({
    ...(filtro.busca === undefined || filtro.busca === '' ? {} : { busca: filtro.busca }),
    ...(filtro.situacao === undefined ? {} : { atribuida: filtro.situacao === 'ATRIBUIDAS' }),
    limite: filtro.limite,
    deslocamento: filtro.deslocamento,
  }));

export const filtroDeEventosDeCarteiraSchema = z
  .object({
    usuarioAfetadoId: identificador.optional(),
    empresaId: identificador.optional(),
    autorId: identificador.optional(),
    origem: z.enum(ORIGENS).optional(),
    de: dataCivil.optional(),
    ate: dataCivil.optional(),
    ...pagina,
  })
  .transform((filtro) => ({
    ...(filtro.usuarioAfetadoId === undefined ? {} : { usuarioAfetadoId: filtro.usuarioAfetadoId }),
    ...(filtro.empresaId === undefined ? {} : { empresaId: filtro.empresaId }),
    ...(filtro.autorId === undefined ? {} : { autorId: filtro.autorId }),
    ...(filtro.origem === undefined ? {} : { origem: filtro.origem }),
    // Datas civis em São Paulo (I-11): [início de `de`, início do dia depois de `ate`).
    ...(filtro.de === undefined ? {} : { de: inicioDoDia(filtro.de) }),
    ...(filtro.ate === undefined ? {} : { ate: inicioDoDiaSeguinte(filtro.ate) }),
    limite: filtro.limite,
    deslocamento: filtro.deslocamento,
  }));
