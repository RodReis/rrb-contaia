/**
 * Contexto de serviço do catálogo tributário (SPEC-016 §3.7): global, sem tenant, empresa nem
 * usuário. Só as funções `app.tax_rule_*` o aceitam. A autorização do ator é do guard, antes daqui.
 */
import { comContexto } from '@contaia/db';
import { contextoDeServico } from '@contaia/domain';
import type { Pool, PoolClient } from 'pg';

const IDENTIDADE_DO_CATALOGO = 'api-catalogo-tributario';

export const noCatalogoTributario = <T>(
  pool: Pool,
  correlationId: string,
  executar: (cliente: PoolClient) => Promise<T>,
): Promise<T> =>
  comContexto(
    pool,
    contextoDeServico({
      identidadeTecnica: IDENTIDADE_DO_CATALOGO,
      finalidade: 'CATALOGO_TRIBUTARIO',
      correlationId,
    }),
    executar,
  );
