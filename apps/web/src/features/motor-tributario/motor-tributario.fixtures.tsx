/**
 * Dados e dublês de prova do motor tributário (SPEC-016). Só os testes importam este arquivo.
 *
 * Todo dado aqui é sintético e de teste: nenhuma alíquota representa legislação.
 */
import type { NfeExtractionDto, NfeSimulationDto, TaxRulePageDto, TaxRuleVersionDto, TaxSimulationResultDto } from '@contaia/shared';
import { vi } from 'vitest';

export { Envolvido, instalarFetch, json, problema } from '../carteira/carteira.fixtures';
export type { Roteador } from '../carteira/carteira.fixtures';

export const REGRA_ID = '0198f3c2-0000-7000-8000-000000000003';
export const OUTRA_REGRA_ID = '0198f3c2-0000-7000-8000-000000000004';
export const BASE = '/api/proxy/tax-rules';

export const regra = (sobrescritas: Partial<TaxRuleVersionDto> = {}): TaxRuleVersionDto => ({
  id: REGRA_ID,
  taxRuleId: '0198f3c2-0000-7000-8000-0000000000a1',
  versionNumber: 1,
  lockVersion: 1,
  status: 'PUBLISHED',
  taxType: 'ICMS',
  regime: 'LUCRO_PRESUMIDO',
  operationType: 'VENDA_MERCADORIA',
  validFrom: '2026-01-01',
  validUntil: null,
  baseReductionBasisPoints: null,
  rateBasisPoints: 1_800,
  source: 'Fixture de teste não oficial',
  fixtureNote: 'Dado de teste não oficial',
  createdBy: '0198f3c2-0000-7000-8000-000000000001',
  createdAt: '2026-09-20T12:00:00.000Z',
  publishedAt: '2026-09-20T12:05:00.000Z',
  archivedAt: null,
  ...sobrescritas,
});

export const rascunho = (sobrescritas: Partial<TaxRuleVersionDto> = {}): TaxRuleVersionDto =>
  regra({ status: 'DRAFT', publishedAt: null, ...sobrescritas });

export const pagina = (itens: readonly TaxRuleVersionDto[], sobrescritas: Partial<TaxRulePageDto> = {}): TaxRulePageDto => ({
  items: itens,
  total: itens.length,
  page: 1,
  pageSize: 25,
  canAdminister: true,
  ...sobrescritas,
});

export const simulacao = (sobrescritas: Partial<TaxSimulationResultDto['memory']> = {}): TaxSimulationResultDto => ({
  rule: {
    id: REGRA_ID,
    versionNumber: 1,
    taxType: 'ICMS',
    regime: 'LUCRO_PRESUMIDO',
    operationType: 'VENDA_MERCADORIA',
    validFrom: '2026-01-01',
    validUntil: null,
    source: 'Fixture de teste não oficial',
    fixtureNote: 'Dado de teste não oficial',
  },
  memory: {
    ruleId: REGRA_ID,
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
    ...sobrescritas,
  },
});

const linhaDaNfe = (
  taxType: 'IBS_UF' | 'IBS_MUN' | 'CBS',
  resultCents: number,
  declaredCents: number | null,
  baseCents = 10_000,
) => ({
  taxType,
  simulation: {
    ...simulacao({ baseCents, resultCents, baseReductionBasisPoints: 0, reducedBase: { numerator: String(baseCents), denominator: '1' } }),
    rule: { ...simulacao().rule, taxType },
  },
  comparison:
    declaredCents === null
      ? null
      : {
          declaredCents,
          calculatedCents: resultCents,
          differenceCents: resultCents - declaredCents,
          diverges: resultCents !== declaredCents,
        },
});

/** Dois itens: o 1 confere; o 2 diverge na CBS (calculado 90, declarado 95). */
export const resultadoDaNfe = (): NonNullable<NfeSimulationDto['result']> => ({
  items: [
    { number: 1, baseCents: 10_000, taxes: [linhaDaNfe('IBS_UF', 10, 10), linhaDaNfe('IBS_MUN', 0, 0), linhaDaNfe('CBS', 90, 90)] },
    { number: 2, baseCents: 10_000, taxes: [linhaDaNfe('IBS_UF', 10, 10), linhaDaNfe('IBS_MUN', 0, 0), linhaDaNfe('CBS', 90, 95)] },
  ],
  totals: {
    calculated: { ibsUfCents: 20, ibsMunCents: 0, ibsCents: 20, cbsCents: 180 },
    ibs: { declaredCents: 20, calculatedCents: 20, differenceCents: 0, diverges: false },
    cbs: { declaredCents: 185, calculatedCents: 180, differenceCents: -5, diverges: true },
  },
});

export const extracao = (sobrescritas: Partial<NfeExtractionDto> = {}): NfeExtractionDto => ({
  layout: { nt: '2025.002', ntVersion: '1.50', nfeVersion: '4.00' },
  issueDate: '2026-06-15',
  regime: 'SIMPLES_NACIONAL',
  items: [
    {
      number: 1,
      productCents: 10_000,
      ibsCbs: {
        baseCents: 10_000,
        ibsUf: { ratePercent: '0.1000', valueCents: 10 },
        ibsMun: { ratePercent: '0.0000', valueCents: 0 },
        cbs: { ratePercent: '0.9000', valueCents: 90 },
      },
    },
    {
      number: 2,
      productCents: 10_000,
      ibsCbs: {
        baseCents: 10_000,
        ibsUf: { ratePercent: '0.1000', valueCents: 10 },
        ibsMun: { ratePercent: '0.0000', valueCents: 0 },
        cbs: { ratePercent: '0.9500', valueCents: 95 },
      },
    },
  ],
  declaredTotals: { ibsCents: 20, cbsCents: 185 },
  ...sobrescritas,
});

export const respostaDaNfe = (sobrescritas: Partial<NfeSimulationDto> = {}): NfeSimulationDto => ({
  extraction: extracao(),
  complementsRequired: [{ field: 'operationType', reason: 'NOT_IN_XML' }],
  result: null,
  ...sobrescritas,
});

/** URL dublada com estado de verdade: `replace` muda a URL e quem lê `useSearchParams` renderiza de novo. */
const criarNavegacao = () => {
  let parametros = new URLSearchParams();
  const ouvintes = new Set<() => void>();

  const ir = (destino: string): void => {
    const consulta = destino.includes('?') ? destino.slice(destino.indexOf('?') + 1) : '';
    parametros = new URLSearchParams(consulta);
    ouvintes.forEach((ouvinte) => ouvinte());
  };

  return {
    ler: (): URLSearchParams => parametros,
    assinar: (ouvinte: () => void): (() => void) => {
      ouvintes.add(ouvinte);

      return () => ouvintes.delete(ouvinte);
    },
    definir: (consulta: string): void => {
      parametros = new URLSearchParams(consulta);
      ouvintes.forEach((ouvinte) => ouvinte());
    },
    replace: vi.fn(ir),
    push: vi.fn(ir),
  };
};

export const navegacao = criarNavegacao();
