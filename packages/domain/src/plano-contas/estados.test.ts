/**
 * Estados da importação do plano de contas (SPEC-013 §3.11, I-7, I-9).
 */
import { describe, expect, it } from 'vitest';

import {
  EstadoDaImportacao,
  ehEstadoTerminal,
  proximoEstado,
  podeTransicionar,
  type TransicaoInvalida,
} from './estados.js';

describe('estados da importação (SPEC-013 §3.11)', () => {
  it('estados terminais são identificados', () => {
    for (const estado of ['CONCLUIDA', 'CONCLUIDA_COM_REJEICOES', 'REJEITADA', 'CANCELADA', 'FALHA'] as const) {
      expect(ehEstadoTerminal(estado)).toBe(true);
    }
    for (const estado of ['RECEBIDA', 'VALIDANDO', 'AGUARDANDO_CONFIRMACAO', 'APLICANDO'] as const) {
      expect(ehEstadoTerminal(estado)).toBe(false);
    }
  });

  it('transições válidas', () => {
    expect(proximoEstado('RECEBIDA', 'INICIAR_VALIDACAO')).toBe('VALIDANDO');
    expect(proximoEstado('VALIDANDO', 'VALIDACAO_SUCESSO')).toBe('AGUARDANDO_CONFIRMACAO');
    expect(proximoEstado('VALIDANDO', 'VALIDACAO_REJEITADA')).toBe('REJEITADA');
    expect(proximoEstado('VALIDANDO', 'FALHA_TECNICA')).toBe('FALHA');
    expect(proximoEstado('AGUARDANDO_CONFIRMACAO', 'CONFIRMAR')).toBe('APLICANDO');
    expect(proximoEstado('AGUARDANDO_CONFIRMACAO', 'CANCELAR')).toBe('CANCELADA');
    expect(proximoEstado('APLICANDO', 'APLICACAO_SUCESSO')).toBe('CONCLUIDA');
    expect(proximoEstado('APLICANDO', 'APLICACAO_SUCESSO_COM_REJEICOES')).toBe('CONCLUIDA_COM_REJEICOES');
    expect(proximoEstado('APLICANDO', 'FALHA_TECNICA')).toBe('FALHA');
  });

  it('podeTransicionar espelha as transições válidas', () => {
    expect(podeTransicionar('RECEBIDA', 'INICIAR_VALIDACAO')).toBe(true);
    expect(podeTransicionar('VALIDANDO', 'CONFIRMAR')).toBe(false);
    expect(podeTransicionar('AGUARDANDO_CONFIRMACAO', 'VALIDACAO_SUCESSO')).toBe(false);
  });

  it('tentativa de transição a partir de estado terminal retorna erro', () => {
    for (const estado of ['CONCLUIDA', 'CANCELADA', 'FALHA'] as const) {
      const resultado = proximoEstado(estado, 'INICIAR_VALIDACAO');
      expect(resultado).toMatchObject({ codigo: 'ESTADO_TERMINAL_NAO_TRANSICIONA' });
    }
  });

  it('evento desconhecido no estado atual retorna erro', () => {
    const resultado = proximoEstado('RECEBIDA', 'EVENTO_INEXISTENTE');
    expect(resultado).toMatchObject({ codigo: 'TRANSICAO_INVALIDA' });
  });

  it('mesmo evento no mesmo estado não terminal não duplica transição (idempotente na fronteira)', () => {
    // SPEC: "Estados terminais não são reabertos nem apagados. Nova correção gera nova tentativa."
    // A transição já aconteceu — tentar aplicar o mesmo evento novamente não deve mudar o estado,
    // mas sim retornar erro de transição inválida (já não está mais no estado de origem).
    // Na prática, isso é controlado na borda (API/worker) que lê o estado atual antes de chamar.
    expect(proximoEstado('VALIDANDO', 'VALIDACAO_SUCESSO')).toBe('AGUARDANDO_CONFIRMACAO');
    // Se alguém tentar aplicar VALIDACAO_SUCESSO de novo, agora o estado é AGUARDANDO_CONFIRMACAO
    expect(proximoEstado('AGUARDANDO_CONFIRMACAO', 'VALIDACAO_SUCESSO')).toMatchObject({
      codigo: 'TRANSICAO_INVALIDA',
    });
  });
});