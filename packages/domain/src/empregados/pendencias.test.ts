import { describe, expect, it } from 'vitest';

import { CHAVE_DE_PENDENCIA_DE_EMPREGADOS, causasDeEmpregados } from './pendencias.js';

describe('causasDeEmpregados (SPEC-014 §3.10)', () => {
  it('empresa sem empregado confirmado mantém a pendência de importação', () => {
    expect(causasDeEmpregados(0)).toEqual([
      {
        origem: 'EMPREGADOS',
        tipo: 'EMPREGADOS_NAO_IMPORTADOS',
        chave: 'empregados:nao-importados',
        dataLimite: null,
      },
    ]);
    expect(CHAVE_DE_PENDENCIA_DE_EMPREGADOS).toBe('empregados:nao-importados');
  });

  it('o primeiro empregado confirmado resolve a pendência', () => {
    expect(causasDeEmpregados(1)).toEqual([]);
    expect(causasDeEmpregados(500)).toEqual([]);
  });

  it('é idempotente: mesma entrada, mesma saída', () => {
    expect(causasDeEmpregados(0)).toEqual(causasDeEmpregados(0));
  });
});
