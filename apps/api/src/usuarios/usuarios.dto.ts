/**
 * Entrada da API de usuários e convite (SPEC-007). Dado externo chega como
 * `unknown` e só vira tipo depois do schema; a regra de negócio (papel
 * obrigatório, e-mail válido, estados) é do domínio e do caso de uso.
 */
import { z } from 'zod';

import { PAPEIS_PADRAO } from '@contaia/domain';

/** Todo texto tem teto: as colunas são `text` sem limite no banco. */
const texto = (maximo: number) => z.string().min(1).max(maximo);

const opcionalNulo = (maximo: number) =>
  z
    .string()
    .max(maximo)
    .nullish()
    .transform((valor) => valor ?? null);

/**
 * Identificador gerado por `app.uuid_v7()`. Não é `z.uuid()`: aquela função
 * grava a variante RFC 4122 no byte errado e produz ids que `z.uuid()` recusa.
 */
export const IDENTIFICADOR = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const identificador = z.string().regex(IDENTIFICADOR);

const ESTADOS = ['CONVIDADO', 'ATIVO', 'SUSPENSO', 'ARQUIVADO'] as const;

export const TIPOS_DE_EVENTO = [
  'CONVITE_CRIADO',
  'CONVITE_REENVIADO',
  'CONVITE_ACEITO',
  'CONVITE_EXPIRADO',
  'EMAIL_DE_CONVITE_CORRIGIDO',
  'DADOS_E_PAPEIS_ALTERADOS',
  'SUSPENSO',
  'REATIVADO',
  'ARQUIVADO',
  'NOVO_CONVITE_INICIADO',
] as const;

// O papel obrigatório (≥ 1) e o catálogo padrão são regras do domínio (`validarPapeis`).
const papeis = z.array(texto(40)).max(PAPEIS_PADRAO.length * 2);

export const conviteSchema = z.object({
  nome: texto(120),
  email: texto(254),
  telefone: opcionalNulo(20),
  crc: opcionalNulo(40),
  papeis,
});

export const edicaoSchema = z.object({
  nome: texto(120),
  telefone: opcionalNulo(20),
  crc: opcionalNulo(40),
  papeis,
  // Só aceito enquanto o convite não foi aceito: a regra é do caso de uso.
  email: texto(254).optional(),
});

/** O e-mail de quem retorna é o mesmo de antes: o campo não existe aqui. */
export const novoConviteSchema = edicaoSchema.omit({ email: true });

export const filtroDeUsuariosSchema = z
  .object({
    busca: z.string().max(200).optional(),
    estado: z.enum(ESTADOS).optional(),
    papel: z.enum(PAPEIS_PADRAO).optional(),
    // `limite` sem máximo permitiria pedir a base inteira numa requisição.
    limite: z.coerce.number().int().min(1).max(100).default(25),
    deslocamento: z.coerce.number().int().min(0).default(0),
  })
  .transform((filtro) => ({
    ...(filtro.busca === undefined || filtro.busca === '' ? {} : { busca: filtro.busca }),
    ...(filtro.estado === undefined ? {} : { estado: filtro.estado }),
    ...(filtro.papel === undefined ? {} : { papel: filtro.papel }),
    limite: filtro.limite,
    deslocamento: filtro.deslocamento,
  }));

/** Confere o formato e que o dia existe: `2026-02-31` viraria 3 de março, `2026-13-01` Invalid Date. */
const existeNoCalendario = (data: string): boolean => {
  const [ano, mes, dia] = data.split('-').map(Number);
  const conferida = new Date(Date.UTC(ano ?? 0, (mes ?? 0) - 1, dia ?? 0));

  return (
    conferida.getUTCFullYear() === ano &&
    conferida.getUTCMonth() === (mes ?? 0) - 1 &&
    conferida.getUTCDate() === dia
  );
};

const dataCivil = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u)
  .refine(existeNoCalendario);

// ponytail: offset fixo -03:00; o Brasil não tem horário de verão desde 2019, e os eventos
// de usuários são de 2026 em diante. Se a regra voltar, trocar por cálculo com Intl/Temporal.
const inicioDoDia = (data: string): Date => new Date(`${data}T00:00:00-03:00`);
const inicioDoDiaSeguinte = (data: string): Date =>
  new Date(inicioDoDia(data).getTime() + 24 * 3_600_000);

export const filtroDeEventosSchema = z
  .object({
    usuarioAfetadoId: identificador.optional(),
    autorId: identificador.optional(),
    tipo: z.enum(TIPOS_DE_EVENTO).optional(),
    de: dataCivil.optional(),
    ate: dataCivil.optional(),
    limite: z.coerce.number().int().min(1).max(100).default(25),
    deslocamento: z.coerce.number().int().min(0).default(0),
  })
  .transform((filtro) => ({
    ...(filtro.usuarioAfetadoId === undefined ? {} : { usuarioAfetadoId: filtro.usuarioAfetadoId }),
    ...(filtro.autorId === undefined ? {} : { autorId: filtro.autorId }),
    ...(filtro.tipo === undefined ? {} : { tipo: filtro.tipo }),
    // Datas civis em São Paulo (I-11): [início de `de`, início do dia depois de `ate`).
    ...(filtro.de === undefined ? {} : { de: inicioDoDia(filtro.de) }),
    ...(filtro.ate === undefined ? {} : { ate: inicioDoDiaSeguinte(filtro.ate) }),
    limite: filtro.limite,
    deslocamento: filtro.deslocamento,
  }));

export const aceiteDoConviteSchema = z.object({
  token: texto(200),
  senha: texto(256),
});
