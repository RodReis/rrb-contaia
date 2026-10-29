import { describe, expect, it } from 'vitest';
import { calcularBalancete, type ContaParaBalancete, type MovimentoParaBalancete } from './razao-contabil.js';

const accounts: readonly ContaParaBalancete[] = [
  { accountId: 'root', code: '1', name: 'Ativo', parentAccountId: null, type: 'SYNTHETIC', normalBalance: 'DEBIT' },
  { accountId: 'cash', code: '1.1', name: 'Caixa', parentAccountId: 'root', type: 'ANALYTICAL', normalBalance: 'DEBIT' },
  { accountId: 'bank', code: '1.2', name: 'Banco', parentAccountId: 'root', type: 'ANALYTICAL', normalBalance: 'DEBIT' },
];
const movements: readonly MovimentoParaBalancete[] = [
  { accountId: 'cash', costCenterId: null, competence: '2026-01', side: 'DEBIT', amountCents: 10_000 },
  { accountId: 'cash', costCenterId: 'ops', competence: '2026-02', side: 'CREDIT', amountCents: 2_500 },
  { accountId: 'bank', costCenterId: 'ops', competence: '2026-02', side: 'DEBIT', amountCents: 2_500 },
];

describe('calcularBalancete', () => {
  it('calcula saldo anterior, movimento do período e saldo final com contas sintéticas sem dupla contagem', () => {
    const result = calcularBalancete(movements, accounts, '2026-02', '2026-02');
    expect(result.lines.map(({ accountId, openingBalanceCents, debitCents, creditCents, closingBalanceCents, closingNature }) => ({ accountId, openingBalanceCents, debitCents, creditCents, closingBalanceCents, closingNature }))).toEqual([
      { accountId: 'root', openingBalanceCents: 10_000, debitCents: 2_500, creditCents: 2_500, closingBalanceCents: 10_000, closingNature: 'DEBIT' },
      { accountId: 'cash', openingBalanceCents: 10_000, debitCents: 0, creditCents: 2_500, closingBalanceCents: 7_500, closingNature: 'DEBIT' },
      { accountId: 'bank', openingBalanceCents: 0, debitCents: 2_500, creditCents: 0, closingBalanceCents: 2_500, closingNature: 'DEBIT' },
    ]);
    expect(result.totalDebitCents).toBe(result.totalCreditCents);
  });

  it('distingue movimentos sem centro de todos e de centro específico', () => {
    expect(calcularBalancete(movements, accounts, '2026-01', '2026-02', { tipo: 'SEM_CENTRO' }).totalDebitCents).toBe(10_000);
    expect(calcularBalancete(movements, accounts, '2026-01', '2026-02', { tipo: 'CENTRO', centroCustoId: 'ops' }).totalDebitCents).toBe(2_500);
    expect(calcularBalancete(movements, accounts, '2026-01', '2026-02').totalDebitCents).toBe(12_500);
  });

  it('rejeita período invertido, movimento inválido e soma fora do inteiro seguro', () => {
    expect(() => calcularBalancete([], accounts, '2026-03', '2026-02')).toThrow('LEDGER_PERIOD_INVALID');
    expect(() => calcularBalancete([{ ...movements[0]!, amountCents: 0 }], accounts, '2026-01', '2026-01')).toThrow('LEDGER_SOURCE_INVALID');
    expect(() => calcularBalancete([
      { ...movements[0]!, amountCents: Number.MAX_SAFE_INTEGER },
      { ...movements[0]!, amountCents: 1 },
    ], accounts, '2026-01', '2026-01')).toThrow('LEDGER_TOTAL_OUT_OF_RANGE');
  });
});
