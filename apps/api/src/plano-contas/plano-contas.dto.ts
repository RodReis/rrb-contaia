/**
 * Entrada das rotas do plano de contas (SPEC-013 §6.2). O mecanismo é o comum de
 * `importacao/dto.ts`; aqui ficam os cinco campos do mapeamento do plano.
 */
import { z } from 'zod';

import { analisarEnvioCom, colunaDoMapeamento as coluna, consultaComBuscaSchema } from '../importacao/dto';
import type { MapeamentoInformado } from './plano-contas.service';

export { confirmacaoSchema, idDaTentativa, paginaSchema } from '../importacao/dto';

/** Os cinco campos do contrato; ausente ou vazio vira `MAPEAMENTO_INCOMPLETO` no caso de uso. */
const mapeamentoSchema = z.strictObject({
  codigo: coluna,
  nome: coluna,
  tipo: coluna,
  natureza: coluna,
  conta_pai: coluna,
});

export const analisarEnvio: (corpo: unknown) => MapeamentoInformado = analisarEnvioCom(mapeamentoSchema);

export const consultaDoPlanoSchema = consultaComBuscaSchema;
