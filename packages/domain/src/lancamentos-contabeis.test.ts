import { describe, expect, it } from 'vitest';
import { ladosInvertidos, podeEstornar, validarCabecalhoContabil, validarPartidasContabeis, type PartidaContabil } from './lancamentos-contabeis.js';

const partida = (side: PartidaContabil['side'], amountCents: number, position: number): PartidaContabil => ({
  lineId: `line-${position}`, accountId: `account-${position}`, side, amountCents, costCenterId: null, memo: null, position,
});

describe('lançamentos contábeis — SPEC-040', () => {
  it('aceita cabeçalho com data civil dentro da competência', () => {
    expect(validarCabecalhoContabil({ accountingDate: '2026-10-28', competence: '2026-10', history: 'Compra à vista', externalReference: null })).toEqual([]);
  });

  it.each([
    ['2026-02-30', '2026-02'],
    ['2026-03-01', '2026-02'],
    ['2026-10-01', '2026-13'],
  ])('rejeita data %s fora da competência %s', (accountingDate, competence) => {
    expect(validarCabecalhoContabil({ accountingDate, competence, history: 'Histórico', externalReference: null })[0]?.code).toBe('ACCOUNTING_ENTRY_COMPETENCE_INVALID');
  });

  it('permite rascunho desbalanceado e exige equilíbrio na efetivação', () => {
    const linhas = [partida('DEBIT', 500, 0), partida('CREDIT', 400, 1)];
    expect(validarPartidasContabeis(linhas, false)).toEqual([]);
    expect(validarPartidasContabeis(linhas, true).map((erro) => erro.code)).toEqual(['ACCOUNTING_ENTRY_UNBALANCED']);
  });

  it('exige ao menos duas partidas e aceita totais seguros sem overflow de float', () => {
    expect(validarPartidasContabeis([partida('DEBIT', 1, 0)], true)[0]?.code).toBe('ACCOUNTING_ENTRY_LINE_INVALID');
    const valor = Number.MAX_SAFE_INTEGER;
    expect(validarPartidasContabeis([partida('DEBIT', valor, 0), partida('CREDIT', valor, 1)], true)).toEqual([]);
  });

  it('inverte lados e só permite estornar lançamento efetivado', () => {
    const invertidas = ladosInvertidos([partida('DEBIT', 900, 0), partida('CREDIT', 900, 1)]);
    expect(invertidas.map(({ side, amountCents }) => [side, amountCents])).toEqual([['CREDIT', 900], ['DEBIT', 900]]);
    expect(podeEstornar('POSTED')).toBe(true);
    expect(podeEstornar('CANCELLED')).toBe(false);
    expect(podeEstornar('REVERSED')).toBe(false);
  });
});
