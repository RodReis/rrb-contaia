import { describe, expect, it } from 'vitest';

import { piorEstado } from './estado.js';

describe('piorEstado (SPEC-012 §5.2, §10)', () => {
  it('duas finalidades operacionais resumem como operacional', () => {
    expect(piorEstado(['OPERACIONAL', 'OPERACIONAL'])).toBe('OPERACIONAL');
  });

  it('uma finalidade em falha puxa o resumo da empresa para falha', () => {
    expect(piorEstado(['OPERACIONAL', 'FALHA'])).toBe('FALHA');
    expect(piorEstado(['FALHA', 'OPERACIONAL'])).toBe('FALHA');
  });

  it('segue a ordem operacional < não testado < sem certificado < falha', () => {
    expect(piorEstado(['OPERACIONAL', 'NAO_TESTADO'])).toBe('NAO_TESTADO');
    expect(piorEstado(['NAO_TESTADO', 'SEM_CERTIFICADO'])).toBe('SEM_CERTIFICADO');
    expect(piorEstado(['SEM_CERTIFICADO', 'FALHA'])).toBe('FALHA');
  });

  it('sem estados, a empresa não foi testada (nunca operacional por omissão)', () => {
    expect(piorEstado([])).toBe('NAO_TESTADO');
  });
});
