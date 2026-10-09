/**
 * Falha de rede no cliente HTTP (FRONTEND.md §14): o `correlationId` que a ação enviou não se perde.
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

describe('requisitar sem resposta do servidor', () => {
  it('preserva o x-correlation-id enviado pela ação', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));

    const erro = await falhaDe(() => requisitar('/empresas', { headers: { 'x-correlation-id': 'corr-acao-123' } }));

    expect(erro.problema).toMatchObject({ code: 'FALHA_DE_REDE', correlationId: 'corr-acao-123' });
  });

  it('sem id enviado, continua "sem-correlacao"', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));

    const erro = await falhaDe(() => requisitar('/empresas'));

    expect(erro.problema.correlationId).toBe('sem-correlacao');
  });

  it('resposta de erro sem problem+json nem cabeçalho de correlação usa o id enviado', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>502</html>', { status: 502 })));

    const erro = await falhaDe(() => requisitar('/empresas', { headers: { 'x-correlation-id': 'corr-acao-456' } }));

    expect(erro.problema).toMatchObject({ code: 'ERRO_DESCONHECIDO', status: 502, correlationId: 'corr-acao-456' });
  });
});
