/**
 * Estados da importação do plano de contas (SPEC-013 §3.11).
 */
import { describe, expect, it } from 'vitest';

import { podeTransicionar, type EstadoDaImportacao, type EventoDaImportacao } from './estados.js';

const TERMINAIS: readonly EstadoDaImportacao[] = ['CONCLUIDA', 'CONCLUIDA_COM_REJEICOES', 'REJEITADA', 'CANCELADA', 'FALHA'];
const EVENTOS: readonly EventoDaImportacao[] = [
  'INICIAR_VALIDACAO',
  'VALIDACAO_SUCESSO',
  'VALIDACAO_REJEITADA',
  'FALHA_TECNICA',
  'CONFIRMAR',
  'CANCELAR',
  'APLICACAO_SUCESSO',
  'APLICACAO_SUCESSO_COM_REJEICOES',
];

describe('estados da importação (SPEC-013 §3.11)', () => {
  it('aceita exatamente as transições do diagrama', () => {
    const validas: readonly (readonly [EstadoDaImportacao, EventoDaImportacao])[] = [
      ['RECEBIDA', 'INICIAR_VALIDACAO'],
      ['VALIDANDO', 'VALIDACAO_SUCESSO'],
      ['VALIDANDO', 'VALIDACAO_REJEITADA'],
      ['VALIDANDO', 'FALHA_TECNICA'],
      ['AGUARDANDO_CONFIRMACAO', 'CONFIRMAR'],
      ['AGUARDANDO_CONFIRMACAO', 'CANCELAR'],
      ['APLICANDO', 'APLICACAO_SUCESSO'],
      ['APLICANDO', 'APLICACAO_SUCESSO_COM_REJEICOES'],
      ['APLICANDO', 'FALHA_TECNICA'],
    ];
    const estados: readonly EstadoDaImportacao[] = ['RECEBIDA', 'VALIDANDO', 'AGUARDANDO_CONFIRMACAO', 'APLICANDO', ...TERMINAIS];

    for (const estado of estados) {
      for (const evento of EVENTOS) {
        const esperado = validas.some(([e, ev]) => e === estado && ev === evento);
        expect({ estado, evento, pode: podeTransicionar(estado, evento) }).toEqual({ estado, evento, pode: esperado });
      }
    }
  });

  it('estado terminal não transiciona com nenhum evento (não reabre)', () => {
    for (const estado of TERMINAIS) {
      expect(EVENTOS.some((evento) => podeTransicionar(estado, evento))).toBe(false);
    }
  });

  it('o mesmo evento não se repete depois de aplicado (a origem já mudou)', () => {
    expect(podeTransicionar('VALIDANDO', 'VALIDACAO_SUCESSO')).toBe(true);
    expect(podeTransicionar('AGUARDANDO_CONFIRMACAO', 'VALIDACAO_SUCESSO')).toBe(false);
  });
});
