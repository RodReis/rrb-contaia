/**
 * Simulação tributária (SPEC-016 §3.5). Lê as regras publicadas pelo contexto de serviço do
 * catálogo e delega o cálculo ao caso de uso puro. Simulação não grava nada: não cria apuração,
 * guia, lançamento nem obrigação, e não entra na auditoria permanente.
 */
import { Injectable } from '@nestjs/common';

import { taxRules } from '@contaia/db';
import type { ManualTaxSimulation, TaxSimulationResultDto } from '@contaia/shared';

import { PoolDoBanco } from '../banco/pool.provider';
import type { AtorDoCatalogo } from '../auth/catalogo-tributario.guard';
import { noCatalogoTributario } from '../tax-rules/catalogo-contexto';
import { simulateManual } from './simulate-manual.use-case';

@Injectable()
export class TaxSimulationsService {
  constructor(private readonly pool: PoolDoBanco) {}

  /** O ator já foi autorizado pelo guard; a simulação não o grava em lugar algum. */
  simulateManual(_ator: AtorDoCatalogo, entrada: ManualTaxSimulation, correlationId: string): Promise<TaxSimulationResultDto> {
    return noCatalogoTributario(this.pool.instancia, correlationId, (cliente) =>
      simulateManual(
        {
          findApplicable: (criteria) => taxRules.findApplicable(cliente, criteria),
          describe: async (ruleId) => {
            const { source, fixtureNote } = await taxRules.getById(cliente, ruleId);

            return { source, fixtureNote };
          },
        },
        entrada,
      ),
    );
  }
}
