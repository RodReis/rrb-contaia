import { describe, expect, it, vi } from 'vitest';
import { caminhoDoSegredo, criarClienteDoVault, ErroDoVault, type EscopoDoSegredo } from './vault.js';

const ESCOPO: EscopoDoSegredo = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  empresaId: '22222222-2222-4222-8222-222222222222',
  referencia: '33333333-3333-4333-8333-333333333333',
};
const DADOS = { pkcs12Base64: 'QUJD', senha: 'sentinela-senha', impressaoDigital: 'AB12' };

type Chamada = { url: string; metodo: string; token: string | null; corpo: unknown };

const montar = (respostas: (Response | Error)[], token = 'token-1') => {
  const chamadas: Chamada[] = [];
  let arquivo = token;
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const cabecalhos = new Headers(init?.headers);
    chamadas.push({
      url: String(url),
      metodo: init?.method ?? 'GET',
      token: cabecalhos.get('x-vault-token'),
      corpo: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
    });
    const proxima = respostas.shift() ?? new Response('{}', { status: 200 });
    if (proxima instanceof Error) throw proxima;
    return proxima;
  }) as unknown as typeof fetch;

  const cliente = criarClienteDoVault({
    endereco: 'http://vault.local:8200',
    arquivoDoToken: '/tokens/cofre',
    fetchImpl,
    lerArquivo: async () => `${arquivo}\n`,
  });
  return { cliente, chamadas, trocarToken: (novo: string) => (arquivo = novo) };
};

const json = (corpo: unknown, status = 200): Response =>
  new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } });

describe('adaptador do Vault KV v2', () => {
  it('grava com cas:0, o token do arquivo e o caminho tenant/empresa/referência', async () => {
    const { cliente, chamadas } = montar([json({ data: { version: 1 } })]);

    await expect(cliente.gravar(ESCOPO, DADOS)).resolves.toBe(1);

    expect(chamadas).toEqual([
      {
        url: `http://vault.local:8200/v1/kv/data/certificados/${ESCOPO.tenantId}/${ESCOPO.empresaId}/${ESCOPO.referencia}`,
        metodo: 'POST',
        token: 'token-1',
        corpo: {
          data: { pkcs12_base64: 'QUJD', senha: 'sentinela-senha', impressao_digital: 'AB12' },
          options: { cas: 0 },
        },
      },
    ]);
  });

  it('lê o token do arquivo a cada uso (reemissão pelo bootstrap sem reiniciar)', async () => {
    const { cliente, chamadas, trocarToken } = montar([json({}), json({})]);

    await cliente.destruir(ESCOPO);
    trocarToken('token-2');
    await cliente.destruir(ESCOPO);

    expect(chamadas.map((c) => c.token)).toEqual(['token-1', 'token-2']);
  });

  it('inutilizar, restaurar e destruir usam as rotas delete/undelete/destroy da versão', async () => {
    const { cliente, chamadas } = montar([json({}), json({}), json({})]);

    await cliente.inutilizar(ESCOPO);
    await cliente.restaurar(ESCOPO);
    await cliente.destruir(ESCOPO, 3);

    const caminho = `certificados/${ESCOPO.tenantId}/${ESCOPO.empresaId}/${ESCOPO.referencia}`;
    expect(chamadas.map((c) => [c.metodo, c.url.replace('http://vault.local:8200/v1/', ''), c.corpo])).toEqual([
      ['POST', `kv/delete/${caminho}`, { versions: [1] }],
      ['POST', `kv/undelete/${caminho}`, { versions: [1] }],
      ['PUT', `kv/destroy/${caminho}`, { versions: [3] }],
    ]);
  });

  it('204 sem corpo é sucesso', async () => {
    const { cliente } = montar([new Response(null, { status: 204 })]);

    await expect(cliente.inutilizar(ESCOPO)).resolves.toBeUndefined();
  });

  it.each([
    [403, 'NEGADO'],
    [401, 'NEGADO'],
    [400, 'CONFLITO'],
    [503, 'INDISPONIVEL'],
    [500, 'INDISPONIVEL'],
    [429, 'INDISPONIVEL'],
    [404, 'INESPERADA'],
  ])('HTTP %i vira %s', async (status, tipo) => {
    const { cliente } = montar([json({ errors: ['segredo-no-corpo'] }, status)]);

    const erro = await cliente.gravar(ESCOPO, DADOS).catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(ErroDoVault);
    expect((erro as ErroDoVault).tipo).toBe(tipo);
    expect((erro as ErroDoVault).message).not.toContain('segredo-no-corpo');
  });

  it('falha de rede e arquivo de token ilegível viram INDISPONIVEL', async () => {
    const { cliente } = montar([new Error('ECONNREFUSED')]);
    await expect(cliente.gravar(ESCOPO, DADOS)).rejects.toMatchObject({ tipo: 'INDISPONIVEL' });

    const semArquivo = criarClienteDoVault({
      endereco: 'http://x',
      arquivoDoToken: '/nao/existe',
      fetchImpl: vi.fn() as unknown as typeof fetch,
      lerArquivo: async () => {
        throw new Error('ENOENT');
      },
    });
    await expect(semArquivo.gravar(ESCOPO, DADOS)).rejects.toMatchObject({ tipo: 'INDISPONIVEL' });
  });

  it('só aceita UUID nos ids do caminho (sem path traversal)', () => {
    expect(() => caminhoDoSegredo({ ...ESCOPO, referencia: '../../sys/seal' })).toThrow(ErroDoVault);
    expect(() => caminhoDoSegredo({ ...ESCOPO, tenantId: 'a/b' })).toThrow(ErroDoVault);
    expect(caminhoDoSegredo(ESCOPO)).toContain(ESCOPO.referencia);
  });

  it('pronto() só é verdadeiro com HTTP 200 do sys/health', async () => {
    expect(await montar([json({}, 200)]).cliente.pronto()).toBe(true);
    expect(await montar([json({}, 503)]).cliente.pronto()).toBe(false);
    expect(await montar([json({}, 501)]).cliente.pronto()).toBe(false);
    expect(await montar([new Error('down')]).cliente.pronto()).toBe(false);
  });

  it('não expõe nenhum método de leitura do segredo', () => {
    expect(Object.keys(montar([]).cliente).sort()).toEqual(['destruir', 'gravar', 'inutilizar', 'pronto', 'restaurar']);
  });
});
