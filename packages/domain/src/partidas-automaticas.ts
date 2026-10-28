export type FamiliaOrigem = 'DFE' | 'TAX_ASSESSMENT';
export type ResultadoGeracao = 'DRAFT_GENERATED' | 'NO_MATCH' | 'AMBIGUOUS_MATCH' | 'INVALID_CONFIGURATION' | 'ALREADY_GENERATED';
export type OperadorCriterio = 'EQ' | 'IN' | 'GTE' | 'LTE' | 'EXPLICIT_ANY';

export type CriterioRegra = Readonly<{ field: string; operator: OperadorCriterio; value: string | readonly string[] | null }>;
export type OrigemContabil = Readonly<{
  sourceType: FamiliaOrigem;
  sourceId: string;
  tenantId: string;
  companyId: string;
  sourceVersion: number;
  effectiveDate: string;
  competence: string;
  attributes: Readonly<Record<string, string | number | boolean | bigint | null>>;
}>;
export type RegraElegivel = Readonly<{
  ruleId: string;
  version: number;
  source: FamiliaOrigem;
  validFrom: string;
  validUntil: string | null;
  criteria: readonly CriterioRegra[];
  configurationValid?: boolean;
}>;
export type PartidaGerada = Readonly<{
  side: 'DEBIT' | 'CREDIT';
  accountId: string;
  amountCents: bigint;
  costCenterId: string | null;
  position: number;
}>;

const dataCivilValida = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month! - 1 && date.getUTCDate() === day;
};

const comparar = (valor: string | number | boolean | bigint | null, criterio: CriterioRegra): boolean => {
  if (criterio.operator === 'EXPLICIT_ANY') return criterio.value === null && valor !== null;
  if (criterio.operator === 'IN') return Array.isArray(criterio.value) && criterio.value.includes(String(valor));
  if (criterio.value === null || Array.isArray(criterio.value)) return false;
  if (criterio.operator === 'EQ') return String(valor) === criterio.value;
  const atual = Number(valor); const limite = Number(criterio.value);
  if (!Number.isFinite(atual) || !Number.isFinite(limite)) return false;
  return criterio.operator === 'GTE' ? atual >= limite : atual <= limite;
};

export const criterioCorresponde = (origem: OrigemContabil, criterio: CriterioRegra): boolean =>
  Object.hasOwn(origem.attributes, criterio.field) && comparar(origem.attributes[criterio.field]!, criterio);

export const vigenciaDaOrigem = (origem: OrigemContabil): string =>
  origem.sourceType === 'DFE' ? origem.effectiveDate : `${origem.competence}-01`;

export const regraCorresponde = (origem: OrigemContabil, regra: RegraElegivel): boolean => {
  const data = vigenciaDaOrigem(origem);
  return regra.source === origem.sourceType && dataCivilValida(data) && dataCivilValida(regra.validFrom) &&
    (regra.validUntil === null || (dataCivilValida(regra.validUntil) && regra.validUntil >= data)) &&
    regra.validFrom <= data && regra.criteria.every((criterion) => criterioCorresponde(origem, criterion));
};

export const selecionarRegraUnica = (origem: OrigemContabil, regras: readonly RegraElegivel[]):
  Readonly<{ result: 'MATCH'; rule: RegraElegivel } | { result: 'NO_MATCH' } | { result: 'INVALID_CONFIGURATION'; ruleIds: readonly string[] } | { result: 'AMBIGUOUS_MATCH'; ruleIds: readonly string[] }> => {
  const matches = regras.filter((rule) => regraCorresponde(origem, rule));
  if (matches.length === 0) return { result: 'NO_MATCH' };
  if (matches.some((rule) => rule.configurationValid === false)) return { result: 'INVALID_CONFIGURATION', ruleIds: matches.filter((rule) => rule.configurationValid === false).map(({ ruleId }) => ruleId) };
  if (matches.length > 1) return { result: 'AMBIGUOUS_MATCH', ruleIds: matches.map(({ ruleId }) => ruleId) };
  return { result: 'MATCH', rule: matches[0]! };
};

/** Gramática fechada v1: campo monetário, inteiro positivo e operações +, -, *, / com inteiros. */
export const avaliarExpressaoMonetaria = (expression: string, fields: Readonly<Record<string, bigint>>): bigint => {
  const match = /^(\w+)(?:\s*([+*/-])\s*(\d+))?$/u.exec(expression);
  if (!match) throw new Error('ACCOUNTING_RULE_INVALID_EXPRESSION');
  const amount = fields[match[1]!];
  if (amount === undefined || amount <= 0n) throw new Error('ACCOUNTING_RULE_INVALID_EXPRESSION');
  if (match[2] === undefined) {
    if (amount > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('ACCOUNTING_RULE_INVALID_EXPRESSION');
    return amount;
  }
  const operand = BigInt(match[3]!);
  if (operand <= 0n) throw new Error('ACCOUNTING_RULE_INVALID_EXPRESSION');
  let result: bigint;
  switch (match[2]) {
    case '+': result = amount + operand; break;
    case '-': result = amount - operand; break;
    case '*': result = amount * operand; break;
    case '/': if (amount % operand !== 0n) throw new Error('ACCOUNTING_RULE_INVALID_EXPRESSION'); result = amount / operand; break;
    default: throw new Error('ACCOUNTING_RULE_INVALID_EXPRESSION');
  }
  if (result <= 0n || result > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('ACCOUNTING_RULE_INVALID_EXPRESSION');
  return result;
};

export const ratearCentavos = (amount: bigint, allocations: readonly Readonly<{ costCenterId: string; percentageBasisPoints: number; position: number }>[]):
  readonly Readonly<{ costCenterId: string; amountCents: bigint; position: number }>[] => {
  if (amount <= 0n || allocations.length === 0 || allocations.reduce((sum, item) => sum + item.percentageBasisPoints, 0) !== 10_000 ||
    allocations.some((item) => !Number.isSafeInteger(item.percentageBasisPoints) || item.percentageBasisPoints <= 0 || item.position < 0) ||
    new Set(allocations.map(({ position }) => position)).size !== allocations.length) throw new Error('ACCOUNTING_RULE_ALLOCATION_INVALID');
  const ordered = [...allocations].sort((a, b) => a.position - b.position);
  const shares = ordered.map((item) => ({ ...item, amountCents: amount * BigInt(item.percentageBasisPoints) / 10_000n }));
  let remainder = amount - shares.reduce((sum, item) => sum + item.amountCents, 0n);
  for (let index = 0; remainder > 0n; index = (index + 1) % shares.length) {
    if (shares[index]!.amountCents === 0n) continue;
    shares[index]!.amountCents += 1n;
    remainder -= 1n;
  }
  if (shares.some(({ amountCents }) => amountCents <= 0n)) throw new Error('ACCOUNTING_RULE_ALLOCATION_INVALID');
  return shares.map(({ costCenterId, amountCents, position }) => ({ costCenterId, amountCents, position }));
};

export const balancearPartidas = (lines: readonly PartidaGerada[]): boolean => {
  if (lines.length < 2 || lines.some(({ amountCents }) => amountCents <= 0n || amountCents > BigInt(Number.MAX_SAFE_INTEGER))) return false;
  const debit = lines.filter(({ side }) => side === 'DEBIT').reduce((sum, line) => sum + line.amountCents, 0n);
  const credit = lines.filter(({ side }) => side === 'CREDIT').reduce((sum, line) => sum + line.amountCents, 0n);
  return debit > 0n && debit === credit;
};
