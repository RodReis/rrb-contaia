/**
 * Entrada comum das rotas de importação por arquivo (SPEC-013 §6.2, SPEC-014 §6.2). Corpo é
 * estrito (campo a mais = 422, para que tenant ou autor nunca possam vir do cliente); query string
 * só lê o que conhece.
 */
import { CODIGOS_DE_ERRO, ErroDeDominio, ErroDeValidacao } from '@contaia/domain';
import { z } from 'zod';

import { analisar } from '../escritorio/escritorio.dto';

/** Uma coluna do arquivo por campo; ausente ou vazio vira `MAPEAMENTO_INCOMPLETO` no caso de uso. */
export const colunaDoMapeamento = z.string().max(255).optional();

/** Campos de texto do multipart: só o mapeamento (JSON). O arquivo vem no campo `arquivo`. */
const envioSchema = z.strictObject({
  mapeamento: z.string().min(2).max(8_192),
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
