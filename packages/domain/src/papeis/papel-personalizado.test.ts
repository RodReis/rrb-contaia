import { describe, expect, it } from 'vitest';

import { CODIGOS_DE_ERRO, ErroDeDominio, ErroDeValidacao } from '../erros.js';
import {
  TAMANHO_MAXIMO_DA_DESCRICAO,
  TAMANHO_MAXIMO_DO_NOME,
  garantirPapelSemVinculos,
  normalizarNomeDoPapel,
  transicionarPapel,
  validarDadosDoPapel,
} from './papel-personalizado.js';

describe('nome do papel (SPEC-008 §3.1)', () => {
  it('a unicidade ignora caixa, espaços nas pontas e repetidos', () => {
    expect(normalizarNomeDoPapel('  Revisor   Fiscal ')).toBe('revisor fiscal');
    expect(normalizarNomeDoPapel('REVISOR FISCAL')).toBe(normalizarNomeDoPapel('revisor fiscal'));
  });

  it('aceita nome com descrição opcional', () => {
    expect(validarDadosDoPapel({ nome: ' Revisor ', descricao: '  Confere  ' })).toEqual({
      nome: 'Revisor',
      descricao: 'Confere',
    });
    expect(validarDadosDoPapel({ nome: 'Revisor' }).descricao).toBeNull();
    expect(validarDadosDoPapel({ nome: 'Revisor', descricao: '   ' }).descricao).toBeNull();
  });

  it('nome é obrigatório', () => {
    expect(() => validarDadosDoPapel({ nome: '   ' })).toThrow(ErroDeValidacao);
    expect(() => validarDadosDoPapel({ nome: 10 })).toThrow(ErroDeValidacao);
    expect(() => validarDadosDoPapel({ nome: undefined })).toThrow(ErroDeValidacao);
  });

  it('respeita os tamanhos máximos', () => {
    expect(() => validarDadosDoPapel({ nome: 'a'.repeat(TAMANHO_MAXIMO_DO_NOME + 1) })).toThrow(
      ErroDeValidacao,
    );
    expect(() =>
      validarDadosDoPapel({ nome: 'ok', descricao: 'a'.repeat(TAMANHO_MAXIMO_DA_DESCRICAO + 1) }),
    ).toThrow(ErroDeValidacao);
    expect(validarDadosDoPapel({ nome: 'a'.repeat(TAMANHO_MAXIMO_DO_NOME) }).nome).toHaveLength(
      TAMANHO_MAXIMO_DO_NOME,
    );
  });
});

describe('ciclo de vida do papel (SPEC-008 §3.5)', () => {
  it('ativo arquiva e arquivado reativa', () => {
    expect(transicionarPapel('ATIVO', 'ARQUIVAR')).toBe('ARQUIVADO');
    expect(transicionarPapel('ARQUIVADO', 'REATIVAR')).toBe('ATIVO');
  });

  it('transição fora do ciclo é recusada', () => {
    const tentar = (acao: () => unknown): string | undefined => {
      try {
        acao();
      } catch (erro) {
        return erro instanceof ErroDeDominio ? erro.codigo : 'OUTRO';
      }

      return undefined;
    };

    expect(tentar(() => transicionarPapel('ATIVO', 'REATIVAR'))).toBe(
      CODIGOS_DE_ERRO.TRANSICAO_DE_PAPEL_INVALIDA,
    );
    expect(tentar(() => transicionarPapel('ARQUIVADO', 'ARQUIVAR'))).toBe(
      CODIGOS_DE_ERRO.TRANSICAO_DE_PAPEL_INVALIDA,
    );
  });

  it('papel com usuário vinculado não arquiva', () => {
    expect(() => garantirPapelSemVinculos(0)).not.toThrow();
    expect(() => garantirPapelSemVinculos(2)).toThrow(ErroDeDominio);
  });
});
