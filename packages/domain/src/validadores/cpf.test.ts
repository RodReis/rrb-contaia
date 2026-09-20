import { describe, expect, it } from 'vitest';

import { ehCpfValido, formatarCpf, normalizarCpf } from './cpf.js';

describe('normalizarCpf', () => {
  it('remove máscara', () => {
    expect(normalizarCpf('529.982.247-25')).toBe('52998224725');
  });
});

describe('ehCpfValido', () => {
  it.each(['52998224725', '529.982.247-25', '11144477735'])('aceita %s', (entrada) => {
    expect(ehCpfValido(entrada)).toBe(true);
  });

  it.each([
    ['dígito verificador errado', '52998224726'],
    ['todos os dígitos iguais', '11111111111'],
    ['curto demais', '5299822472'],
    ['longo demais', '529982247251'],
    ['com letra', '5299822472A'],
    ['vazio', ''],
  ])('recusa %s', (_caso, entrada) => {
    expect(ehCpfValido(entrada)).toBe(false);
  });
});

describe('formatarCpf', () => {
  it('formata quando completo e devolve cru quando não', () => {
    expect(formatarCpf('52998224725')).toBe('529.982.247-25');
    expect(formatarCpf('529982')).toBe('529982');
  });
});
