import { describe, expect, it } from 'vitest';

import { CODIGOS_DE_ERRO, ErroDeDominio } from '../erros.js';
import type { ChaveDoCatalogo } from './catalogo.js';
import { consultaImplicada, dependentesDeConsulta } from './catalogo.js';
import {
  concederPermissao,
  diferencaDeMatriz,
  ehReducao,
  matrizParaRevisao,
  moduloVisivel,
  normalizarMatriz,
  ocultarModulo,
  revogarPermissao,
} from './matriz.js';

const codigoDe = (acao: () => unknown): string | undefined => {
  try {
    acao();
  } catch (erro) {
    return erro instanceof ErroDeDominio ? erro.codigo : 'OUTRO';
  }

  return undefined;
};

describe('normalizarMatriz (entrada do servidor)', () => {
  it('concede Consultar automaticamente a quem pede ação dependente', () => {
    expect(normalizarMatriz(['documentos.arquivos.baixar'])).toEqual([
      'documentos.arquivos.consultar',
      'documentos.arquivos.baixar',
    ]);
  });

  it('remove repetições e ordena pelo catálogo', () => {
    expect(
      normalizarMatriz([
        'historico.global.consultar',
        'empresas.cadastro.consultar',
        'historico.global.consultar',
      ]),
    ).toEqual(['empresas.cadastro.consultar', 'historico.global.consultar']);
  });

  it('matriz vazia ou fora do formato é inválida (422)', () => {
    expect(codigoDe(() => normalizarMatriz([]))).toBe(CODIGOS_DE_ERRO.MATRIZ_INVALIDA);
    expect(codigoDe(() => normalizarMatriz(undefined))).toBe(CODIGOS_DE_ERRO.MATRIZ_INVALIDA);
    expect(codigoDe(() => normalizarMatriz('empresas.cadastro.consultar'))).toBe(
      CODIGOS_DE_ERRO.MATRIZ_INVALIDA,
    );
  });

  it('chave livre, obsoleta ou de outro tipo é recusada (422)', () => {
    expect(codigoDe(() => normalizarMatriz(['empresas.cadastro.excluir']))).toBe(
      CODIGOS_DE_ERRO.PERMISSAO_INEXISTENTE,
    );
    expect(codigoDe(() => normalizarMatriz([7]))).toBe(CODIGOS_DE_ERRO.PERMISSAO_INEXISTENTE);
    expect(
      codigoDe(() => normalizarMatriz(['empresas.cadastro.consultar', 'financeiro.x.consultar'])),
    ).toBe(CODIGOS_DE_ERRO.PERMISSAO_INEXISTENTE);
  });

  it('área exclusiva é recusada (403), mesmo misturada a chaves válidas', () => {
    expect(
      codigoDe(() =>
        normalizarMatriz(['empresas.cadastro.consultar', 'usuarios.usuarios_e_papeis.consultar']),
      ),
    ).toBe(CODIGOS_DE_ERRO.PERMISSAO_EXCLUSIVA);
    expect(codigoDe(() => normalizarMatriz(['usuarios.usuarios_e_papeis.administrar']))).toBe(
      CODIGOS_DE_ERRO.PERMISSAO_EXCLUSIVA,
    );
  });
});

