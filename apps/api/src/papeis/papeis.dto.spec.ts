import { describe, expect, it } from 'vitest';

import { CODIGOS_DE_ERRO, ErroDeDominio } from '@contaia/domain';

import { analisar } from '../escritorio/escritorio.dto';
import {
  arquivamentoDePapelSchema,
  criacaoDePapelSchema,
  edicaoDePapelSchema,
  filtroDePapeisSchema,
  reativacaoDePapelSchema,
} from './papeis.dto';

const codigoDe = (executar: () => unknown): string | undefined => {
  try {
    executar();
  } catch (erro) {
    return erro instanceof ErroDeDominio ? erro.codigo : 'OUTRO';
  }

  return undefined;
};

describe('criacaoDePapelSchema', () => {
  const BASE = {
    nome: 'Revisor',
    papelBase: 'auxiliar',
    permissoes: ['empresas.cadastro.consultar'],
  };

  it('aceita o mínimo e deixa a descrição opcional', () => {
    expect(analisar(criacaoDePapelSchema, BASE)).toMatchObject(BASE);
    expect(analisar(criacaoDePapelSchema, { ...BASE, descricao: null }).descricao).toBeNull();
  });

  it('deixa passar chave desconhecida: quem distingue 422 de 403 é o domínio', () => {
    expect(
      analisar(criacaoDePapelSchema, { ...BASE, permissoes: ['qualquer.coisa.livre', 7] }).permissoes,
    ).toEqual(['qualquer.coisa.livre', 7]);
  });

  it('exige nome, base e matriz como lista', () => {
    for (const faltando of ['nome', 'papelBase', 'permissoes']) {
      const corpo: Record<string, unknown> = { ...BASE };

      delete corpo[faltando];

      expect(codigoDe(() => analisar(criacaoDePapelSchema, corpo))).toBe(
        CODIGOS_DE_ERRO.CAMPO_OBRIGATORIO,
      );
    }

    expect(
      codigoDe(() => analisar(criacaoDePapelSchema, { ...BASE, permissoes: 'empresas' })),
    ).toBe(CODIGOS_DE_ERRO.CAMPO_OBRIGATORIO);
  });

  it('limita o tamanho da matriz recebida', () => {
    expect(
      codigoDe(() => analisar(criacaoDePapelSchema, { ...BASE, permissoes: Array(201).fill('a.b.c') })),
    ).toBe(CODIGOS_DE_ERRO.CAMPO_OBRIGATORIO);
  });
});

describe('edicaoDePapelSchema', () => {
  const BASE = { nome: 'Revisor', permissoes: ['x'], revisaoEsperada: 3 };

  it('a confirmação de redução é falsa por padrão', () => {
    expect(analisar(edicaoDePapelSchema, BASE).confirmaReducao).toBe(false);
    expect(analisar(edicaoDePapelSchema, { ...BASE, confirmaReducao: true }).confirmaReducao).toBe(
      true,
    );
  });

  it('exige a revisão que o cliente leu, inteira e positiva', () => {
    for (const revisaoEsperada of [undefined, 0, -1, 1.5, '3']) {
      expect(codigoDe(() => analisar(edicaoDePapelSchema, { ...BASE, revisaoEsperada }))).toBe(
        CODIGOS_DE_ERRO.CAMPO_OBRIGATORIO,
      );
    }
  });
});

describe('arquivamento e reativação', () => {
  it('arquivar só pede a revisão lida', () => {
    expect(analisar(arquivamentoDePapelSchema, { revisaoEsperada: 2 })).toEqual({ revisaoEsperada: 2 });
    expect(codigoDe(() => analisar(arquivamentoDePapelSchema, {}))).toBe(
      CODIGOS_DE_ERRO.CAMPO_OBRIGATORIO,
    );
  });

  it('reativar exige a matriz revisada; a confirmação das incompatibilidades é falsa por padrão', () => {
    const corpo = { revisaoEsperada: 2, permissoes: ['empresas.cadastro.consultar'] };

    expect(analisar(reativacaoDePapelSchema, corpo).confirmaIncompatibilidades).toBe(false);
    expect(codigoDe(() => analisar(reativacaoDePapelSchema, { revisaoEsperada: 2 }))).toBe(
      CODIGOS_DE_ERRO.CAMPO_OBRIGATORIO,
    );
  });
});

describe('filtroDePapeisSchema', () => {
  it('usa 25 por página e começa no zero, sem filtrar estado', () => {
    expect(analisar(filtroDePapeisSchema, {})).toEqual({ limite: 25, deslocamento: 0 });
  });

  it('aceita busca e estado e ignora busca vazia', () => {
    expect(
      analisar(filtroDePapeisSchema, { busca: 'rev', estado: 'ARQUIVADO', limite: '10', deslocamento: '5' }),
    ).toEqual({ busca: 'rev', estado: 'ARQUIVADO', limite: 10, deslocamento: 5 });
    expect(analisar(filtroDePapeisSchema, { busca: '' })).toEqual({ limite: 25, deslocamento: 0 });
  });

  it('recusa estado inventado e limite fora da faixa', () => {
    expect(codigoDe(() => analisar(filtroDePapeisSchema, { estado: 'RASCUNHO' }))).toBe(
      CODIGOS_DE_ERRO.CAMPO_OBRIGATORIO,
    );
    expect(codigoDe(() => analisar(filtroDePapeisSchema, { limite: '101' }))).toBe(
      CODIGOS_DE_ERRO.CAMPO_OBRIGATORIO,
    );
  });
});
