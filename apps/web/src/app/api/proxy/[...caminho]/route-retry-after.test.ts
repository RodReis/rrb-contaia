// @vitest-environment node
/**
 * O 503 da leitura de planilha (SPEC-015 §3.10) chega ao navegador com o `Retry-After` da API: é ele
 * que diz quando a tela volta a oferecer a nova tentativa.
 */
import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => ({ value: 'token-de-sessao' }) }),
}));

const { POST } = await import('./route');

afterEach(() => vi.unstubAllGlobals());

describe('proxy autenticado: serviço ocupado', () => {
  it('repassa o Retry-After do 503', async () => {
    process.env['API_ORIGIN'] = 'http://api.local';
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('{"code":"SERVICO_OCUPADO"}', {
            status: 503,
            headers: { 'content-type': 'application/problem+json', 'retry-after': '5' },
          }),
      ),
    );

    const resposta = await POST(
      new NextRequest('http://localhost:15100/api/proxy/empresas/e-1/plano-contas/planilhas/inspecao', {
        method: 'POST',
        body: 'x',
      }),
      { params: Promise.resolve({ caminho: ['empresas', 'e-1', 'plano-contas', 'planilhas', 'inspecao'] }) },
    );

    expect(resposta.status).toBe(503);
    expect(resposta.headers.get('retry-after')).toBe('5');
  });
});
