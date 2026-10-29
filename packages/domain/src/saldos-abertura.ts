import { createHash } from 'node:crypto';

export type OpeningBalanceSource = 'MANUAL' | 'CSV';
export type OpeningBalanceLine = Readonly<{
  accountId: string;
  costCenterId: string | null;
  debitCents: number;
  creditCents: number;
  note: string | null;
}>;
export type OpeningAccountRule = Readonly<{
  active: boolean;
  analytical: boolean;
  costCenterPolicy: 'OPTIONAL' | 'REQUIRED' | 'FORBIDDEN';
  tenantId?: string;
  companyId?: string;
  costCenterTenantId?: string;
  costCenterCompanyId?: string;
}>;
export type OpeningBalanceError = Readonly<{ code: string; line: number | null; message: string }>;
export type OpeningValidationContext = Readonly<{ tenantId: string; companyId: string }>;
export type OpeningBalanceSnapshot = Readonly<{
  tenantId: string;
  companyId: string;
  version: number;
  baseDate: string;
  source: OpeningBalanceSource;
  debitCents: number;
  creditCents: number;
  lines: readonly OpeningBalanceLine[];
}>;
export type OpeningMovementDate = Readonly<{ competence: string; accountingDate: string }>;

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const BASE_DATE = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/u;
const invalidLine = (): RangeError => new RangeError('OPENING_BALANCE_LINE_INVALID');

const inteiroSeguro = (value: bigint): number => {
  if (value < 0n || value > MAX_SAFE) throw new RangeError('OPENING_BALANCE_LINE_INVALID');
  return Number(value);
};

export const validateOpeningBaseDate = (value: string): readonly string[] => {
  const match = BASE_DATE.exec(value);
  if (!match) return ['OPENING_BALANCE_BASE_DATE_INVALID'];
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return year >= 1 && day <= daysInMonth ? [] : ['OPENING_BALANCE_BASE_DATE_INVALID'];
};

export const openingMovementDate = (baseDate:string):OpeningMovementDate=>{
  if(validateOpeningBaseDate(baseDate).length)throw new RangeError('OPENING_BALANCE_BASE_DATE_INVALID');
  const next=new Date(new Date(`${baseDate}T00:00:00Z`).getTime()+86_400_000).toISOString().slice(0,10);
  return {accountingDate:next,competence:next.slice(0,7)};
};

/** Converts a strict Brazilian decimal (dot thousands, comma decimal) to safe integer cents. */
export const parseOpeningAmount = (input: string): number => {
  const value = input.trim();
  if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/u.test(value)) throw invalidLine();
  const [whole = '', fraction = ''] = value.split(',');
  const normalizedWhole = whole.replaceAll('.', '');
  const cents = BigInt(normalizedWhole) * 100n + BigInt(fraction.padEnd(2, '0') || '0');
  return inteiroSeguro(cents);
};

export const validateOpeningLines = (
  lines: readonly OpeningBalanceLine[],
  accounts: ReadonlyMap<string, OpeningAccountRule>,
  costCenters: ReadonlyMap<string, boolean>,
  context?: OpeningValidationContext,
): readonly OpeningBalanceError[] => {
  const errors: OpeningBalanceError[] = [];
  const seen = new Set<string>();
  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1;
    const center = line.costCenterId ?? '';
    const key = `${line.accountId}\u0000${center}`;
    if (seen.has(key)) errors.push({ code: 'OPENING_BALANCE_DUPLICATE_LINE', line: lineNumber, message: 'Conta e centro de custo repetidos.' });
    seen.add(key);

    const account = accounts.get(line.accountId);
    if (!account || !account.active || !account.analytical || (context !== undefined && (account.tenantId !== context.tenantId || account.companyId !== context.companyId))) {
      errors.push({ code: 'OPENING_BALANCE_ACCOUNT_INVALID', line: lineNumber, message: 'Conta inexistente, arquivada ou sintética.' });
    }
    const debitValid = Number.isSafeInteger(line.debitCents) && line.debitCents >= 0;
    const creditValid = Number.isSafeInteger(line.creditCents) && line.creditCents >= 0;
    if (!debitValid || !creditValid || (line.debitCents > 0) === (line.creditCents > 0)) {
      errors.push({ code: 'OPENING_BALANCE_LINE_INVALID', line: lineNumber, message: 'Informe somente débito ou crédito positivo em centavos inteiros.' });
    }
    if (account) {
      if (account.costCenterPolicy === 'REQUIRED' && line.costCenterId === null) {
        errors.push({ code: 'OPENING_BALANCE_COST_CENTER_INVALID', line: lineNumber, message: 'Esta conta exige centro de custo.' });
      } else if (account.costCenterPolicy === 'FORBIDDEN' && line.costCenterId !== null) {
        errors.push({ code: 'OPENING_BALANCE_COST_CENTER_INVALID', line: lineNumber, message: 'Esta conta não permite centro de custo.' });
      } else if (line.costCenterId !== null && (costCenters.get(line.costCenterId) !== true || (context !== undefined && (account.costCenterTenantId !== context.tenantId || account.costCenterCompanyId !== context.companyId)))) {
        errors.push({ code: 'OPENING_BALANCE_COST_CENTER_INVALID', line: lineNumber, message: 'Centro de custo inexistente, arquivado ou de outra empresa.' });
      }
    } else if (line.costCenterId !== null && costCenters.get(line.costCenterId) !== true) {
      errors.push({ code: 'OPENING_BALANCE_COST_CENTER_INVALID', line: lineNumber, message: 'Centro de custo inexistente, arquivado ou de outra empresa.' });
    }
  }
  return errors;
};

export const openingBalanceTotals = (lines: readonly OpeningBalanceLine[]): Readonly<{ debitCents: number; creditCents: number; balanced: boolean }> => {
  const debit = lines.reduce((sum, line) => sum + BigInt(line.debitCents), 0n);
  const credit = lines.reduce((sum, line) => sum + BigInt(line.creditCents), 0n);
  return { debitCents: inteiroSeguro(debit), creditCents: inteiroSeguro(credit), balanced: debit === credit };
};

const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right, 'en')).map(([key, entry]) => [key, canonical(entry)]));
  }
  return value;
};

export const canonicalOpeningBalance = (snapshot: OpeningBalanceSnapshot): string => {
  if (validateOpeningBaseDate(snapshot.baseDate).length || !Number.isSafeInteger(snapshot.version) || snapshot.version < 1) throw new RangeError('OPENING_BALANCE_BASE_DATE_INVALID');
  const totals = openingBalanceTotals(snapshot.lines);
  if (totals.debitCents !== snapshot.debitCents || totals.creditCents !== snapshot.creditCents || !totals.balanced) throw new RangeError('OPENING_BALANCE_UNBALANCED');
  const lines = [...snapshot.lines].sort((left, right) => left.accountId.localeCompare(right.accountId, 'en') || (left.costCenterId ?? '').localeCompare(right.costCenterId ?? '', 'en')).map(canonical);
  return JSON.stringify(canonical({ ...snapshot, lines }));
};

export const hashOpeningBalance = (snapshot: OpeningBalanceSnapshot): string =>
  createHash('sha256').update(canonicalOpeningBalance(snapshot), 'utf8').digest('hex');
