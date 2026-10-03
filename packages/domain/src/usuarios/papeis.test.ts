import { describe, expect, it } from 'vitest';

import { PAPEIS_PADRAO, ehPapelPadrao } from './papeis.js';

describe('papéis padrão (SPEC-007 §3.1)', () => {
  it('só os quatro papéis do MVP-1 existem', () => {
    expect([...PAPEIS_PADRAO]).toEqual([
      'admin_escritorio',
      'contador',
      'auxiliar',
      'auditor_readonly',
    ]);
  });
});

describe('ehPapelPadrao', () => {
  it('aceita os quatro papéis', () => {
    for (const papel of PAPEIS_PADRAO) {
      expect(ehPapelPadrao(papel)).toBe(true);
    }
  });

  it('recusa papéis de outros MVPs e valores inválidos', () => {
    expect(ehPapelPadrao('gestor_financeiro')).toBe(false);
    expect(ehPapelPadrao('dp')).toBe(false);
    expect(ehPapelPadrao('cliente_portal')).toBe(false);
    expect(ehPapelPadrao('')).toBe(false);
    expect(ehPapelPadrao(null)).toBe(false);
    expect(ehPapelPadrao(1)).toBe(false);
  });
});
