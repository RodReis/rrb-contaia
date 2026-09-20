import { describe, expect, it } from 'vitest';

import {
  ehCepValido,
  ehEmailValido,
  ehTelefoneValido,
  ehUfValida,
  formatarCep,
  formatarTelefone,
  normalizarEmail,
} from './contato.js';

describe('ehTelefoneValido', () => {
  it.each(['11987654321', '(11) 98765-4321', '1133334444'])('aceita %s', (entrada) => {
    expect(ehTelefoneValido(entrada)).toBe(true);
  });

  it.each([
    ['DDD inexistente', '10987654321'],
    ['celular sem o 9', '11887654321'],
    ['fixo começando por 9', '1193334444'],
    ['curto demais', '119876543'],
    ['longo demais', '119876543210'],
  ])('recusa %s', (_caso, entrada) => {
    expect(ehTelefoneValido(entrada)).toBe(false);
  });
});

describe('formatarTelefone', () => {
  it('formata celular e fixo', () => {
    expect(formatarTelefone('11987654321')).toBe('(11) 98765-4321');
    expect(formatarTelefone('1133334444')).toBe('(11) 3333-4444');
  });
});

describe('CEP', () => {
  it('valida e formata', () => {
    expect(ehCepValido('01310-100')).toBe(true);
    expect(ehCepValido('0131010')).toBe(false);
    expect(formatarCep('01310100')).toBe('01310-100');
  });
});

describe('e-mail', () => {
  it('normaliza com trim e minúsculas', () => {
    expect(normalizarEmail('  Contato@Escritorio.CNT.BR ')).toBe('contato@escritorio.cnt.br');
  });

  it.each(['contato@escritorio.cnt.br', 'a.b+c@dominio.com'])('aceita %s', (entrada) => {
    expect(ehEmailValido(entrada)).toBe(true);
  });

  it.each([['sem arroba', 'contato.escritorio.br'], ['sem domínio', 'contato@escritorio'], ['com espaço', 'a b@c.br'], ['vazio', '']])(
    'recusa %s',
    (_caso, entrada) => {
      expect(ehEmailValido(entrada)).toBe(false);
    },
  );
});

describe('UF', () => {
  it('aceita UF existente e recusa inexistente', () => {
    expect(ehUfValida('sp')).toBe(true);
    expect(ehUfValida('XX')).toBe(false);
  });
});
