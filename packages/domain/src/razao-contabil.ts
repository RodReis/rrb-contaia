export type LadoContabil = 'DEBIT' | 'CREDIT';
export type NaturezaSaldo = LadoContabil | 'ZERO';
export type FiltroCentroCusto = Readonly<{ tipo: 'TODOS' }> | Readonly<{ tipo: 'SEM_CENTRO' }> | Readonly<{ tipo: 'CENTRO'; centroCustoId: string }>;

export type MovimentoParaBalancete = Readonly<{
  accountId: string;
  costCenterId: string | null;
  competence: string;
  side: LadoContabil;
  amountCents: number;
}>;

export type ContaParaBalancete = Readonly<{
  accountId: string;
  code: string;
  name: string;
  parentAccountId: string | null;
  type: 'ANALYTICAL' | 'SYNTHETIC';
  normalBalance: LadoContabil;
}>;

export type LinhaBalancete = Readonly<{
  accountId: string;
  code: string;
  name: string;
  type: 'ANALYTICAL' | 'SYNTHETIC';
  normalBalance: LadoContabil;
  level: number;
  parentAccountId: string | null;
  openingBalanceCents: number;
  debitCents: number;
  creditCents: number;
  closingBalanceCents: number;
  closingNature: NaturezaSaldo;
  movementCount: number;
}>;

export type ResultadoBalancete = Readonly<{
  lines: readonly LinhaBalancete[];
  totalDebitCents: number;
  totalCreditCents: number;
}>;

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const competenciaValida = (value: string): boolean => /^\d{4}-(0[1-9]|1[0-2])$/.test(value);

const paraInteiroSeguro = (value: bigint): number => {
  if (value > MAX_SAFE || value < -MAX_SAFE) throw new RangeError('LEDGER_TOTAL_OUT_OF_RANGE');
  return Number(value);
};

const naturezaDoSaldo = (value: bigint): NaturezaSaldo => value > 0n ? 'DEBIT' : value < 0n ? 'CREDIT' : 'ZERO';

/** Calculates a trial balance from immutable movements and an explicit catalog snapshot. */
export const calcularBalancete = (
  movements: readonly MovimentoParaBalancete[],
  accounts: readonly ContaParaBalancete[],
  fromCompetence: string,
  toCompetence: string,
  costCenterFilter: FiltroCentroCusto = { tipo: 'TODOS' },
  includeZeroAccounts = true,
): ResultadoBalancete => {
  if (!competenciaValida(fromCompetence) || !competenciaValida(toCompetence) || fromCompetence > toCompetence) {
    throw new RangeError('LEDGER_PERIOD_INVALID');
  }

  const accountById = new Map(accounts.map((account) => [account.accountId, account]));
  const parentByChild = new Map<string, string>();
  for (const account of accounts) if (account.parentAccountId) parentByChild.set(account.accountId, account.parentAccountId);

  const values = new Map<string, { opening: bigint; debit: bigint; credit: bigint; count: number }>();
  for (const account of accounts) values.set(account.accountId, { opening: 0n, debit: 0n, credit: 0n, count: 0 });

  for (const movement of movements) {
    if (!competenciaValida(movement.competence) || !Number.isSafeInteger(movement.amountCents) || movement.amountCents <= 0) {
      throw new RangeError('LEDGER_SOURCE_INVALID');
    }
    const sourceAccount = accountById.get(movement.accountId);
    if (!sourceAccount || sourceAccount.type !== 'ANALYTICAL') throw new RangeError(`LEDGER_SOURCE_INVALID:account:${movement.accountId}`);
    if (costCenterFilter.tipo === 'SEM_CENTRO' && movement.costCenterId !== null) continue;
    if (costCenterFilter.tipo === 'CENTRO' && movement.costCenterId !== costCenterFilter.centroCustoId) continue;

    const amount = BigInt(movement.amountCents);
    let targetId: string | undefined = movement.accountId;
    const visited = new Set<string>();
    while (targetId) {
      if (visited.has(targetId)) throw new RangeError(`LEDGER_SOURCE_INVALID:parent-cycle:${targetId}`);
      visited.add(targetId);
      const target = accountById.get(targetId);
      if (!target) throw new RangeError(`LEDGER_SOURCE_INVALID:missing-parent:${targetId}`);
      const totals = values.get(targetId)!;
      if (movement.competence < fromCompetence) totals.opening += movement.side === 'DEBIT' ? amount : -amount;
      if (movement.competence >= fromCompetence && movement.competence <= toCompetence) {
        if (movement.side === 'DEBIT') totals.debit += amount;
        else totals.credit += amount;
        totals.count += 1;
      }
      if (movement.competence <= toCompetence) totals.opening += 0n;
      targetId = parentByChild.get(targetId);
    }
  }

  const depthById = new Map<string, number>();
  const depth = (account: ContaParaBalancete, visiting = new Set<string>()): number => {
    if (depthById.has(account.accountId)) return depthById.get(account.accountId)!;
    if (visiting.has(account.accountId)) throw new RangeError('LEDGER_SOURCE_INVALID');
    visiting.add(account.accountId);
    const parent = account.parentAccountId ? accountById.get(account.parentAccountId) : undefined;
    if (account.parentAccountId && (!parent || parent.type !== 'SYNTHETIC')) throw new RangeError('LEDGER_SOURCE_INVALID');
    const value = parent ? depth(parent, visiting) + 1 : 0;
    depthById.set(account.accountId, value);
    return value;
  };

  const activeAccounts = accounts.filter((account) => includeZeroAccounts || (values.get(account.accountId)!.count > 0 || values.get(account.accountId)!.opening !== 0n));
  const lines = activeAccounts.map((account): LinhaBalancete => {
    const totals = values.get(account.accountId)!;
    const closing = totals.opening + totals.debit - totals.credit;
    return {
      accountId: account.accountId,
      code: account.code,
      name: account.name,
      type: account.type,
      normalBalance: account.normalBalance,
      level: depth(account),
      parentAccountId: account.parentAccountId,
      openingBalanceCents: paraInteiroSeguro(totals.opening),
      debitCents: paraInteiroSeguro(totals.debit),
      creditCents: paraInteiroSeguro(totals.credit),
      closingBalanceCents: paraInteiroSeguro(closing),
      closingNature: naturezaDoSaldo(closing),
      movementCount: totals.count,
    };
  }).sort((left, right) => left.code.localeCompare(right.code, 'en'));

  // Account totals include synthetic roll-ups; only analytic accounts form the overall debit/credit pair.
  const totalDebit = lines.filter((line) => line.type === 'ANALYTICAL').reduce((sum, line) => sum + BigInt(line.debitCents), 0n);
  const totalCredit = lines.filter((line) => line.type === 'ANALYTICAL').reduce((sum, line) => sum + BigInt(line.creditCents), 0n);
  return { lines, totalDebitCents: paraInteiroSeguro(totalDebit), totalCreditCents: paraInteiroSeguro(totalCredit) };
};
