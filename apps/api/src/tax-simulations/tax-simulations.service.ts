/**
 * Simulação tributária (SPEC-016 §3.5). Lê as regras publicadas pelo contexto de serviço do
 * catálogo e delega o cálculo ao caso de uso puro. Simulação não grava nada: não cria apuração,
 * guia, lançamento nem obrigação, e não entra na auditoria permanente.
 */
import { Injectable } from '@nestjs/common';

import { taxRules } from '@contaia/db';
import type { ManualTaxSimulation, NfeComplement, NfeSimulationDto, TaxSimulationResultDto } from '@contaia/shared';
import type { PoolClient } from 'pg';

import { PoolDoBanco } from '../banco/pool.provider';
import type { AtorDoCatalogo } from '../auth/catalogo-tributario.guard';
import { parseNfeTaxInput } from '../nfe/parse-nfe-tax-input';
import { noCatalogoTributario } from '../tax-rules/catalogo-contexto';
import { simulateManual, type TaxRuleLookup } from './simulate-manual.use-case';
import { simulateNfe } from './simulate-nfe.use-case';

const catalogoLido = (cliente: PoolClient): TaxRuleLookup => ({
  findApplicable: (criteria) => taxRules.findApplicable(cliente, criteria),
  describe: async (ruleId) => {
    const { source, fixtureNote } = await taxRules.getById(cliente, ruleId);

    return { source, fixtureNote };
  },
});

@Injectable()
export class TaxSimulationsService {
  constructor(private readonly pool: PoolDoBanco) {}

  /** O ator já foi autorizado pelo guard; a simulação não o grava em lugar algum. */
  simulateManual(_ator: AtorDoCatalogo, entrada: ManualTaxSimulation, correlationId: string): Promise<TaxSimulationResultDto> {
    return noCatalogoTributario(this.pool.instancia, correlationId, (cliente) => simulateManual(catalogoLido(cliente), entrada));
  }

  /**
   * NF-e de teste (SPEC-016 §3.6): o XML vive só neste buffer, durante a requisição. O parse vem
   * antes de qualquer transação (XML recusado nem abre o banco), nada do documento é gravado, logado
   * ou enviado a serviço externo, e o buffer é zerado ao final, saindo bem ou mal.
   */
  async simulateNfe(
    _ator: AtorDoCatalogo,
    xml: Buffer,
    complemento: NfeComplement | null,
    correlationId: string,
  ): Promise<NfeSimulationDto> {
    try {
      const extracao = parseNfeTaxInput(xml);

      return await noCatalogoTributario(this.pool.instancia, correlationId, (cliente) =>
        simulateNfe(catalogoLido(cliente), extracao, complemento),
      );
    } finally {
      xml.fill(0);
    }
  }
}
