import { describe, expect, it } from 'vitest';

import { PAPEIS_PADRAO, ehPapelPadrao, escopoDeEmpresas } from './papeis.js';

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

describe('escopoDeEmpresas (decisão do PI: admin vê tudo, demais veem zero até a carteira)', () => {
  it('admin enxerga todas', () => {
    expect(escopoDeEmpresas(['admin_escritorio'])).toBe('TODAS');
  });

  it('admin combinado com outro papel continua enxergando todas', () => {
    expect(escopoDeEmpresas(['auxiliar', 'admin_escritorio'])).toBe('TODAS');
  });

  it('contador, auxiliar e auditor não enxergam nenhuma', () => {
    expect(escopoDeEmpresas(['contador'])).toBe('NENHUMA');
    expect(escopoDeEmpresas(['auxiliar'])).toBe('NENHUMA');
    expect(escopoDeEmpresas(['auditor_readonly'])).toBe('NENHUMA');
  });

  it('sem papéis não enxerga nenhuma', () => {
    expect(escopoDeEmpresas([])).toBe('NENHUMA');
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
