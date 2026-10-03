import { describe, expect, it } from 'vitest';

import {
  ERRO_DE_PAPEL,
  dadosDoUsuarioFormSchema,
  erroDosPapeis,
  paraDadosDeEdicao,
  paraDadosDoConvite,
} from './schema';

const VALIDO = { nome: 'Ana Souza', email: 'ana@escritorio.com', telefone: '', crc: '' };

const mensagens = (entrada: unknown): Record<string, string> => {
  const resultado = dadosDoUsuarioFormSchema.safeParse(entrada);

  if (resultado.success) {
    return {};
  }

  return Object.fromEntries(
    resultado.error.issues.map((problema) => [String(problema.path[0]), problema.message]),
  );
};

describe('dadosDoUsuarioFormSchema (SPEC-007 §3.2)', () => {
  it('aceita nome e e-mail; telefone e CRC são opcionais', () => {
    expect(dadosDoUsuarioFormSchema.safeParse(VALIDO).success).toBe(true);
  });

  it('exige nome com ao menos três letras, ignorando espaços nas pontas', () => {
    expect(mensagens({ ...VALIDO, nome: '' })['nome']).toBe('Informe o nome completo');
    expect(mensagens({ ...VALIDO, nome: '  ab  ' })['nome']).toBe('Informe o nome completo');
    expect(mensagens({ ...VALIDO, nome: 'Ana' })).toEqual({});
  });

  it('recusa e-mail inválido com o mesmo validador do domínio', () => {
    expect(mensagens({ ...VALIDO, email: 'sem-arroba' })['email']).toBe('E-mail inválido');
    expect(mensagens({ ...VALIDO, email: '' })['email']).toBe('E-mail inválido');
  });

  it('telefone vazio passa; preenchido precisa ser válido, com ou sem máscara', () => {
    expect(mensagens({ ...VALIDO, telefone: '' })).toEqual({});
    expect(mensagens({ ...VALIDO, telefone: '11987654321' })).toEqual({});
    expect(mensagens({ ...VALIDO, telefone: '(11) 98765-4321' })).toEqual({});
    expect(mensagens({ ...VALIDO, telefone: '123' })['telefone']).toBe('Telefone inválido');
  });

  it('impõe tetos de tamanho', () => {
    expect(mensagens({ ...VALIDO, nome: 'x'.repeat(121) })['nome']).toBeDefined();
    expect(mensagens({ ...VALIDO, crc: 'x'.repeat(41) })['crc']).toBeDefined();
  });
});

describe('erroDosPapeis', () => {
  it('exige ao menos um papel', () => {
    expect(erroDosPapeis([])).toBe(ERRO_DE_PAPEL);
    expect(erroDosPapeis(['contador'])).toBeUndefined();
    expect(erroDosPapeis(['contador', 'auxiliar'])).toBeUndefined();
  });
});

describe('conversão para o contrato da API', () => {
  it('convite: telefone só com dígitos e vazio vira null; e-mail e nome aparados', () => {
    expect(
      paraDadosDoConvite(
        { nome: ' Ana Souza ', email: ' Ana@Escritorio.com ', telefone: '(11) 98765-4321', crc: ' SP-1 ' },
        ['contador'],
      ),
    ).toEqual({
      nome: 'Ana Souza',
      email: 'Ana@Escritorio.com',
      telefone: '11987654321',
      crc: 'SP-1',
      papeis: ['contador'],
    });

    expect(paraDadosDoConvite(VALIDO, ['auxiliar'])).toMatchObject({ telefone: null, crc: null });
  });

  it('edição: só envia o e-mail quando ele é editável, senão o campo nem vai', () => {
    expect(paraDadosDeEdicao(VALIDO, ['contador'], true)).toHaveProperty('email', 'ana@escritorio.com');
    expect(paraDadosDeEdicao(VALIDO, ['contador'], false)).not.toHaveProperty('email');
  });
});
