/**
 * Simulação manual (SPEC-016 §3.5): seleciona exatamente uma regra publicada vigente na data do
 * fato e calcula com o avaliador puro. Sem regra, falha acionável; duas regras, erro de integridade
 * sem precedência; regra futura nunca altera fato anterior à sua vigência.
 */
import { describe, expect, it, vi } from 'vitest';

import { CODIGOS_DE_ERRO, ErroDeDominio, type TaxRule } from '@contaia/domain';
import type { ManualTaxSimulation } from '@contaia/shared';

import { simulateManual, type TaxRuleLookup } from './simulate-manual.use-case';

const rule = (overrides: Partial<TaxRule> = {}): TaxRule => ({
  id: 'regra-1',
  version: 1,
  status: 'PUBLISHED',
  taxType: 'ICMS',
  regime: 'LUCRO_PRESUMIDO',
  operationType: 'VENDA_MERCADORIA',
  validFrom: '2026-01-01',
  validUntil: null,
  operation: { rateBasisPoints: 1_800 },
  ...overrides,
});

const input: ManualTaxSimulation = {
  factDate: '2026-06-15',
  regime: 'LUCRO_PRESUMIDO',
  taxType: 'ICMS',
  operationType: 'VENDA_MERCADORIA',
  baseCents: 10_000,
};

const lookup = (candidates: readonly TaxRule[]): TaxRuleLookup & { findApplicable: ReturnType<typeof vi.fn> } => ({
  findApplicable: vi.fn(async () => candidates),
  describe: vi.fn(async (id: string) => ({ source: `Fonte da ${id}`, fixtureNote: 'Dado de teste não oficial' })),
});

const codeOf = async (executar: () => Promise<unknown>): Promise<string | undefined> => {
  try {
    await executar();
  } catch (erro) {
    return erro instanceof ErroDeDominio ? erro.codigo : `inesperado: ${String(erro)}`;
  }
  return undefined;
};

describe('simulateManual', () => {
  it('procura pela identidade e pela data do fato, nunca pela data atual', async () => {
    const fonte = lookup([rule()]);

    await simulateManual(fonte, input);

    expect(fonte.findApplicable).toHaveBeenCalledWith({
      taxType: 'ICMS',
      regime: 'LUCRO_PRESUMIDO',
      operationType: 'VENDA_MERCADORIA',
      factDate: '2026-06-15',
    });
  });

  it('devolve regra, versão, vigência, indicação de fixture e a memória de cálculo completa', async () => {
    const resultado = await simulateManual(lookup([rule({ operation: { baseReductionBasisPoints: 3_333, rateBasisPoints: 1_800 } })]), input);

    expect(resultado.rule).toEqual({
      id: 'regra-1',
      versionNumber: 1,
      taxType: 'ICMS',
      regime: 'LUCRO_PRESUMIDO',
      operationType: 'VENDA_MERCADORIA',
      validFrom: '2026-01-01',
      validUntil: null,
      source: 'Fonte da regra-1',
      fixtureNote: 'Dado de teste não oficial',
    });
    expect(resultado.memory).toEqual({
      ruleId: 'regra-1',
      ruleVersion: 1,
      validFrom: '2026-01-01',
      validUntil: null,
      factDate: '2026-06-15',
      baseCents: 10_000,
      baseReductionBasisPoints: 3_333,
      reducedBase: { numerator: '6667', denominator: '1' },
      rateBasisPoints: 1_800,
      unrounded: { numerator: '60003', denominator: '50' },
      rounding: 'HALF_UP',
      resultCents: 1_200,
    });
  });

  it('reproduz exatamente memória e resultado para a mesma entrada e versão', async () => {
    const primeira = JSON.stringify(await simulateManual(lookup([rule()]), { ...input, baseCents: 12_345 }));
    const segunda = JSON.stringify(await simulateManual(lookup([rule()]), { ...input, baseCents: 12_345 }));

    expect(segunda).toBe(primeira);
  });

  it('regra futura não altera o cálculo de fato anterior à sua vigência', async () => {
    const atual = rule({ id: 'atual', validUntil: '2026-06-30', operation: { rateBasisPoints: 1_800 } });
    const futura = rule({ id: 'futura', version: 2, validFrom: '2026-07-01', operation: { rateBasisPoints: 2_500 } });
    // O repositório já filtra por data; a seleção do domínio é a segunda trava se um dia escapar.
    const antes = await simulateManual(lookup([futura, atual]), input);
    const depois = await simulateManual(lookup([futura, atual]), { ...input, factDate: '2026-07-01' });

    expect(antes.memory).toMatchObject({ ruleId: 'atual', resultCents: 1_800 });
    expect(depois.memory).toMatchObject({ ruleId: 'futura', resultCents: 2_500 });
  });

  it('sem regra vigente falha de forma acionável, sem calcular nada', async () => {
    const fonte = lookup([]);

    expect(await codeOf(() => simulateManual(fonte, input))).toBe(CODIGOS_DE_ERRO.TAX_RULE_NOT_APPLICABLE);
    expect(fonte.describe).not.toHaveBeenCalled();
  });

  it('duas regras vigentes são erro de integridade, sem precedência por criação', async () => {
    const antiga = rule({ id: 'antiga', version: 1 });
    const nova = rule({ id: 'nova', version: 2 });

    expect(await codeOf(() => simulateManual(lookup([antiga, nova]), input))).toBe(CODIGOS_DE_ERRO.TAX_RULE_AMBIGUOUS);
    expect(await codeOf(() => simulateManual(lookup([nova, antiga]), input))).toBe(CODIGOS_DE_ERRO.TAX_RULE_AMBIGUOUS);
  });

  it('ignora rascunho e arquivada que escapem do repositório', async () => {
    const candidatas = [rule({ id: 'rascunho', status: 'DRAFT' }), rule({ id: 'arquivada', status: 'ARCHIVED' })];

    expect(await codeOf(() => simulateManual(lookup(candidatas), input))).toBe(CODIGOS_DE_ERRO.TAX_RULE_NOT_APPLICABLE);
  });

  it.each([
    ['base fracionária', { baseCents: 10.5 }],
    ['base negativa', { baseCents: -1 }],
    ['data inexistente', { factDate: '2026-02-30' }],
  ])('recusa entrada inválida do domínio: %s', async (_nome, overrides) => {
    expect(await codeOf(() => simulateManual(lookup([rule()]), { ...input, ...overrides }))).toBe(
      CODIGOS_DE_ERRO.TAX_SIMULATION_INVALID_INPUT,
    );
  });
});
