import { describe, expect, it, vi } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { CODIGOS_DE_ERRO, ErroDeDominio } from '@contaia/domain';

import { ExigePapel, GuardDePapel, PAPEIS_EXIGIDOS } from './papel.guard';
import type { RequisicaoAutenticada } from './sessao.guard';

const contextoCom = (papel: string | undefined): ExecutionContext => {
  const requisicao = { sessao: papel === undefined ? undefined : { papel } } as RequisicaoAutenticada;

  return {
    switchToHttp: () => ({ getRequest: () => requisicao }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
};

describe('GuardDePapel', () => {
  it('permite quando o papel da sessao esta na lista exigida', () => {
    const reflector = new Reflector();
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['admin_escritorio']);
    const guard = new GuardDePapel(reflector);

    expect(guard.canActivate(contextoCom('admin_escritorio'))).toBe(true);
  });

  it('nega com o codigo SEM_AUTORIZACAO quando o papel da sessao nao esta na lista exigida', () => {
    const reflector = new Reflector();
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['admin_escritorio']);
    const guard = new GuardDePapel(reflector);

    expect.assertions(2);

    try {
      guard.canActivate(contextoCom('usuario_padrao'));
    } catch (erro) {
      expect(erro).toBeInstanceOf(ErroDeDominio);
      expect((erro as ErroDeDominio).codigo).toBe(CODIGOS_DE_ERRO.SEM_AUTORIZACAO);
    }
  });

  it('permite quando a rota nao exige papel algum (metadado ausente)', () => {
    const reflector = new Reflector();
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    const guard = new GuardDePapel(reflector);

    expect(guard.canActivate(contextoCom('qualquer_papel'))).toBe(true);
  });

  it('ExigePapel grava o metadado com a chave PAPEIS_EXIGIDOS', () => {
    class Alvo {}
    ExigePapel('admin_escritorio')(Alvo);

    const reflector = new Reflector();
    expect(reflector.get(PAPEIS_EXIGIDOS, Alvo)).toEqual(['admin_escritorio']);
  });
});
