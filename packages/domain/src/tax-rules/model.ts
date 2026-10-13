/**
 * Modelo do catálogo tributário global (SPEC-016 §3.1). Sem tenant, banco, relógio ou XML.
 *
 * Dinheiro em centavos inteiros e percentuais em centésimos de ponto percentual (I-3):
 * `10_000` = 100%.
 */
import type { DataCivil } from '../datas/data-civil.js';

export const TAX_TYPES = ['ICMS', 'PIS', 'COFINS', 'IBS_UF', 'IBS_MUN', 'CBS'] as const;
export type TaxType = (typeof TAX_TYPES)[number];

export const TAX_REGIMES = ['SIMPLES_NACIONAL', 'LUCRO_PRESUMIDO', 'LUCRO_REAL'] as const;
export type TaxRegime = (typeof TAX_REGIMES)[number];

export const TAX_RULE_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;
export type TaxRuleStatus = (typeof TAX_RULE_STATUSES)[number];

/** 100% em centésimos de ponto percentual. */
export const FULL_BASIS_POINTS = 10_000;

export type TaxRuleOperation = Readonly<{
  baseReductionBasisPoints?: number;
  rateBasisPoints: number;
}>;

export type TaxRuleIdentity = Readonly<{
  taxType: TaxType;
  regime: TaxRegime;
  operationType: string;
}>;

export type TaxRule = TaxRuleIdentity &
  Readonly<{
    id: string;
    version: number;
    status: TaxRuleStatus;
    validFrom: DataCivil;
    validUntil: DataCivil | null;
    operation: TaxRuleOperation;
  }>;

export const isBasisPoints = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= FULL_BASIS_POINTS;

export const isValidOperation = (operation: TaxRuleOperation): boolean =>
  isBasisPoints(operation.rateBasisPoints) &&
  (operation.baseReductionBasisPoints === undefined || isBasisPoints(operation.baseReductionBasisPoints));
