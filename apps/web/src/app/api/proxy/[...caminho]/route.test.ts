// @vitest-environment node
/**
 * Proxy autenticado: o `correlationId` gerado pela tela para uma ação chega à API (SPEC-013 §10),
 * e o nome do arquivo baixado volta ao navegador. Nada além disso muda no repasse.
 */
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => ({ value: 'token-de-sessao' }) }),
}));

const { GET } = await import('./route');

const contexto = (...caminho: string[]) => ({ params: Promise.resolve({ caminho }) });

const requisicao = (url: string, init?: ConstructorParameters<typeof NextRequest>[1]) =>
  new NextRequest(`http://localhost:15100${url}`, init);

const cabecalhosEnviados = (): Headers => {
  const chamada = vi.mocked(fetch).mock.calls[0];

  return new Headers(chamada?.[1]?.headers);
};

describe('proxy autenticado', () => {
  beforeEach(() => {
    process.env['API_ORIGIN'] = 'http://api.local';
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('linha;codigo\r\n', {
            status: 200,
            headers: {
              'content-type': 'text/csv; charset=utf-8',
              'content-disposition': 'attachment; filename="relatorio-plano.csv"',
              'x-correlation-id': 'corr-da-api-123',
              'x-content-type-options': 'nosniff',
              'cache-control': 'no-store',
              'set-cookie': 'segredo=1',
            },
          }),
      ),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it('repassa o x-correlation-id válido da tela para a API', async () => {
    await GET(
      requisicao('/api/proxy/empresas/e-1/plano-contas/importacoes', {
        headers: { 'x-correlation-id': '0b7c1f3e-8a2d-4c55-9f0e-1d2c3b4a5f60' },
      }),
      contexto('empresas', 'e-1', 'plano-contas', 'importacoes'),
    );

    expect(cabecalhosEnviados().get('x-correlation-id')).toBe('0b7c1f3e-8a2d-4c55-9f0e-1d2c3b4a5f60');
    expect(cabecalhosEnviados().get('authorization')).toBe('Bearer token-de-sessao');
  });

  it('descarta x-correlation-id fora do formato aceito pela API', async () => {
    await GET(
      requisicao('/api/proxy/empresas/e-1/plano-contas/importacoes', {
        headers: { 'x-correlation-id': 'curto' },
      }),
      contexto('empresas', 'e-1', 'plano-contas', 'importacoes'),
    );

    expect(cabecalhosEnviados().get('x-correlation-id')).toBeNull();
  });

  it('devolve o nome do anexo e o id de correlação da resposta', async () => {
    const resposta = await GET(
      requisicao('/api/proxy/empresas/e-1/plano-contas/importacoes/t-1/relatorio'),
      contexto('empresas', 'e-1', 'plano-contas', 'importacoes', 't-1', 'relatorio'),
    );

    expect(resposta.headers.get('content-disposition')).toBe('attachment; filename="relatorio-plano.csv"');
    expect(resposta.headers.get('x-correlation-id')).toBe('corr-da-api-123');
    expect(resposta.headers.get('content-type')).toBe('text/csv; charset=utf-8');
  });

  it('preserva nosniff e cache-control do relatório e nada fora da lista', async () => {
    const resposta = await GET(
      requisicao('/api/proxy/empresas/e-1/plano-contas/importacoes/t-1/relatorio'),
      contexto('empresas', 'e-1', 'plano-contas', 'importacoes', 't-1', 'relatorio'),
    );

    expect(resposta.headers.get('x-content-type-options')).toBe('nosniff');
    expect(resposta.headers.get('cache-control')).toBe('no-store');
    expect(resposta.headers.get('set-cookie')).toBeNull();
  });
});
