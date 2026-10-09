/**
 * Entrada das rotas do plano de contas (SPEC-013 §6.2). Corpo é estrito (campo a mais = 422, para
 * que tenant ou autor nunca possam vir do cliente); query string só lê o que conhece.
 */
import { CODIGOS_DE_ERRO, ErroDeDominio, ErroDeValidacao } from '@contaia/domain';
import { z } from 'zod';

import { analisar } from '../escritorio/escritorio.dto';
import type { MapeamentoInformado } from './plano-contas.service';

const coluna = z.string().max(255).optional();

/** Os cinco campos do contrato; ausente ou vazio vira `MAPEAMENTO_INCOMPLETO` no caso de uso. */
const mapeamentoSchema = z.strictObject({
  codigo: coluna,
  nome: coluna,
  tipo: coluna,
  natureza: coluna,
  conta_pai: coluna,
});

/** Campos de texto do multipart: só o mapeamento (JSON). O arquivo vem no campo `arquivo`. */
const envioSchema = z.strictObject({
  mapeamento: z.string().min(2).max(8_192),
});

const mapeamentoInvalido = (): ErroDeValidacao =>
  new ErroDeValidacao([{ campo: 'mapeamento', codigo: CODIGOS_DE_ERRO.CAMPO_OBRIGATORIO }]);

export const analisarEnvio = (corpo: unknown): MapeamentoInformado => {
  const { mapeamento } = analisar(envioSchema, corpo ?? {});
  let bruto: unknown;

  try {
    bruto = JSON.parse(mapeamento);
  } catch {
    throw mapeamentoInvalido();
  }

  const resultado = mapeamentoSchema.safeParse(bruto);

  if (!resultado.success) {
    throw mapeamentoInvalido();
  }

  return resultado.data;
};

const pagina = z.coerce.number().int().min(1).max(100_000).default(1);

export const paginaSchema = z.object({ pagina });

export const consultaDoPlanoSchema = z.object({
  pagina,
  busca: z.string().trim().max(100).optional(),
});

export const confirmacaoSchema = z.strictObject({
  versaoDaPrevia: z.number().int().min(0),
});

const IDENTIFICADOR = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** Id sem forma de identificador não existe — e não chega ao banco (que recusaria com 500). */
export const idDaTentativa = (valor: string): string => {
  if (!IDENTIFICADOR.test(valor)) {
    throw new ErroDeDominio(CODIGOS_DE_ERRO.TENTATIVA_NAO_ENCONTRADA, 'Tentativa de importação não encontrada.');
  }

  return valor;
};
