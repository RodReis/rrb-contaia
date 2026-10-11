/**
 * Base de empregados da empresa, em consulta (SPEC-014 §3.9): paginada no servidor, com busca por
 * nome, CPF ou matrícula. As chamadas da importação são as comuns (`importacao/api`).
 */
import { PaginaDeEmpregadosSchema, type PaginaDeEmpregados } from '@contaia/shared';

import { ler } from '../importacao/api';

export const listarEmpregados = async (
  empresaId: string,
  filtro: Readonly<{ pagina: number; busca: string }>,
): Promise<PaginaDeEmpregados> => {
  const consulta = new URLSearchParams({ pagina: String(filtro.pagina) });

  if (filtro.busca !== '') {
    consulta.set('busca', filtro.busca);
  }

  return PaginaDeEmpregadosSchema.parse(await ler(`/empresas/${empresaId}/empregados?${consulta.toString()}`));
};
