import { describe, expect, it } from 'vitest';

import { estadoDaFinalidade, piorEstado } from './estado.js';

describe('estadoDaFinalidade (SPEC-012 §3.3, §5.2): deriva do último evento e da condição do certificado', () => {
  it('sem certificado utilizável a finalidade está sem certificado, mesmo com histórico bom', () => {
    expect(estadoDaFinalidade({ certificadoUtilizavel: false, ultimoResultado: 'SUCESSO' })).toBe('SEM_CERTIFICADO');
    expect(estadoDaFinalidade({ certificadoUtilizavel: false, ultimoResultado: null })).toBe('SEM_CERTIFICADO');
  });

  it('com certificado e sem nenhum teste ainda, não foi testada', () => {
    expect(estadoDaFinalidade({ certificadoUtilizavel: true, ultimoResultado: null })).toBe('NAO_TESTADO');
  });

  it('o último SUCESSO ou FALHA decide', () => {
    expect(estadoDaFinalidade({ certificadoUtilizavel: true, ultimoResultado: 'SUCESSO' })).toBe('OPERACIONAL');
    expect(estadoDaFinalidade({ certificadoUtilizavel: true, ultimoResultado: 'FALHA' })).toBe('FALHA');
  });
});

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
