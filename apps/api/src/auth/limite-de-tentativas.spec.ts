import { HttpException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { GuardDeLimiteDeTentativas, LimitadorDeTentativas } from './limite-de-tentativas';

describe('LimitadorDeTentativas', () => {
  const T0 = 1_000_000;

  it('permite até o máximo dentro da janela e nega a seguinte', () => {
    const limitador = new LimitadorDeTentativas(3, 60_000);

    expect([1, 2, 3, 4].map(() => limitador.tentar('ip-1', T0))).toEqual([true, true, true, false]);
  });

  it('libera de novo quando a janela passa', () => {
    const limitador = new LimitadorDeTentativas(2, 60_000);

    limitador.tentar('ip-1', T0);
    limitador.tentar('ip-1', T0);

    expect(limitador.tentar('ip-1', T0 + 59_999)).toBe(false);
    expect(limitador.tentar('ip-1', T0 + 60_000)).toBe(true);
  });

  it('chaves diferentes não se afetam', () => {
    const limitador = new LimitadorDeTentativas(1, 60_000);

    expect(limitador.tentar('ip-1', T0)).toBe(true);
    expect(limitador.tentar('ip-2', T0)).toBe(true);
    expect(limitador.tentar('ip-1', T0)).toBe(false);
  });

  it('descarta janelas vencidas para a memória não crescer sem limite', () => {
    const limitador = new LimitadorDeTentativas(1, 1_000);

    for (let i = 0; i < 500; i += 1) {
      limitador.tentar(`ip-${i}`, T0);
    }

    limitador.tentar('novo', T0 + 5_000);

    expect(limitador.tamanho()).toBeLessThan(10);
  });
});

describe('GuardDeLimiteDeTentativas', () => {
  const contexto = (cabecalhos: Record<string, string>, ip = '10.0.0.1', rota = '/convites/x') =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({
          header: (nome: string) => cabecalhos[nome.toLowerCase()],
          ip,
          path: rota,
        }),
      }),
    }) as unknown as ExecutionContext;

  let guard: GuardDeLimiteDeTentativas;

  beforeEach(() => {
    guard = new GuardDeLimiteDeTentativas(new LimitadorDeTentativas(10, 60_000));
  });

  const statusDe = (executar: () => unknown): number | undefined => {
    try {
      executar();
    } catch (erro) {
      return erro instanceof HttpException ? erro.getStatus() : -1;
    }

    return undefined;
  };

  it('a 11ª tentativa do mesmo cliente na mesma rota é 429', () => {
    for (let i = 0; i < 10; i += 1) {
      expect(guard.canActivate(contexto({}))).toBe(true);
    }

    expect(statusDe(() => guard.canActivate(contexto({})))).toBe(429);
  });

  it('usa o cliente informado por X-Forwarded-For (a web fica na frente da API)', () => {
    for (let i = 0; i < 10; i += 1) {
      guard.canActivate(contexto({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }));
    }

    expect(statusDe(() => guard.canActivate(contexto({ 'x-forwarded-for': '203.0.113.7' })))).toBe(
      429,
    );
    // Outro cliente atrás do mesmo proxy não é punido.
    expect(guard.canActivate(contexto({ 'x-forwarded-for': '198.51.100.9' }))).toBe(true);
  });

  it('rotas diferentes têm contagens independentes', () => {
    for (let i = 0; i < 10; i += 1) {
      guard.canActivate(contexto({}, '10.0.0.1', '/convites/aceitar'));
    }

    expect(guard.canActivate(contexto({}, '10.0.0.1', '/convites/outra'))).toBe(true);
  });
});
