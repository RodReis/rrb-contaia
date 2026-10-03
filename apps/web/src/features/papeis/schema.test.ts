import { describe, expect, it } from 'vitest';

import { ERRO_DE_MATRIZ, dadosDoPapelFormSchema, descricaoOuNula, erroDaMatriz } from './schema';

const mensagens = (entrada: unknown): Record<string, string> => {
  const resultado = dadosDoPapelFormSchema.safeParse(entrada);

  if (resultado.success) {
    return {};
  }

  return Object.fromEntries(
    resultado.error.issues.map((problema) => [String(problema.path[0]), problema.message]),
  );
};

describe('dadosDoPapelFormSchema (SPEC-008 §3.1)', () => {
  it('aceita nome com descrição vazia', () => {
    expect(mensagens({ nome: 'Revisor', descricao: '' })).toEqual({});
  });

  it('exige nome, ignorando espaços nas pontas', () => {
    expect(mensagens({ nome: '', descricao: '' })['nome']).toBe('Informe o nome do papel');
    expect(mensagens({ nome: '   ', descricao: '' })['nome']).toBe('Informe o nome do papel');
  });

  it('impõe os mesmos tetos que a API e o banco', () => {
    expect(mensagens({ nome: 'x'.repeat(80), descricao: '' })).toEqual({});
    expect(mensagens({ nome: 'x'.repeat(81), descricao: '' })['nome']).toBe('Use no máximo 80 caracteres');
    expect(mensagens({ nome: 'ok', descricao: 'x'.repeat(300) })).toEqual({});
    expect(mensagens({ nome: 'ok', descricao: 'x'.repeat(301) })['descricao']).toBe(
      'Use no máximo 300 caracteres',
    );
  });
});

describe('descricaoOuNula', () => {
  it('descrição em branco vai como null; preenchida vai aparada', () => {
    expect(descricaoOuNula('')).toBeNull();
    expect(descricaoOuNula('   ')).toBeNull();
    expect(descricaoOuNula('  Confere guias ')).toBe('Confere guias');
  });
});

describe('erroDaMatriz', () => {
  it('exige ao menos uma permissão', () => {
    expect(erroDaMatriz([])).toBe(ERRO_DE_MATRIZ);
    expect(erroDaMatriz(['empresas.cadastro.consultar'])).toBeUndefined();
  });
});
