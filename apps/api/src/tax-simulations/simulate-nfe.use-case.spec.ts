/**
 * Simulação por NF-e de teste (SPEC-016 §3.6): cada item vira simulações do mesmo caso de uso do
 * formulário, o valor declarado é comparado e nunca sobrescrito, e só o que o XML não traz (ou não
 * mapeia de forma inequívoca) aceita complemento.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { CODIGOS_DE_ERRO, ErroDeDominio, type TaxRegime, type TaxRule, type TaxType } from '@contaia/domain';
import type { NfeComplement } from '@contaia/shared';

import { parseNfeTaxInput } from '../nfe/parse-nfe-tax-input';
import { simulateNfe } from './simulate-nfe.use-case';
import type { TaxRuleLookup } from './simulate-manual.use-case';

const extrair = (nome: string) => parseNfeTaxInput(readFileSync(join(__dirname, '..', 'nfe', 'fixtures', nome)));
const COM_IBSCBS = extrair('nfe-rtc-valida.xml');
const SEM_IBSCBS = extrair('nfe-sem-ibscbs.xml');

const TAXAS: Readonly<Record<'IBS_UF' | 'IBS_MUN' | 'CBS', number>> = { IBS_UF: 10, IBS_MUN: 0, CBS: 90 };

const regra = (taxType: TaxType, regime: TaxRegime): TaxRule => ({
  id: `regra-${taxType}-${regime}`,
  version: 1,
  status: 'PUBLISHED',
  taxType,
  regime,
  operationType: 'VENDA_MERCADORIA',
  validFrom: '2026-01-01',
  validUntil: null,
  operation: { rateBasisPoints: TAXAS[taxType as 'IBS_UF' | 'IBS_MUN' | 'CBS'] ?? 0 },
});

const catalogo = (): TaxRuleLookup & { findApplicable: ReturnType<typeof vi.fn>; describe: ReturnType<typeof vi.fn> } => ({
  findApplicable: vi.fn(async (criteria) =>
    ['IBS_UF', 'IBS_MUN', 'CBS'].includes(criteria.taxType) && criteria.operationType === 'VENDA_MERCADORIA'
      ? [regra(criteria.taxType, criteria.regime)]
      : [],
  ),
  describe: vi.fn(async () => ({ source: 'Fixture de teste não oficial', fixtureNote: 'Dado de teste não oficial' })),
});

const complemento = (overrides: Partial<NfeComplement> = {}): NfeComplement => ({ operationType: 'VENDA_MERCADORIA', ...overrides });

const codigoDe = async (executar: () => Promise<unknown>): Promise<ErroDeDominio | undefined> => {
  try {
    await executar();
  } catch (erro) {
    if (erro instanceof ErroDeDominio) {
      return erro;
    }
    throw erro;
  }
  return undefined;
};

describe('NF-e com IBS/CBS declarados', () => {
  it('calcula por item e por tributo e compara com o declarado sem sobrescrevê-lo', async () => {
    const resposta = await simulateNfe(catalogo(), COM_IBSCBS, complemento());

    expect(resposta.complementsRequired).toEqual([]);
    const itens = resposta.result?.items ?? [];
    const resumo = itens.map((item) => ({
      item: item.number,
      base: item.baseCents,
      linhas: item.taxes.map((linha) => [linha.taxType, linha.simulation.memory.resultCents, linha.comparison]),
    }));

    expect(resumo).toEqual([
      {
        item: 1,
        base: 10_000,
        linhas: [
          ['IBS_UF', 10, { declaredCents: 10, calculatedCents: 10, differenceCents: 0, diverges: false }],
          ['IBS_MUN', 0, { declaredCents: 0, calculatedCents: 0, differenceCents: 0, diverges: false }],
          ['CBS', 90, { declaredCents: 90, calculatedCents: 90, differenceCents: 0, diverges: false }],
        ],
      },
      {
        item: 2,
        base: 420,
        linhas: [
          ['IBS_UF', 0, { declaredCents: 0, calculatedCents: 0, differenceCents: 0, diverges: false }],
          ['IBS_MUN', 0, { declaredCents: 0, calculatedCents: 0, differenceCents: 0, diverges: false }],
          ['CBS', 4, { declaredCents: 4, calculatedCents: 4, differenceCents: 0, diverges: false }],
        ],
      },
      {
        item: 3,
        base: 10_000,
        linhas: [
          ['IBS_UF', 10, { declaredCents: 10, calculatedCents: 10, differenceCents: 0, diverges: false }],
          ['IBS_MUN', 0, { declaredCents: 0, calculatedCents: 0, differenceCents: 0, diverges: false }],
          // Divergência apontada, sem dizer qual valor é juridicamente correto.
          ['CBS', 90, { declaredCents: 95, calculatedCents: 90, differenceCents: -5, diverges: true }],
        ],
      },
    ]);
  });

  it('agrega o total calculado e o compara com os totais declarados do documento', async () => {
    const { result } = await simulateNfe(catalogo(), COM_IBSCBS, complemento());

    expect(result?.totals).toEqual({
      calculated: { ibsUfCents: 20, ibsMunCents: 0, ibsCents: 20, cbsCents: 184 },
      ibs: { declaredCents: 20, calculatedCents: 20, differenceCents: 0, diverges: false },
      cbs: { declaredCents: 189, calculatedCents: 184, differenceCents: -5, diverges: true },
    });
  });

  it('usa a data de emissão do XML como fato gerador e o regime mapeado do CRT', async () => {
    const fonte = catalogo();

    await simulateNfe(fonte, COM_IBSCBS, complemento());

    expect(fonte.findApplicable).toHaveBeenCalledWith({
      taxType: 'CBS',
      regime: 'SIMPLES_NACIONAL',
      operationType: 'VENDA_MERCADORIA',
      factDate: '2026-06-15',
    });
  });

  it('consulta o catálogo uma vez por tributo, não uma por item', async () => {
    const fonte = catalogo();

    await simulateNfe(fonte, COM_IBSCBS, complemento());

    expect(fonte.findApplicable).toHaveBeenCalledTimes(3);
    expect(fonte.describe).toHaveBeenCalledTimes(3);
  });

  it('é reproduzível para o mesmo XML, complemento e versão de regra', async () => {
    const primeira = JSON.stringify(await simulateNfe(catalogo(), COM_IBSCBS, complemento()));
    const segunda = JSON.stringify(await simulateNfe(catalogo(), COM_IBSCBS, complemento()));

    expect(segunda).toBe(primeira);
  });

  it('o complemento não pode reescrever o que o XML já informa', async () => {
    const regime = await codigoDe(() => simulateNfe(catalogo(), COM_IBSCBS, complemento({ regime: 'LUCRO_REAL' })));
    const base = await codigoDe(() => simulateNfe(catalogo(), COM_IBSCBS, complemento({ itemBases: { '1': 1 } })));

    expect(regime?.codigo).toBe(CODIGOS_DE_ERRO.TAX_SIMULATION_INVALID_INPUT);
    expect(base?.codigo).toBe(CODIGOS_DE_ERRO.TAX_SIMULATION_INVALID_INPUT);
  });

  it('recusa base de item que não existe na NF-e', async () => {
    const erro = await codigoDe(() => simulateNfe(catalogo(), SEM_IBSCBS, complemento({ regime: 'LUCRO_PRESUMIDO', itemBases: { '1': 1, '2': 1, '3': 1 } })));

    expect(erro?.codigo).toBe(CODIGOS_DE_ERRO.TAX_SIMULATION_INVALID_INPUT);
  });
});

describe('NF-e sem os grupos IBS/CBS', () => {
  it('sem complemento devolve a extração e lista o que falta, sem calcular', async () => {
    const resposta = await simulateNfe(catalogo(), SEM_IBSCBS, null);

    expect(resposta.result).toBeNull();
    expect(resposta.extraction).toBe(SEM_IBSCBS);
    expect(resposta.complementsRequired).toEqual([
      { field: 'operationType', reason: 'NOT_IN_XML' },
      { field: 'regime', reason: 'AMBIGUOUS_IN_XML' },
      { field: 'itemBases.1', reason: 'NOT_IN_XML' },
      { field: 'itemBases.2', reason: 'NOT_IN_XML' },
    ]);
  });

  it('complemento parcial mantém só o que ainda falta', async () => {
    const resposta = await simulateNfe(catalogo(), SEM_IBSCBS, complemento({ regime: 'LUCRO_PRESUMIDO', itemBases: { '1': 25_000 } }));

    expect(resposta.result).toBeNull();
    expect(resposta.complementsRequired).toEqual([{ field: 'itemBases.2', reason: 'NOT_IN_XML' }]);
  });

  it('com o complemento completo calcula os três tributos sobre as bases informadas, sem comparação', async () => {
    const { result, complementsRequired } = await simulateNfe(
      catalogo(),
      SEM_IBSCBS,
      complemento({ regime: 'LUCRO_PRESUMIDO', itemBases: { '1': 25_000, '2': 1_000 } }),
    );

    expect(complementsRequired).toEqual([]);
    expect(result?.items.map((item) => [item.number, item.baseCents, item.taxes.map((l) => [l.taxType, l.simulation.memory.resultCents, l.comparison])])).toEqual([
      [1, 25_000, [['IBS_UF', 25, null], ['IBS_MUN', 0, null], ['CBS', 225, null]]],
      [2, 1_000, [['IBS_UF', 1, null], ['IBS_MUN', 0, null], ['CBS', 9, null]]],
    ]);
    expect(result?.totals).toEqual({
      calculated: { ibsUfCents: 26, ibsMunCents: 0, ibsCents: 26, cbsCents: 234 },
      ibs: null,
      cbs: null,
    });
  });
});

describe('falhas de regra', () => {
  it('sem regra vigente para um tributo falha de forma acionável, dizendo item e tributo', async () => {
    const fonte = catalogo();
    fonte.findApplicable.mockImplementation(async (criteria) => (criteria.taxType === 'CBS' ? [] : [regra(criteria.taxType, criteria.regime)]));

    const erro = await codigoDe(() => simulateNfe(fonte, COM_IBSCBS, complemento()));

    expect(erro?.codigo).toBe(CODIGOS_DE_ERRO.TAX_RULE_NOT_APPLICABLE);
    expect(erro?.detalhes).toMatchObject({ item: 1, taxType: 'CBS' });
  });

  it('duas regras vigentes continuam sendo erro de integridade, sem precedência', async () => {
    const fonte = catalogo();
    fonte.findApplicable.mockImplementation(async (criteria) => [regra(criteria.taxType, criteria.regime), { ...regra(criteria.taxType, criteria.regime), id: 'outra', version: 2 }]);

    const erro = await codigoDe(() => simulateNfe(fonte, COM_IBSCBS, complemento()));

    expect(erro?.codigo).toBe(CODIGOS_DE_ERRO.TAX_RULE_AMBIGUOUS);
  });
});
