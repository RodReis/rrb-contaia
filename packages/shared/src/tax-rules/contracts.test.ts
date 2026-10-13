/**
 * Contratos públicos do catálogo e da simulação tributária (SPEC-016 §6.2).
 */
import { describe, expect, it } from 'vitest';

import {
  CreateTaxRuleSchema,
  ListTaxRulesQuerySchema,
  ManualTaxSimulationSchema,
  TAX_OPERATION_TYPES,
  TaxRuleCommandSchema,
  UpdateTaxRuleSchema,
} from './contracts.js';

const validRule = {
  taxType: 'ICMS',
  regime: 'LUCRO_PRESUMIDO',
  operationType: 'VENDA_MERCADORIA',
  validFrom: '2026-01-01',
  validUntil: null,
  baseReductionBasisPoints: null,
  rateBasisPoints: 1_800,
  source: 'Fixture de teste não oficial',
  fixtureNote: 'Dado de teste não oficial',
};

describe('CreateTaxRuleSchema', () => {
  it('aceita identidade, vigência, operação tipada, fonte e aviso de fixture', () => {
    expect(CreateTaxRuleSchema.parse(validRule)).toEqual(validRule);
    expect(CreateTaxRuleSchema.parse({ ...validRule, validUntil: '2026-12-31', baseReductionBasisPoints: 3_333 })).toMatchObject({
      validUntil: '2026-12-31',
      baseReductionBasisPoints: 3_333,
    });
  });

  it.each([
    ['estado', { status: 'PUBLISHED' }],
    ['autor', { createdBy: '0198f3c2-0000-7000-8000-000000000001' }],
    ['total calculado', { resultCents: 100 }],
    ['expressão livre', { formula: 'base * 0.18' }],
    ['versão otimista no corpo de criação', { expectedVersion: 1 }],
  ])('recusa campo que o cliente não pode enviar: %s', (_nome, extra) => {
    expect(CreateTaxRuleSchema.safeParse({ ...validRule, ...extra }).success).toBe(false);
  });

  it.each([
    ['tributo fora da lista', { taxType: 'ISS' }],
    ['regime fora da lista', { regime: 'MEI' }],
    ['operação fora do catálogo tipado', { operationType: 'OPERACAO_LIVRE' }],
    ['data não civil', { validFrom: '2026-02-30' }],
    ['data em outro formato', { validFrom: '01/01/2026' }],
    ['vigência final anterior à inicial', { validFrom: '2026-06-30', validUntil: '2026-01-01' }],
    ['alíquota acima de 100%', { rateBasisPoints: 10_001 }],
    ['alíquota fracionária', { rateBasisPoints: 18.5 }],
    ['alíquota negativa', { rateBasisPoints: -1 }],
    ['redução acima de 100%', { baseReductionBasisPoints: 10_001 }],
    ['alíquota como texto', { rateBasisPoints: '1800' }],
    ['fonte vazia', { source: '   ' }],
    ['fonte longa demais', { source: 'x'.repeat(501) }],
  ])('recusa %s', (_nome, override) => {
    expect(CreateTaxRuleSchema.safeParse({ ...validRule, ...override }).success).toBe(false);
  });

  it('aceita vigência de um dia só (limites inclusivos)', () => {
    expect(CreateTaxRuleSchema.safeParse({ ...validRule, validFrom: '2026-03-01', validUntil: '2026-03-01' }).success).toBe(true);
  });

  it('lista exatamente os tipos de operação do catálogo tipado', () => {
    expect(TAX_OPERATION_TYPES.length).toBeGreaterThan(0);
    for (const operationType of TAX_OPERATION_TYPES) {
      expect(CreateTaxRuleSchema.safeParse({ ...validRule, operationType }).success).toBe(true);
    }
  });
});

