import { describe, expect, it } from 'vitest';

import { decidirIdempotencia, type OperacaoExistente, type PedidoIdempotente } from './idempotencia.js';

const pedido: PedidoIdempotente = {
  tenantId: 'tenant-1',
  empresaId: 'empresa-1',
  finalidade: 'DFE_TESTE',
  hashConteudo: 'hash-a',
};

const existente = (parcial: Partial<OperacaoExistente> = {}): OperacaoExistente => ({
  id: 'op-1',
  tenantId: 'tenant-1',
  empresaId: 'empresa-1',
  finalidade: 'DFE_TESTE',
  hashConteudo: 'hash-a',
  estado: 'CONCLUIDA',
  ...parcial,
});

describe('decidirIdempotencia (SPEC-012 §3.8, I-9)', () => {
  it('chave nova inicia operação nova', () => {
    expect(decidirIdempotencia(null, pedido)).toEqual({ tipo: 'NOVA' });
  });

  it('repetição idêntica com resultado terminal reutiliza o resultado', () => {
    expect(decidirIdempotencia(existente({ estado: 'CONCLUIDA' }), pedido)).toEqual({
      tipo: 'REUTILIZAR',
      operacaoId: 'op-1',
    });
  });

  it('falha definitiva é terminal e sua repetição reutiliza a recusa', () => {
    expect(decidirIdempotencia(existente({ estado: 'RECUSADA' }), pedido)).toEqual({
      tipo: 'REUTILIZAR',
      operacaoId: 'op-1',
    });
  });

  it('operação em andamento informa estado não terminal, sem concorrente', () => {
    expect(decidirIdempotencia(existente({ estado: 'EM_ANDAMENTO' }), pedido)).toEqual({
      tipo: 'EM_ANDAMENTO',
      operacaoId: 'op-1',
    });
  });

  it('falha transitória admite nova tentativa vinculada à mesma operação', () => {
    expect(decidirIdempotencia(existente({ estado: 'FALHA_TRANSITORIA' }), pedido)).toEqual({
      tipo: 'RETENTAR',
      operacaoId: 'op-1',
    });
  });

  it.each([
    ['tenant', { tenantId: 'tenant-2' }],
    ['empresa', { empresaId: 'empresa-2' }],
    ['finalidade', { finalidade: 'ESOCIAL_TESTE' as const }],
    ['conteúdo', { hashConteudo: 'hash-b' }],
  ])('divergência de %s com a mesma chave é conflito, em qualquer estado', (_campo, divergencia) => {
    for (const estado of ['EM_ANDAMENTO', 'CONCLUIDA', 'RECUSADA', 'FALHA_TRANSITORIA'] as const) {
      expect(decidirIdempotencia(existente({ estado, ...divergencia }), pedido)).toEqual({ tipo: 'CONFLITO' });
    }
  });
});
