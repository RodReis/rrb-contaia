import { describe, expect, it, vi } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { CODIGOS_DE_ERRO, ErroDeDominio } from '@contaia/domain';

import { ExigePapel, GuardDePapel, PAPEIS_EXIGIDOS } from './papel.guard';
import type { RequisicaoAutenticada } from './sessao.guard';

const contextoCom = (papel: string | undefined, metadados: unknown): ExecutionContext => {
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

    expect(guard.canActivate(contextoCom('admin_escritorio', undefined))).toBe(true);
  });

  it('nega quando o papel da sessao nao esta na lista exigida', () => {
    const reflector = new Reflector();
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['admin_escritorio']);
    const guard = new GuardDePapel(reflector);

    expect(() => guard.canActivate(contextoCom('usuario_padrao', undefined))).toThrow(ErroDeDominio);
  });

  it('permite quando a rota nao exige papel algum (metadado ausente)', () => {
    const reflector = new Reflector();
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    const guard = new GuardDePapel(reflector);

    expect(guard.canActivate(contextoCom('qualquer_papel', undefined))).toBe(true);
  });

  it('ExigePapel grava o metadado com a chave PAPEIS_EXIGIDOS', () => {
    class Alvo {}
    ExigePapel('admin_escritorio')(Alvo);

    const reflector = new Reflector();
    expect(reflector.get(PAPEIS_EXIGIDOS, Alvo)).toEqual(['admin_escritorio']);
  });
});
