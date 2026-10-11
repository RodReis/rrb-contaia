/**
 * Entrada das rotas de empregados (SPEC-014 §6.2). O mecanismo é o comum de `importacao/dto.ts`;
 * aqui ficam os cinco campos do mapeamento de empregado (campo a mais, como `cargo`, é 422).
 */
import { z } from 'zod';

import { analisarEnvioCom, colunaDoMapeamento as coluna } from '../importacao/dto';

export { confirmacaoSchema, consultaComBuscaSchema, idDaTentativa, paginaSchema } from '../importacao/dto';

const mapeamentoSchema = z.strictObject({
  cpf: coluna,
  nome: coluna,
  matricula: coluna,
  data_nascimento: coluna,
  data_admissao: coluna,
});

/** Mapeamento como chegou (campos podem faltar): a ausência vira `MAPEAMENTO_INCOMPLETO`. */
export type MapeamentoDeEmpregadosInformado = z.infer<typeof mapeamentoSchema>;

export const analisarEnvio = analisarEnvioCom(mapeamentoSchema);
