import { describe, expect, it } from 'vitest';

import {
  canonicalOpeningBalance,
  hashOpeningBalance,
  openingBalanceTotals,
  openingMovementDate,
  parseOpeningAmount,
  validateOpeningBaseDate,
  validateOpeningLines,
} from './saldos-abertura.js';

describe('saldos de abertura', () => {
  it('trata data-base como data civil e rejeita dia inexistente', () => {
    expect(validateOpeningBaseDate('2026-02-28')).toEqual([]);
    expect(validateOpeningBaseDate('2026-02-29')).toContain('OPENING_BALANCE_BASE_DATE_INVALID');
    expect(validateOpeningBaseDate('2026-2-01')).toContain('OPENING_BALANCE_BASE_DATE_INVALID');
  });

  it('coloca o movimento no dia seguinte ao fim da data-base inclusive na virada do ano',()=>{
    expect(openingMovementDate('2026-12-31')).toEqual({accountingDate:'2027-01-01',competence:'2027-01'});
  });

  it('lê valores monetários pt-BR em centavos inteiros', () => {
    expect(parseOpeningAmount('1.234,56')).toBe(123456);
    expect(parseOpeningAmount('0,01')).toBe(1);
    expect(parseOpeningAmount('250')).toBe(25000);
    expect(() => parseOpeningAmount('1,234')).toThrow('OPENING_BALANCE_LINE_INVALID');
    expect(() => parseOpeningAmount('-1,00')).toThrow('OPENING_BALANCE_LINE_INVALID');
    expect(() => parseOpeningAmount('1.2.3,00')).toThrow('OPENING_BALANCE_LINE_INVALID');
    expect(() => parseOpeningAmount('90071992547409,92')).toThrow('OPENING_BALANCE_LINE_INVALID');
  });

  it('exige exatamente um saldo positivo por linha e denuncia chaves duplicadas', () => {
    const linhas = [
      { accountId: 'a', costCenterId: null, debitCents: 10, creditCents: 0, note: null },
      { accountId: 'a', costCenterId: null, debitCents: 0, creditCents: 10, note: null },
      { accountId: 'b', costCenterId: null, debitCents: 0, creditCents: 0, note: null },
      { accountId: 'c', costCenterId: null, debitCents: -1, creditCents: 0, note: null },
      { accountId: 'd', costCenterId: null, debitCents: 1, creditCents: 1, note: null },
    ];
    expect(validateOpeningLines(linhas, new Map([
      ['a', { active: true, analytical: true, costCenterPolicy: 'OPTIONAL' }],
      ['b', { active: true, analytical: true, costCenterPolicy: 'OPTIONAL' }],
      ['c', { active: true, analytical: true, costCenterPolicy: 'OPTIONAL' }],
      ['d', { active: true, analytical: true, costCenterPolicy: 'OPTIONAL' }],
    ]), new Map())).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'OPENING_BALANCE_DUPLICATE_LINE', line: 2 }),
      expect.objectContaining({ code: 'OPENING_BALANCE_LINE_INVALID', line: 3 }),
      expect.objectContaining({ code: 'OPENING_BALANCE_LINE_INVALID', line: 4 }),
      expect.objectContaining({ code: 'OPENING_BALANCE_LINE_INVALID', line: 5 }),
    ]));
  });

  it('exige contas analíticas ativas e centro ativo quando a política exigir', () => {
    const lines = [
      { accountId: 'synthetic', costCenterId: null, debitCents: 1, creditCents: 0, note: null },
      { accountId: 'archived', costCenterId: null, debitCents: 1, creditCents: 0, note: null },
      { accountId: 'required', costCenterId: null, debitCents: 1, creditCents: 0, note: null },
      { accountId: 'required', costCenterId: 'inactive', debitCents: 1, creditCents: 0, note: null },
    ];
    const errors = validateOpeningLines(lines, new Map([
      ['synthetic', { active: true, analytical: false, costCenterPolicy: 'OPTIONAL' }],
      ['archived', { active: false, analytical: true, costCenterPolicy: 'OPTIONAL' }],
      ['required', { active: true, analytical: true, costCenterPolicy: 'REQUIRED' }],
    ]), new Map([['inactive', false]]));
    expect(errors.map((error) => error.code)).toEqual([
      'OPENING_BALANCE_ACCOUNT_INVALID', 'OPENING_BALANCE_ACCOUNT_INVALID',
      'OPENING_BALANCE_COST_CENTER_INVALID', 'OPENING_BALANCE_COST_CENTER_INVALID',
    ]);
  });

  it('calcula equilíbrio sem float e gera canonicalização/hash independentes da ordem', () => {
    const snapshot = {
      tenantId: 'tenant', companyId: 'company', version: 1, baseDate: '2026-01-31', source: 'MANUAL' as const,
      debitCents: 1250, creditCents: 1250, lines: [
        { accountId: 'b', costCenterId: null, debitCents: 0, creditCents: 1250, note: null },
        { accountId: 'a', costCenterId: null, debitCents: 1250, creditCents: 0, note: 'caixa' },
      ],
    };
    const reordered = { ...snapshot, lines: [...snapshot.lines].reverse() };
    expect(canonicalOpeningBalance(snapshot)).toBe(canonicalOpeningBalance(reordered));
    expect(hashOpeningBalance(snapshot)).toBe(hashOpeningBalance(reordered));
    expect(validateOpeningLines(snapshot.lines, new Map(snapshot.lines.map((line) => [line.accountId, { active: true, analytical: true, costCenterPolicy: 'OPTIONAL' as const }])), new Map())).toEqual([]);
  });

  it('recusa totais acima do inteiro seguro e hashes com totais divergentes', () => {
    const linhas = [
      { accountId: 'a', costCenterId: null, debitCents: Number.MAX_SAFE_INTEGER, creditCents: 0, note: null },
      { accountId: 'b', costCenterId: null, debitCents: 1, creditCents: 0, note: null },
    ];
    expect(() => openingBalanceTotals(linhas)).toThrow('OPENING_BALANCE_LINE_INVALID');
    expect(() => hashOpeningBalance({
      tenantId: 'tenant', companyId: 'company', version: 1, baseDate: '2026-01-31', source: 'MANUAL',
      debitCents: 999, creditCents: 999, lines: [{ accountId: 'a', costCenterId: null, debitCents: 100, creditCents: 0, note: null }, { accountId: 'b', costCenterId: null, debitCents: 0, creditCents: 100, note: null }],
    })).toThrow('OPENING_BALANCE_UNBALANCED');
  });
});
