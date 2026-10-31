import { createHash } from "node:crypto";

export type TipoLinhaDre = "DETAIL" | "SUBTOTAL";
export type OperadorDre = "ADD" | "SUBTRACT";
export type ModoPeriodoDre = "MONTH" | "YEAR_TO_DATE";
export type VisaoDre = "SYNTHETIC" | "ANALYTIC";
export type NaturezaContaResultado = "REVENUE" | "EXPENSE" | "OTHER";
export type LinhaDre = Readonly<{
  code: string;
  title: string;
  type: TipoLinhaDre;
  order: number;
  level: number;
  parentCode: string | null;
  presentationSign: 1 | -1;
  accountIds: readonly string[];
  components: readonly Readonly<{ code: string; operator: OperadorDre }>[];
  verticalBasis: boolean;
}>;
export type ContaResultadoDre = Readonly<{
  accountId: string;
  code: string;
  name: string;
  nature: NaturezaContaResultado;
  eligible: boolean;
}>;
export type MovimentoDre = Readonly<{
  accountId: string;
  competence: string;
  debitCents: number;
  creditCents: number;
}>;
export type ValorContaDre = Readonly<{
  accountId: string;
  currentCents: number;
  previousCents: number | null;
}>;
export type LinhaRelatorioDre = Readonly<{
  code: string;
  title: string;
  type: TipoLinhaDre;
  level: number;
  presentationSign: 1 | -1;
  currentCents: number;
  previousCents: number | null;
  verticalBasisPoints: number | "NOT_APPLICABLE" | "NOT_AVAILABLE";
  horizontalCents: number | null;
  horizontalBasisPoints: number | "NOT_APPLICABLE" | "NOT_AVAILABLE";
  accounts: readonly Readonly<{
    code: string;
    name: string;
    currentCents: number;
    previousCents: number | null;
  }>[];
}>;
export type RelatorioDre = Readonly<{
  reportStatus: "COMPLETE" | "INCOMPLETE";
  status: "COMPLETE" | "INCOMPLETE";
  lines: readonly LinhaRelatorioDre[];
  unmappedAccounts: readonly Readonly<{
    accountId: string;
    code: string;
    name: string;
    currentCents: number;
  }>[];
  hash: string;
}>;

const competencePattern = /^\d{4}-(0[1-9]|1[0-2])$/u;
const safe = (value: bigint): number => {
  if (
    value > BigInt(Number.MAX_SAFE_INTEGER) ||
    value < BigInt(Number.MIN_SAFE_INTEGER)
  )
    throw new RangeError("STATEMENT_RECONCILIATION_FAILED");
  return Number(value);
};

export const validateStatementStructure = (
  lines: readonly LinhaDre[],
  accounts: readonly ContaResultadoDre[],
): readonly string[] => {
  const errors: string[] = [];
  const byCode = new Map<string, LinhaDre>();
  const accountById = new Map(
    accounts.map((account) => [account.accountId, account]),
  );
  const mapped = new Map<string, string>();
  const ordered = [...lines].sort((a, b) => a.order - b.order);
  if (new Set(lines.map((line) => line.code)).size !== lines.length)
    errors.push("STATEMENT_LINE_CODE_INVALID");
  if (ordered.length === 0) errors.push("STATEMENT_STRUCTURE_EMPTY");
  if (
    ordered.some(
      (line, index) =>
        !Number.isSafeInteger(line.order) || line.order !== index + 1,
    )
  )
    errors.push("STATEMENT_LINE_ORDER_INVALID");
  for (const line of ordered) {
    if (!line.code.trim() || line.code.length > 40 || byCode.has(line.code))
      errors.push("STATEMENT_LINE_CODE_INVALID");
    if (!line.title.trim() || line.title.length > 160)
      errors.push("STATEMENT_LINE_TITLE_INVALID");
    if (!Number.isSafeInteger(line.level) || line.level < 0 || line.level > 8)
      errors.push("STATEMENT_LINE_LEVEL_INVALID");
    if (
      line.level === 0
        ? line.parentCode !== null
        : !line.parentCode ||
          !byCode.has(line.parentCode) ||
          byCode.get(line.parentCode)?.level !== line.level - 1
    )
      errors.push("STATEMENT_LINE_TREE_INVALID");
    if (line.parentCode && byCode.get(line.parentCode)?.type !== "SUBTOTAL")
      errors.push("STATEMENT_LINE_TREE_INVALID");
    if (line.presentationSign !== 1 && line.presentationSign !== -1)
      errors.push("STATEMENT_LINE_SIGN_INVALID");
    if (line.type === "DETAIL") {
      if (line.components.length)
        errors.push("STATEMENT_DETAIL_FORMULA_INVALID");
      for (const accountId of line.accountIds) {
        const account = accountById.get(accountId);
        if (
          !account?.eligible ||
          (account.nature !== "REVENUE" && account.nature !== "EXPENSE")
        )
          errors.push("STATEMENT_ACCOUNT_NOT_ELIGIBLE");
        if (mapped.has(accountId))
          errors.push("STATEMENT_ACCOUNT_ALREADY_MAPPED");
        mapped.set(accountId, line.code);
      }
    } else {
      if (line.accountIds.length || line.components.length === 0)
        errors.push("STATEMENT_SUBTOTAL_INVALID");
      const seen = new Set<string>();
      for (const component of line.components) {
        const source = byCode.get(component.code);
        if (
          !source ||
          source.order >= line.order ||
          seen.has(component.code) ||
          (component.operator !== "ADD" && component.operator !== "SUBTRACT")
        )
          errors.push("STATEMENT_SUBTOTAL_INVALID");
        seen.add(component.code);
      }
    }
    byCode.set(line.code, line);
  }
  if (ordered.filter((line) => line.verticalBasis).length !== 1)
    errors.push("STATEMENT_VERTICAL_BASIS_INVALID");
  for (const account of accounts)
    if (
      account.eligible &&
      (account.nature === "REVENUE" || account.nature === "EXPENSE") &&
      !mapped.has(account.accountId)
    )
      errors.push("STATEMENT_ACCOUNT_UNMAPPED");
  return [...new Set(errors)];
};

