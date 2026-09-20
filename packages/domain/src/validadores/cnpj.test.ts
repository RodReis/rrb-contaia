import { describe, expect, it } from 'vitest';

import { ehCnpjValido, formatarCnpj, normalizarCnpj } from './cnpj.js';

describe('normalizarCnpj', () => {
  it('remove máscara e normaliza para maiúsculas', () => {
    expect(normalizarCnpj('11.222.333/0001-81')).toBe('11222333000181');
    expect(normalizarCnpj('12.abc.345/01de-35')).toBe('12ABC34501DE35');
  });

  it('descarta qualquer caractere fora de [0-9A-Z]', () => {
    expect(normalizarCnpj(' 11 222 333 0001 81 ')).toBe('11222333000181');
  });
});

describe('ehCnpjValido — numérico', () => {
  it.each(['11222333000181', '11.222.333/0001-81', '45723174000110'])(
    'aceita CNPJ numérico válido %s',
    (entrada) => {
      expect(ehCnpjValido(entrada)).toBe(true);
    },
  );

  it.each([
    ['dígito verificador errado', '11222333000182'],
    ['todos os dígitos iguais', '11111111111111'],
    ['zeros', '00000000000000'],
    ['curto demais', '1122233300018'],
    ['longo demais', '112223330001812'],
    ['vazio', ''],
  ])('recusa %s', (_caso, entrada) => {
    expect(ehCnpjValido(entrada)).toBe(false);
  });
});

describe('ehCnpjValido — alfanumérico (regra vigente a partir de 2026)', () => {
  // Raiz/ordem alfanuméricos, DV numérico: peso sobre (ASCII - 48).
  it.each(['12ABC34501DE35', '12.ABC.345/01DE-35', '12abc34501de35'])(
    'aceita CNPJ alfanumérico válido %s',
    (entrada) => {
      expect(ehCnpjValido(entrada)).toBe(true);
    },
  );

  it('recusa alfanumérico com dígito verificador errado', () => {
    expect(ehCnpjValido('12ABC34501DE34')).toBe(false);
  });

  it('recusa letra na posição do dígito verificador', () => {
    expect(ehCnpjValido('12ABC34501DEA5')).toBe(false);
  });
});

describe('formatarCnpj', () => {
  it('formata numérico e alfanumérico', () => {
    expect(formatarCnpj('11222333000181')).toBe('11.222.333/0001-81');
    expect(formatarCnpj('12ABC34501DE35')).toBe('12.ABC.345/01DE-35');
  });

  it('devolve a entrada normalizada quando não tem 14 caracteres', () => {
    expect(formatarCnpj('112223')).toBe('112223');
  });
});
