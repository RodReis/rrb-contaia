/**
 * Simulação tributária (SPEC-016 §3.5, §6.1): normalização → seleção por vigência → avaliador puro
 * → memória. Esta função não conhece HTTP, banco, relógio nem XML: a data do fato entra na entrada
 * e o acesso às regras é um parâmetro (`TaxRuleLookup`). O formulário manual e o adaptador de NF-e
 * convergem aqui, cada item da nota virando uma simulação como esta.
 */
import { evaluateTaxRule, selectApplicableRule, type TaxRule, type TaxRuleCriteria } from '@contaia/domain';
import type { ManualTaxSimulation, TaxSimulationResultDto } from '@contaia/shared';

/** Fonte de regras: candidatas publicadas na data do fato e o texto descritivo da regra escolhida. */
export type TaxRuleLookup = Readonly<{
  findApplicable: (criteria: TaxRuleCriteria) => Promise<readonly TaxRule[]>;
  describe: (ruleId: string) => Promise<Readonly<{ source: string; fixtureNote: string }>>;
}>;

export const simulateManual = async (lookup: TaxRuleLookup, input: ManualTaxSimulation): Promise<TaxSimulationResultDto> => {
  const criteria: TaxRuleCriteria = {
    taxType: input.taxType,
    regime: input.regime,
    operationType: input.operationType,
    factDate: input.factDate,
  };

  const rule = selectApplicableRule(await lookup.findApplicable(criteria), criteria);
  const memory = evaluateTaxRule(rule, { baseCents: input.baseCents, factDate: input.factDate });
  const { source, fixtureNote } = await lookup.describe(rule.id);

  return {
    rule: {
      id: rule.id,
      versionNumber: rule.version,
      taxType: rule.taxType,
      regime: rule.regime,
      operationType: rule.operationType,
      validFrom: rule.validFrom,
      validUntil: rule.validUntil,
      source,
      fixtureNote,
    },
    memory,
  };
};