describe('UpdateTaxRuleSchema', () => {
  const { taxType, regime, operationType, ...edit } = validRule;
  void taxType;
  void regime;
  void operationType;

  it('exige a versão esperada e não aceita mudar a identidade', () => {
    expect(UpdateTaxRuleSchema.parse({ ...edit, expectedVersion: 2 })).toEqual({ ...edit, expectedVersion: 2 });
    expect(UpdateTaxRuleSchema.safeParse(edit).success).toBe(false);
    expect(UpdateTaxRuleSchema.safeParse({ ...edit, expectedVersion: 2, taxType: 'PIS' }).success).toBe(false);
    expect(UpdateTaxRuleSchema.safeParse({ ...edit, expectedVersion: 0 }).success).toBe(false);
    expect(UpdateTaxRuleSchema.safeParse({ ...edit, expectedVersion: 1.5 }).success).toBe(false);
  });

  it('valida a vigência como na criação', () => {
    expect(
      UpdateTaxRuleSchema.safeParse({ ...edit, expectedVersion: 1, validFrom: '2026-06-30', validUntil: '2026-01-01' }).success,
    ).toBe(false);
  });
});

describe('TaxRuleCommandSchema', () => {
  it('publicar e arquivar enviam só a versão esperada', () => {
    expect(TaxRuleCommandSchema.parse({ expectedVersion: 3 })).toEqual({ expectedVersion: 3 });
    expect(TaxRuleCommandSchema.safeParse({}).success).toBe(false);
    expect(TaxRuleCommandSchema.safeParse({ expectedVersion: 3, status: 'ARCHIVED' }).success).toBe(false);
  });
});

describe('ListTaxRulesQuerySchema', () => {
  it('aplica paginação padrão e converte números vindos da query string', () => {
    expect(ListTaxRulesQuerySchema.parse({})).toEqual({ page: 1, pageSize: 25 });
    expect(ListTaxRulesQuerySchema.parse({ page: '2', pageSize: '10', taxType: 'CBS', status: 'PUBLISHED', validOn: '2026-06-01' })).toEqual({
      page: 2,
      pageSize: 10,
      taxType: 'CBS',
      status: 'PUBLISHED',
      validOn: '2026-06-01',
    });
  });

  it.each([
    ['página zero', { page: '0' }],
    ['página muito grande por item', { pageSize: '101' }],
    ['filtro desconhecido', { sort: 'x' }],
    ['estado inexistente', { status: 'DELETED' }],
    ['data de vigência inválida', { validOn: '2026-13-01' }],
  ])('recusa %s', (_nome, query) => {
    expect(ListTaxRulesQuerySchema.safeParse(query).success).toBe(false);
  });
});

describe('ManualTaxSimulationSchema', () => {
  const manual = {
    factDate: '2026-06-15',
    regime: 'LUCRO_PRESUMIDO',
    taxType: 'ICMS',
    operationType: 'VENDA_MERCADORIA',
    baseCents: 10_000,
  };

  it('aceita data civil, regime, tributo, operação e base em centavos', () => {
    expect(ManualTaxSimulationSchema.parse(manual)).toEqual(manual);
    expect(ManualTaxSimulationSchema.parse({ ...manual, baseCents: 0 }).baseCents).toBe(0);
    expect(ManualTaxSimulationSchema.parse({ ...manual, baseCents: Number.MAX_SAFE_INTEGER }).baseCents).toBe(Number.MAX_SAFE_INTEGER);
  });

  it.each([
    ['base fracionária', { baseCents: 10.5 }],
    ['base negativa', { baseCents: -1 }],
    ['base acima do inteiro seguro', { baseCents: Number.MAX_SAFE_INTEGER + 1 }],
    ['base em texto', { baseCents: '10000' }],
    ['data inexistente', { factDate: '2026-02-30' }],
    ['regime inválido', { regime: 'MEI' }],
    ['alíquota enviada pelo navegador', { rateBasisPoints: 1_800 }],
    ['fórmula enviada pelo navegador', { formula: 'base*0.18' }],
  ])('recusa %s', (_nome, override) => {
    expect(ManualTaxSimulationSchema.safeParse({ ...manual, ...override }).success).toBe(false);
  });
});
