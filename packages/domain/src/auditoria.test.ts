import { describe, expect, it } from 'vitest';
import { canonicalizarEnvelopeDeAuditoria, hashDoEnvelopeDeAuditoria, redigirPayloadDeAuditoria } from './auditoria.js';

describe('auditoria append-only', () => {
  it('canonicaliza propriedades sem depender da ordem de inserção', () => {
    expect(canonicalizarEnvelopeDeAuditoria({ z: 1, a: { y: true, b: 2 } })).toBe('{"a":{"b":2,"y":true},"z":1}');
    expect(hashDoEnvelopeDeAuditoria({ z: 1, a: 2 })).toBe(hashDoEnvelopeDeAuditoria({ a: 2, z: 1 }));
  });

  it('rejeita número não finito no envelope', () => {
    expect(() => canonicalizarEnvelopeDeAuditoria({ score: Number.NaN })).toThrow('Valor não finito');
  });

  it('redige campos sensíveis recursivamente sem alterar evidência pública', () => {
    expect(redigirPayloadDeAuditoria({ justificativa: 'Regra aplicada', prompt: 'privado', nested: { entrada: 'sigilosa' } })).toEqual({
      justificativa: 'Regra aplicada', prompt: '[REDACTADO]', nested: { entrada: '[REDACTADO]' },
    });
  });
});
