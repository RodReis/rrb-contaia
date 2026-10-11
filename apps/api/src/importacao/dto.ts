/**
 * Entrada comum das rotas de importação por arquivo (SPEC-013 §6.2, SPEC-014 §6.2). Corpo é
 * estrito (campo a mais = 422, para que tenant ou autor nunca possam vir do cliente); query string
 * só lê o que conhece.
 */
import { CODIGOS_DE_ERRO, ErroDeDominio, ErroDeValidacao } from '@contaia/domain';
import { PedidoDeInspecaoSchema } from '@contaia/shared';
import { z } from 'zod';

import { analisar } from '../escritorio/escritorio.dto';
import type { CamposDePlanilhaInformados } from './planilha';

/** Uma coluna do arquivo por campo; ausente ou vazio vira `MAPEAMENTO_INCOMPLETO` no caso de uso. */
export const colunaDoMapeamento = z.string().max(255).optional();

/** Número que chega como texto no multipart (a coerção e a faixa são as do `PedidoDeInspecaoSchema`). */
const campoNumerico = z.string().max(16).optional();

/**
 * Campos de texto do multipart: o mapeamento (JSON) e, na planilha, `aba` (posição, base 1) e
 * `linhaCabecalho`. O arquivo vem no campo `arquivo`.
 */
const envioSchema = z.strictObject({
  mapeamento: z.string().min(2).max(8_192),
  aba: campoNumerico,
  linhaCabecalho: campoNumerico,
});

const mapeamentoInvalido = (): ErroDeValidacao =>
  new ErroDeValidacao([{ campo: 'mapeamento', codigo: CODIGOS_DE_ERRO.CAMPO_OBRIGATORIO }]);

/** Lê o campo `mapeamento` (JSON) do multipart contra o schema estrito dos campos do domínio. */
export const analisarEnvioCom =
  <Mapeamento>(mapeamentoSchema: z.ZodType<Mapeamento>) =>
  (corpo: unknown): Mapeamento => {
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

/**
 * `aba` e `linhaCabecalho` do envio ou da inspeção (inteiros ≥ 1). `undefined` quando nenhum veio — o
 * CSV os ignora; na planilha a falta é `CONFIGURACAO_DE_PLANILHA_INCOMPLETA` no caso de uso.
 */
export const analisarCamposDePlanilha = (corpo: unknown): CamposDePlanilhaInformados | undefined => {
  const { aba, linhaCabecalho } = (corpo ?? {}) as Readonly<Record<string, unknown>>;

  if (aba === undefined && linhaCabecalho === undefined) {
    return undefined;
  }

  return analisar(PedidoDeInspecaoSchema, {
    ...(aba === undefined ? {} : { aba }),
    ...(linhaCabecalho === undefined ? {} : { linhaCabecalho }),
  });
};

/** Inspeção: só `aba` e `linhaCabecalho`, ambos opcionais; campo a mais é 422. */
export const analisarPedidoDeInspecao = (corpo: unknown): CamposDePlanilhaInformados =>
  analisar(PedidoDeInspecaoSchema, corpo ?? {});

const pagina = z.coerce.number().int().min(1).max(100_000).default(1);

export const paginaSchema = z.object({ pagina });

/** Página e busca da base importada (plano, empregados). */
export const consultaComBuscaSchema = z.object({
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