const percentual = (
  numerator: bigint,
  denominator: bigint,
): number | "NOT_APPLICABLE" => {
  if (denominator === 0n) return "NOT_APPLICABLE";
  const negative = numerator < 0n !== denominator < 0n;
  const absoluteNumerator = numerator < 0n ? -numerator : numerator;
  const absoluteDenominator = denominator < 0n ? -denominator : denominator;
  const rounded =
    (absoluteNumerator * 10_000n + absoluteDenominator / 2n) /
    absoluteDenominator;
  return safe(negative ? -rounded : rounded);
};

export const calculateStatementReport = (
  input: Readonly<{
    lines: readonly LinhaDre[];
    accounts: readonly ContaResultadoDre[];
    movements: readonly MovimentoDre[];
    companyId: string;
    statementVersion: number;
    viewMode: VisaoDre;
    basePeriod: string;
    periodMode: ModoPeriodoDre;
    comparisonAvailable: boolean;
    sourceHash: string;
  }>,
): RelatorioDre => {
  if (
    !competencePattern.test(input.basePeriod) ||
    !input.companyId ||
    !Number.isSafeInteger(input.statementVersion) ||
    input.statementVersion < 1
  )
    throw new RangeError("STATEMENT_PERIOD_INVALID");
  const yearStart = `${input.basePeriod.slice(0, 4)}-01`;
  const periodFrom =
    input.periodMode === "MONTH" ? input.basePeriod : yearStart;
  const prevYear = String(Number(input.basePeriod.slice(0, 4)) - 1).padStart(
    4,
    "0",
  );
  const previousPeriod = `${prevYear}-${input.basePeriod.slice(5)}`;
  const previousFrom =
    input.periodMode === "MONTH" ? previousPeriod : `${prevYear}-01`;
  const previousTo = previousPeriod;
  const accountById = new Map(
    input.accounts.map((account) => [account.accountId, account]),
  );
  const accountLine = new Map<string, LinhaDre>();
  for (const line of input.lines)
    for (const id of line.accountIds) accountLine.set(id, line);
  const current = new Map<string, bigint>();
  const previous = new Map<string, bigint>();
  const unmapped = new Map<string, bigint>();
  for (const movement of input.movements) {
    if (
      !competencePattern.test(movement.competence) ||
      !Number.isSafeInteger(movement.debitCents) ||
      !Number.isSafeInteger(movement.creditCents) ||
      movement.debitCents < 0 ||
      movement.creditCents < 0
    )
      throw new RangeError("STATEMENT_RECONCILIATION_FAILED");
    const account = accountById.get(movement.accountId);
    if (
      !account?.eligible ||
      (account.nature !== "REVENUE" && account.nature !== "EXPENSE")
    )
      continue;
    const line = accountLine.get(movement.accountId);
    const raw =
      account.nature === "REVENUE"
        ? BigInt(movement.creditCents) - BigInt(movement.debitCents)
        : BigInt(movement.debitCents) - BigInt(movement.creditCents);
    if (
      movement.competence >= periodFrom &&
      movement.competence <= input.basePeriod
    ) {
      if (line)
        current.set(
          movement.accountId,
          (current.get(movement.accountId) ?? 0n) + raw,
        );
      else
        unmapped.set(
          movement.accountId,
          (unmapped.get(movement.accountId) ?? 0n) + raw,
        );
    }
    if (
      input.comparisonAvailable &&
      movement.competence >= previousFrom &&
      movement.competence <= previousTo &&
      line
    )
      previous.set(
        movement.accountId,
        (previous.get(movement.accountId) ?? 0n) + raw,
      );
  }
  const values = new Map<
    string,
    {
      current: bigint;
      previous: bigint | null;
      accounts: LinhaRelatorioDre["accounts"][number][];
    }
  >();
  for (const line of input.lines)
    values.set(line.code, {
      current: 0n,
      previous: input.comparisonAvailable ? 0n : null,
      accounts: [],
    });
  for (const line of input.lines)
    if (line.type === "DETAIL") {
      const value = values.get(line.code)!;
      for (const id of line.accountIds) {
        const account = accountById.get(id)!;
        const now = current.get(id) ?? 0n;
        const before = input.comparisonAvailable
          ? (previous.get(id) ?? 0n)
          : null;
        value.current += now * BigInt(line.presentationSign);
        if (before !== null)
          value.previous =
            (value.previous ?? 0n) + before * BigInt(line.presentationSign);
        value.accounts.push({
          code: account.code,
          name: account.name,
          currentCents: safe(now * BigInt(line.presentationSign)),
          previousCents:
            before === null
              ? null
              : safe(before * BigInt(line.presentationSign)),
        });
      }
    }
  for (const line of [...input.lines].sort((a, b) => a.order - b.order))
    if (line.type === "SUBTOTAL") {
      const value = values.get(line.code)!;
      for (const component of line.components) {
        const source = values.get(component.code)!;
        const sign = component.operator === "ADD" ? 1n : -1n;
        value.current += source.current * sign;
        if (value.previous !== null && source.previous !== null)
          value.previous += source.previous * sign;
      }
    }
  const basis = input.lines.find((line) => line.verticalBasis)!;
  const basisNow = values.get(basis.code)!.current;
  const reportLines = input.lines.map((line): LinhaRelatorioDre => {
    const value = values.get(line.code)!;
    const prior = value.previous;
    const diff = prior === null ? null : value.current - prior;
    const horizontalBasisPoints =
      diff === null || prior === null
        ? "NOT_AVAILABLE"
        : prior === 0n ||
            (prior < 0n && value.current > 0n) ||
            (prior > 0n && value.current < 0n)
          ? "NOT_APPLICABLE"
          : percentual(diff, prior);
    return {
      code: line.code,
      title: line.title,
      type: line.type,
      level: line.level,
      presentationSign: line.presentationSign,
      currentCents: safe(value.current),
      previousCents: value.previous === null ? null : safe(value.previous),
      verticalBasisPoints:
        basisNow === 0n
          ? "NOT_APPLICABLE"
          : percentual(value.current, basisNow),
      horizontalCents: diff === null ? null : safe(diff),
      horizontalBasisPoints,
      accounts: value.accounts,
    };
  });
  const unmappedAccounts = [...unmapped.entries()]
    .map(([accountId, cents]) => {
      const account = accountById.get(accountId)!;
      return {
        accountId,
        code: account.code,
        name: account.name,
        currentCents: safe(cents),
      };
    })
    .sort((a, b) => a.code.localeCompare(b.code, "en"));
  const canonical = JSON.stringify({
    companyId: input.companyId,
    statementVersion: input.statementVersion,
    sourceHash: input.sourceHash,
    basePeriod: input.basePeriod,
    periodMode: input.periodMode,
    viewMode: input.viewMode,
    lines: reportLines,
    unmappedAccounts,
  });
  const status = unmappedAccounts.length ? "INCOMPLETE" : "COMPLETE";
  return {
    status,
    reportStatus: status,
    lines: reportLines,
    unmappedAccounts,
    hash: createHash("sha256").update(canonical).digest("hex"),
  };
};
