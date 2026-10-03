// @vitest-environment node
/**
 * A rota pública é a única que fala com a API sem sessão: o que se prova aqui é
 * o quanto ela é estreita. Só o convite passa; nada de sessão, cookie ou
 * credencial do navegador atravessa; e o cliente real chega à API para o limite
 * de tentativas valer por pessoa, não pelo servidor da web.
 */
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GET, POST } from './route';

const TOKEN = 'a'.repeat(43);

const contexto = (...caminho: string[]) => ({ params: Promise.resolve({ caminho }) });

const requisicao = (url: string, init?: ConstructorParameters<typeof NextRequest>[1]) =>
  new NextRequest(`http://localhost:15100${url}`, init);

const corpoDe = async (resposta: Response): Promise<Record<string, unknown>> =>
  (await resposta.json()) as Record<string, unknown>;

describe('rota pública do convite', () => {
  beforeEach(() => {
    process.env['API_ORIGIN'] = 'http://api.local';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ nome: 'Ana' }), { status: 200, headers: { 'content-type': 'application/json' } })),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it('GET convites/<token> consulta a API sem credencial alguma', async () => {
    const resposta = await GET(
      requisicao(`/api/publico/convites/${TOKEN}`, {
        headers: { cookie: 'contaia_sessao=segredo', authorization: 'Bearer segredo' },
      }),
      contexto('convites', TOKEN),
    );

    const [url, init] = vi.mocked(fetch).mock.calls[0] as unknown as [string, RequestInit];
    const cabecalhos = new Headers(init.headers);

    expect(resposta.status).toBe(200);
    expect(url).toBe(`http://api.local/convites/${TOKEN}`);
    expect(cabecalhos.get('authorization')).toBeNull();
    expect(cabecalhos.get('cookie')).toBeNull();
  });

  it('POST convites/aceitar repassa o corpo e o tipo do conteúdo', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 204 }));

    const resposta = await POST(
      requisicao('/api/publico/convites/aceitar', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: TOKEN, senha: 'senha-longa-123' }),
      }),
      contexto('convites', 'aceitar'),
    );

    const [url, init] = vi.mocked(fetch).mock.calls[0] as unknown as [string, RequestInit];

    expect(resposta.status).toBe(204);
    expect(url).toBe('http://api.local/convites/aceitar');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
    expect(Buffer.from(init.body as ArrayBuffer).toString()).toContain('senha-longa-123');
  });

  it('repassa o cliente que o último salto escreveu em X-Forwarded-For, não o início da lista', async () => {
    await GET(
      requisicao(`/api/publico/convites/${TOKEN}`, {
        headers: { 'x-forwarded-for': 'inventado-pelo-cliente, 203.0.113.7' },
      }),
      contexto('convites', TOKEN),
    );

    const [, init] = vi.mocked(fetch).mock.calls[0] as unknown as [string, RequestInit];

    expect(new Headers(init.headers).get('x-forwarded-for')).toBe('203.0.113.7');
  });

  it('corpo maior que o teto é 413 e a API nem é chamada', async () => {
    const resposta = await POST(
      requisicao('/api/publico/convites/aceitar', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: TOKEN, senha: 'x'.repeat(20_000) }),
      }),
      contexto('convites', 'aceitar'),
    );

    expect(resposta.status).toBe(413);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    [['usuarios']],
    [['usuarios', 'eu']],
    [['empresas', 'x']],
    [['health']],
    [['convites']],
    [['convites', 'a', 'b']],
    [['convites', '..']],
    [['convites', 'a%2F..%2Fusuarios']],
    [['convites', 'x'.repeat(65)]],
    [[]],
  ])('%j não é do convite: 404 e a API nem é chamada', async (caminho) => {
    const resposta = await GET(requisicao('/api/publico/x'), contexto(...caminho));

    expect(resposta.status).toBe(404);
    expect((await corpoDe(resposta))['code']).toBe('HTTP_404');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('só POST em convites/aceitar e só GET em convites/<token>', async () => {
    const postNoToken = await POST(
      requisicao(`/api/publico/convites/${TOKEN}`, { method: 'POST', body: '{}' }),
      contexto('convites', TOKEN),
    );

    expect(postNoToken.status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('API fora do ar vira problema 502 com código de rede', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('fetch failed'));

    const resposta = await GET(
      requisicao(`/api/publico/convites/${TOKEN}`),
      contexto('convites', TOKEN),
    );

    expect(resposta.status).toBe(502);
    expect((await corpoDe(resposta))['code']).toBe('FALHA_DE_REDE');
  });

  it('devolve o problema da API como veio, para a tela mapear o código', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ code: 'CONVITE_INVALIDO', status: 404 }), {
        status: 404,
        headers: { 'content-type': 'application/problem+json' },
      }),
    );

    const resposta = await GET(
      requisicao(`/api/publico/convites/${TOKEN}`),
      contexto('convites', TOKEN),
    );

    expect(resposta.status).toBe(404);
    expect(resposta.headers.get('content-type')).toBe('application/problem+json');
    expect((await corpoDe(resposta))['code']).toBe('CONVITE_INVALIDO');
  });
});
