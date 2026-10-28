/**
 * Entrada das rotas do plano de contas (SPEC-013 §6.2). O mecanismo é o comum de
 * `importacao/dto.ts`; aqui ficam os cinco campos do mapeamento do plano.
 */
import { z } from 'zod';

import { CAMPO_CLASSE_CONTABIL } from '@contaia/domain';
import { analisarEnvioCom, colunaDoMapeamento as coluna, consultaComBuscaSchema } from '../importacao/dto';
import type { MapeamentoInformado } from './plano-contas.service';

export { confirmacaoSchema, idDaTentativa, paginaSchema } from '../importacao/dto';

/** Campos obrigatórios e classe opcional da F39; ausências obrigatórias viram `MAPEAMENTO_INCOMPLETO`. */
const mapeamentoSchema = z.strictObject({
  codigo: coluna,
  nome: coluna,
  tipo: coluna,
  natureza: coluna,
  conta_pai: coluna,
  [CAMPO_CLASSE_CONTABIL]: coluna,
});

export const analisarEnvio: (corpo: unknown) => MapeamentoInformado = analisarEnvioCom(mapeamentoSchema);

export const consultaDoPlanoSchema = consultaComBuscaSchema;
