import { describe, expect, it } from 'vitest';

import { ErroDoVault, caminhoDoSegredo, criarLeitorDoVault } from './vault.js';

const TENANT = '0198f3c2-0000-7000-8000-000000000001';
const EMPRESA = '0198f3c2-0000-7000-8000-000000000002';
const REFERENCIA = '0198f3c2-0000-7000-8000-000000000003';
const ESCOPO = { tenantId: TENANT, empresaId: EMPRESA, referencia: REFERENCIA } as const;

const SENTINELA = 'SENHA-SENTINELA-NAO-PODE-VAZAR';
const PKCS12 = Buffer.from('conteudo-pkcs12-de-teste');

type Chamada = { url: string; metodo: string; token: string | null };

const montar = (
  responder: (chamada: Chamada) => Response,
  token = 'token-do-signer\n',
): { leitor: ReturnType<typeof criarLeitorDoVault>; chamadas: Chamada[] } => {
  const chamadas: Chamada[] = [];
  const leitor = criarLeitorDoVault({
    endereco: 'http://vault:8200',
    arquivoDoToken: '/run/secrets/token',
    lerArquivo: async () => token,
    fetchImpl: async (entrada, init) => {
      const chamada: Chamada = {
        url: String(entrada),
        metodo: init?.method ?? 'GET',
        token: new Headers(init?.headers).get('x-vault-token'),
      };
      chamadas.push(chamada);
      return responder(chamada);
    },
  });

  return { leitor, chamadas };
};

const corpoDoSegredo = (): Response =>
  Response.json({
    data: {
      data: { pkcs12_base64: PKCS12.toString('base64'), senha: SENTINELA, impressao_digital: 'a'.repeat(64) },
      metadata: { version: 1 },
    },
  });

describe('leitura estreita do Vault (SPEC-012 §3.4)', () => {
  it('lê só o caminho exato do segredo, por GET, sem list nem metadata', async () => {
    const { leitor, chamadas } = montar(corpoDoSegredo);

    await leitor.ler(ESCOPO);

    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]).toEqual({
      url: `http://vault:8200/v1/kv/data/certificados/${TENANT}/${EMPRESA}/${REFERENCIA}`,
      metodo: 'GET',
      token: 'token-do-signer',
    });
    expect(chamadas[0]?.url).not.toMatch(/list|metadata/iu);
  });

  it('devolve o PKCS#12 como bytes e a senha, só em memória', async () => {
    const { leitor } = montar(corpoDoSegredo);

    const segredo = await leitor.ler(ESCOPO);

    expect(Buffer.isBuffer(segredo.pkcs12)).toBe(true);
    expect(segredo.pkcs12.equals(PKCS12)).toBe(true);
    expect(segredo.senha).toBe(SENTINELA);
    expect(segredo.impressaoDigital).toBe('a'.repeat(64));
  });

  it('lê o token do arquivo a cada uso (o bootstrap pode reemiti-lo)', async () => {
    let atual = 'primeiro';
    const tokens: (string | null)[] = [];
    const leitor = criarLeitorDoVault({
      endereco: 'http://vault:8200',
      arquivoDoToken: '/x',
      lerArquivo: async () => atual,
      fetchImpl: async (_entrada, init) => {
        tokens.push(new Headers(init?.headers).get('x-vault-token'));
        return corpoDoSegredo();
      },
    });

    await leitor.ler(ESCOPO);
    atual = 'segundo';
    await leitor.ler(ESCOPO);

    expect(tokens).toEqual(['primeiro', 'segundo']);
  });

  it('versão desativada (soft delete da F11) vira NAO_ENCONTRADO', async () => {
    const { leitor } = montar(() => new Response(null, { status: 404 }));

    await expect(leitor.ler(ESCOPO)).rejects.toMatchObject({ tipo: 'NAO_ENCONTRADO' });
  });

  it.each([
    [403, 'NEGADO'],
    [401, 'NEGADO'],
    [500, 'INDISPONIVEL'],
    [503, 'INDISPONIVEL'],
    [429, 'INDISPONIVEL'],
  ])('HTTP %i vira %s, sem fallback inseguro', async (status, tipo) => {
    const { leitor } = montar(() => new Response(JSON.stringify({ errors: [SENTINELA] }), { status }));

    await expect(leitor.ler(ESCOPO)).rejects.toMatchObject({ tipo });
  });

  it('falha de rede e arquivo de token ausente viram INDISPONIVEL', async () => {
    const semRede = criarLeitorDoVault({
      endereco: 'http://vault:8200',
      arquivoDoToken: '/x',
      lerArquivo: async () => 't',
      fetchImpl: async () => {
        throw new Error('ECONNREFUSED');
      },
    });
    const semToken = criarLeitorDoVault({
      endereco: 'http://vault:8200',
      arquivoDoToken: '/x',
      lerArquivo: async () => {
        throw new Error('ENOENT');
      },
      fetchImpl: async () => corpoDoSegredo(),
    });

    await expect(semRede.ler(ESCOPO)).rejects.toMatchObject({ tipo: 'INDISPONIVEL' });
    await expect(semToken.ler(ESCOPO)).rejects.toMatchObject({ tipo: 'INDISPONIVEL' });
  });

  it('resposta malformada é INESPERADA e nunca ecoa o corpo', async () => {
    const { leitor } = montar(() => Response.json({ data: { data: { senha: SENTINELA } } }));

    const erro = await leitor.ler(ESCOPO).catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(ErroDoVault);
    expect((erro as ErroDoVault).tipo).toBe('INESPERADA');
    expect(String((erro as Error).message)).not.toContain(SENTINELA);
  });

  it('só UUID entra no caminho: nada de path traversal', () => {
    expect(() => caminhoDoSegredo({ ...ESCOPO, referencia: '../../sys/seal' })).toThrow(ErroDoVault);
    expect(() => caminhoDoSegredo({ ...ESCOPO, tenantId: `${TENANT}/..` })).toThrow(ErroDoVault);
    expect(caminhoDoSegredo(ESCOPO)).toBe(`certificados/${TENANT}/${EMPRESA}/${REFERENCIA}`);
  });

  it('pronto() reflete o /sys/health do Vault', async () => {
    const ok = montar(() => new Response(null, { status: 200 }));
    const selado = montar(() => new Response(null, { status: 503 }));

    await expect(ok.leitor.pronto()).resolves.toBe(true);
    await expect(selado.leitor.pronto()).resolves.toBe(false);
  });
});
