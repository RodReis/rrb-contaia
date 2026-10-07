import { describe, expect, it } from 'vitest';

import { FINALIDADES, ehFinalidade } from './finalidades.js';

describe('catálogo de finalidades do Signer (SPEC-012 §3.3)', () => {
  it('é fechado em DF-e de teste e eSocial de teste', () => {
    expect([...FINALIDADES]).toEqual(['DFE_TESTE', 'ESOCIAL_TESTE']);
  });

  it('aceita as finalidades do catálogo', () => {
    expect(ehFinalidade('DFE_TESTE')).toBe(true);
    expect(ehFinalidade('ESOCIAL_TESTE')).toBe(true);
  });

  it.each(['', 'dfe_teste', 'DFE', 'LIVRE', 'https://sefaz.gov.br', null, undefined, 1])(
    'recusa finalidade livre ou desconhecida: %s',
    (valor) => {
      expect(ehFinalidade(valor)).toBe(false);
    },
  );
});
