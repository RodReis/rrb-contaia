/**
 * `Retry-After` do 503 (SPEC-015 §3.10, serviço de leitura ocupado): o cliente HTTP guarda a espera
 * pedida pela API no problema, para a tela só oferecer a nova tentativa depois dela.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ErroDaApi, requisitar } from './http';

afterEach(() => {
  vi.unstubAllGlobals();
});

const falhaDe = async (acao: () => Promise<unknown>): Promise<ErroDaApi> => {
  try {
    await acao();
  } catch (erro) {
    if (erro instanceof ErroDaApi) {
      return erro;
    }
  }

  throw new Error('a chamada deveria ter falhado com ErroDaApi');
};

const ocupado = (retryAfter: string | null): Response =>
  new Response(JSON.stringify({ type: 'x', title: 'x', status: 503, code: 'SERVICO_OCUPADO', correlationId: 'corr-503' }), {
    status: 503,
    headers: {
      'content-type': 'application/problem+json',
      ...(retryAfter === null ? {} : { 'retry-after': retryAfter }),
    },
  });

describe('Retry-After no problema', () => {
  it('guarda os segundos pedidos pela API', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ocupado('5')));

    const erro = await falhaDe(() => requisitar('/x'));

    expect(erro.problema).toMatchObject({ code: 'SERVICO_OCUPADO', correlationId: 'corr-503', retryAfterSegundos: 5 });
  });

  it.each([[null], ['amanhã'], ['-3'], ['Wed, 21 Oct 2026 07:28:00 GMT']])('ignora valor ausente ou fora de segundos (%s)', async (valor) => {
    vi.stubGlobal('fetch', vi.fn(async () => ocupado(valor)));

    const erro = await falhaDe(() => requisitar('/x'));

    expect(erro.problema.retryAfterSegundos).toBeUndefined();
  });
});