describe('edição da matriz', () => {
  const BASE: readonly ChaveDoCatalogo[] = [
    'documentos.arquivos.consultar',
    'documentos.arquivos.enviar',
    'documentos.analise.consultar',
  ];

  it('conceder ação dependente concede Consultar', () => {
    expect(concederPermissao([], 'documentos.analise.aprovar')).toEqual([
      'documentos.analise.consultar',
      'documentos.analise.aprovar',
    ]);
  });

  it('retirar Consultar revoga as dependentes da funcionalidade e só delas', () => {
    expect(revogarPermissao(BASE, 'documentos.arquivos.consultar')).toEqual([
      'documentos.analise.consultar',
    ]);
  });

  it('retirar uma ação dependente mantém Consultar', () => {
    expect(revogarPermissao(BASE, 'documentos.arquivos.enviar')).toEqual([
      'documentos.arquivos.consultar',
      'documentos.analise.consultar',
    ]);
  });

  it('Substituir implica Enviar: conceder um concede o par, e a entrada do servidor também', () => {
    const par = [
      'documentos.arquivos.consultar',
      'documentos.arquivos.enviar',
      'documentos.arquivos.substituir',
    ];

    expect(concederPermissao([], 'documentos.arquivos.substituir')).toEqual(par);
    expect(normalizarMatriz(['documentos.arquivos.substituir'])).toEqual(par);
  });

  it('retirar Enviar leva Substituir, que dele depende', () => {
    expect(
      revogarPermissao(
        [
          'documentos.arquivos.consultar',
          'documentos.arquivos.enviar',
          'documentos.arquivos.substituir',
        ],
        'documentos.arquivos.enviar',
      ),
    ).toEqual(['documentos.arquivos.consultar']);
  });

  it('plano de contas: toda ação nova implica Consultar da própria funcionalidade (SPEC-013)', () => {
    for (const acao of ['importar', 'confirmar_importacao', 'baixar_relatorio'] as const) {
      expect(consultaImplicada(`empresas.plano_contas.${acao}`)).toBe(
        'empresas.plano_contas.consultar',
      );
    }
  });

  it('plano de contas: Consultar arrasta as três ações novas e nada de outra funcionalidade', () => {
    expect(dependentesDeConsulta('empresas.plano_contas.consultar')).toEqual([
      'empresas.plano_contas.importar',
      'empresas.plano_contas.confirmar_importacao',
      'empresas.plano_contas.baixar_relatorio',
    ]);
  });

  it('plano de contas: confirmar importação concede só Consultar, sem Importar (SPEC-013)', () => {
    expect(concederPermissao([], 'empresas.plano_contas.confirmar_importacao')).toEqual([
      'empresas.plano_contas.consultar',
      'empresas.plano_contas.confirmar_importacao',
    ]);
    expect(normalizarMatriz(['empresas.plano_contas.baixar_relatorio'])).toEqual([
      'empresas.plano_contas.consultar',
      'empresas.plano_contas.baixar_relatorio',
    ]);
  });

  it('plano de contas: retirar Consultar revoga importar, confirmar e baixar relatório', () => {
    expect(
      revogarPermissao(
        [
          'empresas.cadastro.consultar',
          'empresas.plano_contas.consultar',
          'empresas.plano_contas.importar',
          'empresas.plano_contas.confirmar_importacao',
          'empresas.plano_contas.baixar_relatorio',
        ],
        'empresas.plano_contas.consultar',
      ),
    ).toEqual(['empresas.cadastro.consultar']);
  });

  it('módulo é visível quando alguma funcionalidade tem Consultar', () => {
    expect(moduloVisivel(BASE, 'documentos')).toBe(true);
    expect(moduloVisivel(BASE, 'empresas')).toBe(false);
  });

  it('ocultar módulo revoga a subárvore e informa quantas permissões saem', () => {
    const resultado = ocultarModulo([...BASE, 'historico.global.consultar'], 'documentos');

    expect(resultado.matriz).toEqual(['historico.global.consultar']);
    expect(resultado.removidas).toBe(3);
  });

  it('ocultar módulo sem permissões marcadas não remove nada', () => {
    expect(ocultarModulo(BASE, 'empresas')).toEqual({ matriz: BASE, removidas: 0 });
  });
});

describe('diferença entre matrizes', () => {
  it('lista permissões adicionadas e retiradas', () => {
    const diferenca = diferencaDeMatriz(
      ['empresas.cadastro.consultar', 'empresas.cadastro.criar'],
      ['empresas.cadastro.consultar', 'historico.global.consultar'],
    );

    expect(diferenca.adicionadas).toEqual(['historico.global.consultar']);
    expect(diferenca.retiradas).toEqual(['empresas.cadastro.criar']);
    expect(ehReducao(diferenca)).toBe(true);
  });

  it('só acrescentar não é redução', () => {
    const diferenca = diferencaDeMatriz(
      ['empresas.cadastro.consultar'],
      ['empresas.cadastro.consultar', 'empresas.cadastro.criar'],
    );

    expect(ehReducao(diferenca)).toBe(false);
  });

  it('matrizes iguais não têm diferença', () => {
    const matriz: readonly ChaveDoCatalogo[] = ['empresas.cadastro.consultar'];

    expect(diferencaDeMatriz(matriz, matriz)).toEqual({ adicionadas: [], retiradas: [] });
  });
});

describe('revisão de matriz na reativação (SPEC-008 §3.5)', () => {
  it('separa o que o catálogo ainda aceita do que ficou obsoleto', () => {
    const resultado = matrizParaRevisao([
      'empresas.cadastro.consultar',
      'empresas.cadastro.excluir',
      'usuarios.usuarios_e_papeis.consultar',
    ]);

    expect(resultado.vigentes).toEqual(['empresas.cadastro.consultar']);
    expect(resultado.incompativeis).toEqual([
      'empresas.cadastro.excluir',
      'usuarios.usuarios_e_papeis.consultar',
    ]);
  });
});
