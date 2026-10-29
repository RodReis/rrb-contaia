import { describe, expect, it } from 'vitest';
import { accountingPeriodGateBlockers, canonicalAccountingClose, hashAccountingClose, previousAccountingCompetence, type AccountingCloseSnapshotInput } from './fechamento-competencia.js';

const base: AccountingCloseSnapshotInput = {
  tenantId: 't', companyId: 'c', competence: '2097-03', version: 1, ledgerProjectionVersion: 4,
  firstCompetence: '2097-01', kind: 'REGULAR', debitCents: 8400, creditCents: 8400, movementCount: 2, entryCount: 1,
  lines: [{ accountId: 'a', code: '1.01', name: 'Caixa', type: 'ANALYTICAL', normalBalance: 'DEBIT', level: 0, parentAccountId: null, openingBalanceCents: 0, debitCents: 8400, creditCents: 0, closingBalanceCents: 8400, closingNature: 'DEBIT', movementCount: 1 }],
  closedBy: 'u', closedAt: '2097-04-01T00:00:00Z', correlationId: 'corr', permissions: ['contabil.fechamento.fechar_competencia'], emptyConfirmation: false,
};

describe('F43 fechamento de competência', () => {
  it.each([['2097-01','2096-12'],['2097-03','2097-02'],['2000-01','1999-12']])('calcula competência anterior de %s', (month, previous) => expect(previousAccountingCompetence(month!)).toBe(previous));
  it.each(['2097-00','2097-13','97-03'])('rejeita competência inválida %s', (month) => expect(() => previousAccountingCompetence(month!)).toThrow('ACCOUNTING_PERIOD_INVALID'));
  it('acumula impedimentos sem executar alteração', () => expect(accountingPeriodGateBlockers({ competence: '2097-03', firstCompetence: '2097-01', previousClosed: false, integrity: 'INCONSISTENT', draftCount: 2, sourceDebitCents: 100, sourceCreditCents: 90, projectionDebitCents: 100, projectionCreditCents: 90, movementCount: 2, confirmEmpty: false })).toEqual(['ACCOUNTING_PERIOD_SEQUENCE_GAP','ACCOUNTING_PERIOD_DRAFTS_EXIST','ACCOUNTING_LEDGER_INCONSISTENT','ACCOUNTING_PERIOD_UNBALANCED']));
  it('exige confirmação extra para competência sem movimentos', () => expect(accountingPeriodGateBlockers({ competence: '2097-01', firstCompetence: '2097-01', previousClosed: true, integrity: 'CONSISTENT', draftCount: 0, sourceDebitCents: 0, sourceCreditCents: 0, projectionDebitCents: 0, projectionCreditCents: 0, movementCount: 0, confirmEmpty: false })).toEqual(['ACCOUNTING_EMPTY_CONFIRMATION_REQUIRED']));
  it('canonicaliza linhas e permissões para hash reproduzível', () => {
    const reordered = { ...base, lines: [...base.lines].reverse(), permissions: [...base.permissions].reverse() };
    expect(canonicalAccountingClose(reordered)).toBe(canonicalAccountingClose(base));
    expect(hashAccountingClose(reordered)).toBe(hashAccountingClose(base));
    expect(hashAccountingClose({ ...base, debitCents: 8500 })).not.toBe(hashAccountingClose(base));
  });
  it('rejeita dinheiro fora de inteiro seguro', () => expect(() => hashAccountingClose({ ...base, debitCents: Number.MAX_SAFE_INTEGER + 1 })).toThrow('ACCOUNTING_PERIOD_INVALID'));
});
