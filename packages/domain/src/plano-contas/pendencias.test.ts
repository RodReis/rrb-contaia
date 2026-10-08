import { describe, expect, it } from 'vitest';

import { reconciliarPendencias } from '../pendencias/pendencias.js';
import { causasDoPlanoDeContas } from './pendencias.js';

const HOJE = '2026-10-08';

describe('causasDoPlanoDeContas', () => {
  it('sem conta válida abre pendência', () => {
    expect(causasDoPlanoDeContas({ temContaValida: false, hoje: HOJE })).toEqual([
      {
        origem: 'PLANO_CONTAS',
        tipo: 'PLANO_CONTAS_INCOMPLETO',
        chave: 'plano-contas:incompleto',
        dataLimite: null,
      },
    ]);
  });

  it('com conta válida não há causa', () => {
    expect(causasDoPlanoDeContas({ temContaValida: true, hoje: HOJE })).toEqual([]);
  });

  it('reprocessar não duplica e a primeira conta válida resolve a pendência aberta', () => {
    const abertas = [{ chave: 'plano-contas:incompleto' }];

    const semConta = reconciliarPendencias(
      causasDoPlanoDeContas({ temContaValida: false, hoje: HOJE }),
      abertas,
    );
    expect(semConta.paraAbrir).toEqual([]);
    expect(semConta.paraResolver).toEqual([]);

    const comConta = reconciliarPendencias(
      causasDoPlanoDeContas({ temContaValida: true, hoje: HOJE }),
      abertas,
    );
    expect(comConta.paraResolver).toEqual(['plano-contas:incompleto']);
  });
});
