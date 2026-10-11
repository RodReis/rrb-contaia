/**
 * Plano de contas vigente (SPEC-013 §3.12 "Consultar"). As chamadas da importação são as comuns
 * (`importacao/api`), com o domínio do plano.
 */
import { PaginaDoPlanoDeContasSchema, type PaginaDoPlanoDeContas } from '@contaia/shared';

import { ler } from '../importacao/api';

export const listarContas = async (
  empresaId: string,
  filtro: Readonly<{ pagina: number; busca: string }>,
): Promise<PaginaDoPlanoDeContas> => {
  const consulta = new URLSearchParams({ pagina: String(filtro.pagina) });

  if (filtro.busca !== '') {
    consulta.set('busca', filtro.busca);
  }

  return PaginaDoPlanoDeContasSchema.parse(await ler(`/empresas/${empresaId}/plano-contas/contas?${consulta.toString()}`));
};
