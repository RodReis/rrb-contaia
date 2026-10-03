import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { CODIGOS_DE_ERRO, ErroDeDominio, type PapelPadrao } from '@contaia/domain';

import { escopoDaSessao, exigirAlcada, GuardDeEscopoDeEmpresa } from './escopo';
import type { RequisicaoAutenticada } from './sessao.guard';

const requisicaoCom = (
  papeis: readonly PapelPadrao[],
  params: Record<string, string> = {},
): RequisicaoAutenticada => ({ sessao: { papeis }, params }) as unknown as RequisicaoAutenticada;

const contexto = (requisicao: RequisicaoAutenticada): ExecutionContext =>
  ({ switchToHttp: () => ({ getRequest: () => requisicao }) }) as unknown as ExecutionContext;

const codigoDe = (funcao: () => unknown): string | undefined => {
  try {
    funcao();
  } catch (erro) {
    return erro instanceof ErroDeDominio ? erro.codigo : 'OUTRO';
  }

  return undefined;
};

describe('escopoDaSessao', () => {
  it('administrador enxerga todas as empresas do escritório', () => {
    expect(escopoDaSessao(requisicaoCom(['admin_escritorio']))).toBe('TODAS');
  });

  it('demais papéis não enxergam nenhuma empresa até a carteira existir', () => {
    expect(escopoDaSessao(requisicaoCom(['contador']))).toBe('NENHUMA');
    expect(escopoDaSessao(requisicaoCom(['auxiliar', 'auditor_readonly']))).toBe('NENHUMA');
  });

  it('sem sessão não enxerga nenhuma', () => {
    expect(escopoDaSessao({} as RequisicaoAutenticada)).toBe('NENHUMA');
  });
});

describe('exigirAlcada', () => {
  it('não lança para quem enxerga todas', () => {
    expect(() => exigirAlcada(requisicaoCom(['admin_escritorio']))).not.toThrow();
  });

  it('lança SEM_ALCADA para quem não enxerga nenhuma', () => {
    expect(codigoDe(() => exigirAlcada(requisicaoCom(['contador'])))).toBe(
      CODIGOS_DE_ERRO.SEM_ALCADA,
    );
  });
});

describe('GuardDeEscopoDeEmpresa', () => {
  const guard = new GuardDeEscopoDeEmpresa();

  it('rota por empresa responde como empresa inexistente quando não há alçada', () => {
    expect(
      codigoDe(() => guard.canActivate(contexto(requisicaoCom(['contador'], { empresaId: 'x' })))),
    ).toBe(CODIGOS_DE_ERRO.EMPRESA_NAO_ENCONTRADA);
  });

  it('rota por empresa passa para o administrador', () => {
    expect(
      guard.canActivate(contexto(requisicaoCom(['admin_escritorio'], { empresaId: 'x' }))),
    ).toBe(true);
  });

  it('rota sem empresaId não é decidida por este guard', () => {
    expect(guard.canActivate(contexto(requisicaoCom(['contador'])))).toBe(true);
  });
});
