import { describe, expect, it } from 'vitest';

import { CODIGOS_DE_ERRO, ErroDeValidacao } from '../erros.js';
import { validarDadosDoUsuario } from './dados.js';

const VALIDO = {
  nome: 'Ana Maria Souza',
  email: 'ana@escritorio.com.br',
  telefone: '(11) 98765-4321',
  crc: 'SP-123456/O',
};

const camposDoErro = (entrada: Parameters<typeof validarDadosDoUsuario>[0]) => {
  try {
    validarDadosDoUsuario(entrada);
  } catch (erro) {
    if (erro instanceof ErroDeValidacao) {
      return erro.campos;
    }

    throw erro;
  }

  return [];
};

describe('validarDadosDoUsuario (SPEC-007 §3.2)', () => {
  it('normaliza e-mail, telefone, nome e CRC', () => {
    expect(
      validarDadosDoUsuario({
        nome: '  Ana   Maria  Souza ',
        email: '  Ana@Escritorio.COM.br ',
        telefone: '(11) 98765-4321',
        crc: '  SP-123456/O ',
      }),
    ).toEqual({
      nome: 'Ana Maria Souza',
      email: 'ana@escritorio.com.br',
      telefone: '11987654321',
      crc: 'SP-123456/O',
    });
  });

  it('telefone e CRC são opcionais: ausente, nulo ou em branco viram null', () => {
    for (const vazio of [undefined, null, '', '   ']) {
      expect(
        validarDadosDoUsuario({ ...VALIDO, telefone: vazio, crc: vazio }),
      ).toMatchObject({ telefone: null, crc: null });
    }
  });

  it('exige nome', () => {
    expect(camposDoErro({ ...VALIDO, nome: '   ' })).toEqual([
      { campo: 'nome', codigo: CODIGOS_DE_ERRO.CAMPO_OBRIGATORIO },
    ]);
  });

  it('exige e-mail válido', () => {
    expect(camposDoErro({ ...VALIDO, email: 'sem-arroba' })).toEqual([
      { campo: 'email', codigo: CODIGOS_DE_ERRO.EMAIL_INVALIDO },
    ]);
    expect(camposDoErro({ ...VALIDO, email: '' })).toEqual([
      { campo: 'email', codigo: CODIGOS_DE_ERRO.EMAIL_INVALIDO },
    ]);
  });

  it('recusa telefone preenchido mas inválido', () => {
    expect(camposDoErro({ ...VALIDO, telefone: '123' })).toEqual([
      { campo: 'telefone', codigo: CODIGOS_DE_ERRO.TELEFONE_INVALIDO },
    ]);
  });

  it('informa todos os campos inválidos de uma vez', () => {
    expect(
      camposDoErro({ nome: '', email: 'x', telefone: '1', crc: null }).map((c) => c.campo),
    ).toEqual(['nome', 'email', 'telefone']);
  });
});
