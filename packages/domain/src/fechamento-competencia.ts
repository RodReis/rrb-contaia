import { createHash } from 'node:crypto';

export type AccountingPeriodStatus = 'OPEN' | 'CLOSED' | 'REOPENED';
export type AccountingCloseKind = 'REGULAR' | 'EMPTY_CONFIRMED';
export type SnapshotTrialBalanceLine = Readonly<{
  accountId: string; code: string; name: string; type: 'ANALYTICAL' | 'SYNTHETIC'; normalBalance: 'DEBIT' | 'CREDIT';
  level: number; parentAccountId: string | null; openingBalanceCents: number; debitCents: number;
  creditCents: number; closingBalanceCents: number; closingNature: 'DEBIT' | 'CREDIT' | 'ZERO'; movementCount: number;
}>;
export type AccountingCloseSnapshotInput = Readonly<{
  tenantId: string; companyId: string; competence: string; version: number; ledgerProjectionVersion: number;
  firstCompetence: string; kind: AccountingCloseKind; debitCents: number; creditCents: number;
  movementCount: number; entryCount: number; lines: readonly SnapshotTrialBalanceLine[];
  closedBy: string; closedAt: string; correlationId: string; permissions: readonly string[];
  emptyConfirmation: boolean;
}>;
export type AccountingPeriodGateInput = Readonly<{
  competence: string; firstCompetence: string; previousClosed: boolean; integrity: 'CONSISTENT' | 'INCONSISTENT';
  draftCount: number; sourceDebitCents: number; sourceCreditCents: number; projectionDebitCents: number;
  projectionCreditCents: number; movementCount: number; confirmEmpty: boolean;
}>;
export type AccountingPeriodBlocker = 'ACCOUNTING_PERIOD_INVALID' | 'ACCOUNTING_PERIOD_SEQUENCE_GAP' |
  'ACCOUNTING_PERIOD_DRAFTS_EXIST' | 'ACCOUNTING_LEDGER_INCONSISTENT' | 'ACCOUNTING_PERIOD_UNBALANCED' |
  'ACCOUNTING_EMPTY_CONFIRMATION_REQUIRED';

const monthPattern = /^([0-9]{4})-(0[1-9]|1[0-2])$/u;
const canonicalValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (typeof value === 'object' && value !== null) return Object.fromEntries(Object.entries(value).sort(([left],[right])=>left.localeCompare(right,'en')).map(([key,entry])=>[key,canonicalValue(entry)]));
  return value;
};
export const isAccountingCompetence = (value: string): boolean => monthPattern.test(value);
export const previousAccountingCompetence = (value: string): string => {
  const match = monthPattern.exec(value);
  if (!match) throw new RangeError('ACCOUNTING_PERIOD_INVALID');
  const year = Number(match[1]); const month = Number(match[2]);
  return month === 1 ? `${String(year - 1).padStart(4, '0')}-12` : `${match[1]}-${String(month - 1).padStart(2, '0')}`;
};
export const accountingPeriodGateBlockers = (input: AccountingPeriodGateInput): readonly AccountingPeriodBlocker[] => {
  if (!isAccountingCompetence(input.competence)) return ['ACCOUNTING_PERIOD_INVALID'];
  if (!isAccountingCompetence(input.firstCompetence) || input.competence < input.firstCompetence) return ['ACCOUNTING_PERIOD_SEQUENCE_GAP'];
  const blockers: AccountingPeriodBlocker[] = [];
  if (input.competence > input.firstCompetence && !input.previousClosed) blockers.push('ACCOUNTING_PERIOD_SEQUENCE_GAP');
  if (input.draftCount > 0) blockers.push('ACCOUNTING_PERIOD_DRAFTS_EXIST');
  if (input.integrity !== 'CONSISTENT') blockers.push('ACCOUNTING_LEDGER_INCONSISTENT');
  if (input.sourceDebitCents !== input.sourceCreditCents || input.sourceDebitCents !== input.projectionDebitCents || input.sourceCreditCents !== input.projectionCreditCents) blockers.push('ACCOUNTING_PERIOD_UNBALANCED');
  if (input.movementCount === 0 && !input.confirmEmpty) blockers.push('ACCOUNTING_EMPTY_CONFIRMATION_REQUIRED');
  return blockers;
};
const inteirosSeguros = (snapshot: AccountingCloseSnapshotInput): void => {
  const nonNegative = [snapshot.version, snapshot.ledgerProjectionVersion, snapshot.debitCents, snapshot.creditCents, snapshot.movementCount, snapshot.entryCount, ...snapshot.lines.flatMap((line) => [line.debitCents, line.creditCents, line.movementCount])];
  const signed = snapshot.lines.flatMap((line) => [line.openingBalanceCents, line.closingBalanceCents]);
  if (nonNegative.some((value) => !Number.isSafeInteger(value) || value < 0) || signed.some((value) => !Number.isSafeInteger(value)) || snapshot.version < 1 || snapshot.ledgerProjectionVersion < 1) throw new RangeError('ACCOUNTING_PERIOD_INVALID');
};
export const canonicalAccountingClose = (snapshot: AccountingCloseSnapshotInput): string => {
  inteirosSeguros(snapshot);
  if (!isAccountingCompetence(snapshot.competence) || !isAccountingCompetence(snapshot.firstCompetence) || !Number.isFinite(Date.parse(snapshot.closedAt))) throw new RangeError('ACCOUNTING_PERIOD_INVALID');
  const sortedLines = [...snapshot.lines].sort((left, right) => left.code.localeCompare(right.code, 'en')).map((line)=>canonicalValue(line));
  return JSON.stringify({
    tenantId: snapshot.tenantId, companyId: snapshot.companyId, competence: snapshot.competence,
    version: snapshot.version, ledgerProjectionVersion: snapshot.ledgerProjectionVersion, firstCompetence: snapshot.firstCompetence,
    kind: snapshot.kind, debitCents: snapshot.debitCents, creditCents: snapshot.creditCents,
    movementCount: snapshot.movementCount, entryCount: snapshot.entryCount, lines: sortedLines,
    closedBy: snapshot.closedBy, closedAt: new Date(snapshot.closedAt).toISOString(), correlationId: snapshot.correlationId, emptyConfirmation: snapshot.emptyConfirmation,
    permissions: [...new Set(snapshot.permissions)].sort((a, b) => a.localeCompare(b, 'en')),
  });
};
export const hashAccountingClose = (snapshot: AccountingCloseSnapshotInput): string => createHash('sha256').update(canonicalAccountingClose(snapshot), 'utf8').digest('hex');
