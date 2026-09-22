import { describe, expect, it } from 'vitest';

import { tipoDeNotificacaoParaCausa } from './notificacoes.js';

describe('tipoDeNotificacaoParaCausa', () => {
  it('mapeia CAMPO_AUSENTE para NOVA_PENDENCIA', () => {
    expect(tipoDeNotificacaoParaCausa('CAMPO_AUSENTE')).toBe('NOVA_PENDENCIA');
  });

  it('mapeia CAMPO_INVALIDO para NOVA_PENDENCIA', () => {
    expect(tipoDeNotificacaoParaCausa('CAMPO_INVALIDO')).toBe('NOVA_PENDENCIA');
  });

  it('mapeia DOCUMENTO_AUSENTE para NOVA_PENDENCIA', () => {
    expect(tipoDeNotificacaoParaCausa('DOCUMENTO_AUSENTE')).toBe('NOVA_PENDENCIA');
  });

  it('mapeia DOCUMENTO_REJEITADO para DOCUMENTO_REJEITADO', () => {
    expect(tipoDeNotificacaoParaCausa('DOCUMENTO_REJEITADO')).toBe('DOCUMENTO_REJEITADO');
  });

  it('mapeia DOCUMENTO_VENCIDO para DOCUMENTO_VENCIDO', () => {
    expect(tipoDeNotificacaoParaCausa('DOCUMENTO_VENCIDO')).toBe('DOCUMENTO_VENCIDO');
  });

  it('mapeia EXIGENCIA_ESPECIFICA para NOVA_EXIGENCIA', () => {
    expect(tipoDeNotificacaoParaCausa('EXIGENCIA_ESPECIFICA')).toBe('NOVA_EXIGENCIA');
  });

  it('retorna null para tipo desconhecido', () => {
    expect(tipoDeNotificacaoParaCausa('TIPO_INEXISTENTE')).toBeNull();
  });
});
