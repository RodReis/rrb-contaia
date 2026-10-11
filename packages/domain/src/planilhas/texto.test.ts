import { describe, expect, it } from 'vitest';

import { LIMITE_DE_TEXTO_DA_INSPECAO, truncarTexto } from './texto.js';

describe('truncarTexto', () => {
  it('texto dentro do limite volta inalterado', () => {
    expect(truncarTexto('Código', 10)).toBe('Código');
    expect(truncarTexto('a'.repeat(10), 10)).toBe('a'.repeat(10));
    expect(truncarTexto('', 10)).toBe('');
  });

  it('acima do limite: corta e termina em reticências, sem passar do limite', () => {
    const cortado = truncarTexto('a'.repeat(32_767), 1000);

    expect(cortado).toBe(`${'a'.repeat(999)}…`);
    expect(cortado.length).toBe(1000);
  });

  it('não parte par substituto na fronteira do corte', () => {
    // 😀 ocupa 2 unidades UTF-16; com limite 5 o corte cairia no meio do emoji da posição 3-4.
    const cortado = truncarTexto('abc😀😀😀', 5);

    expect(cortado).toBe('abc…');
    expect([...cortado].every((c) => c === '…' || c.codePointAt(0)! < 0xd800)).toBe(true);
    expect(cortado.length).toBeLessThanOrEqual(5);
  });

  it('emoji inteiro que cabe é mantido', () => {
    expect(truncarTexto('ab😀cdef', 6)).toBe('ab😀c…');
  });

  it('é determinístico e o limite da inspeção é um número positivo', () => {
    expect(truncarTexto('x'.repeat(50), 20)).toBe(truncarTexto('x'.repeat(50), 20));
    expect(LIMITE_DE_TEXTO_DA_INSPECAO).toBeGreaterThan(0);
  });
});
