/**
 * Avaliador tributário puro (SPEC-016 §3.4, §3.5): base → redução → alíquota → meio para cima.
 *
 * Toda a aritmética é racional exata em `bigint`; nunca há `number` fracionário (I-3). A data do
 * fato entra por parâmetro (I-8) e nada aqui lê relógio, banco, XML ou HTTP (I-12).
 */
import { lerDataCivil, type DataCivil } from '../datas/data-civil.js';
import { CODIGOS_DE_ERRO, ErroDeDominio } from '../erros.js';
import { FULL_BASIS_POINTS, isValidOperation, type TaxRule, type TaxRuleIdentity } from './model.js';

export type TaxEvaluationInput = Readonly<{ baseCents: number; factDate: DataCivil }>;

/** Fração exata em texto: `bigint` não serializa em JSON e a memória precisa ser reproduzível. */
export type ExactFraction = Readonly<{ numerator: string; denominator: string }>;

export type TaxCalculationMemory = Readonly<{
  ruleId: string;
  ruleVersion: number;
  validFrom: DataCivil;
  validUntil: DataCivil | null;
  factDate: DataCivil;
  baseCents: number;
  baseReductionBasisPoints: number;
  reducedBase: ExactFraction;
  rateBasisPoints: number;
  unrounded: ExactFraction;
  rounding: 'HALF_UP';
  resultCents: number;
}>;

export type TaxRuleCriteria = TaxRuleIdentity & Readonly<{ factDate: DataCivil }>;

const invalidInput = (message: string): ErroDeDominio =>
  new ErroDeDominio(CODIGOS_DE_ERRO.TAX_SIMULATION_INVALID_INPUT, message);

const gcd = (a: bigint, b: bigint): bigint => (b === 0n ? a : gcd(b, a % b));

const fraction = (numerator: bigint, denominator: bigint): ExactFraction => {
  const divisor = gcd(numerator, denominator) || 1n;
  return { numerator: String(numerator / divisor), denominator: String(denominator / divisor) };
};

const isEffectiveOn = (rule: TaxRule, factDate: DataCivil): boolean =>
  rule.validFrom <= factDate && (rule.validUntil === null || factDate <= rule.validUntil);

export const evaluateTaxRule = (rule: TaxRule, input: TaxEvaluationInput): TaxCalculationMemory => {
  if (!Number.isSafeInteger(input.baseCents) || input.baseCents < 0) {
    throw invalidInput('A base deve ser um inteiro não negativo em centavos.');
  }
  if (lerDataCivil(input.factDate) !== input.factDate) {
    throw invalidInput('A data do fato gerador deve ser uma data civil aaaa-mm-dd existente.');
  }
  if (!isValidOperation(rule.operation)) {
    throw invalidInput('A operação da regra tem alíquota ou redução fora de 0–100%.');
  }
  if (!isEffectiveOn(rule, input.factDate)) {
    throw new ErroDeDominio(CODIGOS_DE_ERRO.TAX_RULE_NOT_APPLICABLE, 'A regra não vigora na data do fato gerador.');
  }

  const reduction = rule.operation.baseReductionBasisPoints ?? 0;
  const scale = BigInt(FULL_BASIS_POINTS);
  const base = BigInt(input.baseCents);
  const rate = BigInt(rule.operation.rateBasisPoints);

  const reducedNumerator = base * (scale - BigInt(reduction));
  const unroundedNumerator = reducedNumerator * rate;
  const unroundedDenominator = scale * scale;
  // Meio para cima: floor(x + 1/2) com x = n/d.
  const result = (2n * unroundedNumerator + unroundedDenominator) / (2n * unroundedDenominator);

  return {
    ruleId: rule.id,
    ruleVersion: rule.version,
    validFrom: rule.validFrom,
    validUntil: rule.validUntil,
    factDate: input.factDate,
    baseCents: input.baseCents,
    baseReductionBasisPoints: reduction,
    reducedBase: fraction(reducedNumerator, scale),
    rateBasisPoints: rule.operation.rateBasisPoints,
    unrounded: fraction(unroundedNumerator, unroundedDenominator),
    rounding: 'HALF_UP',
    resultCents: Number(result),
  };
};

const sameIdentity = (rule: TaxRule, criteria: TaxRuleCriteria): boolean =>
  rule.taxType === criteria.taxType &&
  rule.regime === criteria.regime &&
  rule.operationType === criteria.operationType;

/**
 * Seleciona a única versão publicada vigente. Duas candidatas são erro de integridade: nunca há
 * "mais recente vence" (SPEC-016 §3.5). Arquivada não é selecionável: ela encerra o uso em fatos
 * novos e as simulações já feitas continuam reproduzíveis pela memória.
 */
export const selectApplicableRule = (rules: readonly TaxRule[], criteria: TaxRuleCriteria): TaxRule => {
  const candidates = rules.filter(
    (rule) => rule.status === 'PUBLISHED' && sameIdentity(rule, criteria) && isEffectiveOn(rule, criteria.factDate),
  );

  const [only, ...extra] = candidates;
  if (only === undefined) {
    throw new ErroDeDominio(CODIGOS_DE_ERRO.TAX_RULE_NOT_APPLICABLE, 'Nenhuma regra publicada vigora para esta combinação e data.');
  }
  if (extra.length > 0) {
    throw new ErroDeDominio(CODIGOS_DE_ERRO.TAX_RULE_AMBIGUOUS, 'Mais de uma regra publicada vigora para esta combinação e data.');
  }
  return only;
};
