/**
 * Regras do bootstrap do Vault (infra/docker/vault/bootstrap.mjs) contra um Vault
 * FALSO em memória. Não prova o Vault de verdade — isso é a validação com contêiner —,
 * mas prova a lógica: idempotência, desselar depois de reinício, reemissão de token e
 * as políticas mínimas.
 */
import { describe, expect, it } from 'vitest';
import {
  criarBootstrap,
  decidirReemissao,
  ErroDeBootstrap,
  gerarPoliticaHcl,
  interpretarInit,
  lerInitJson,
  POLITICAS,
  TOKENS,
  vigiar,
} from '../../../infra/docker/vault/bootstrap.mjs';

type EstadoDoVault = {
  initialized: boolean;
  sealed: boolean;
  chave: string;
  root: string;
  montagens: Record<string, { type: string; options: { version: string } }>;
  casObrigatorio: boolean;
  auditoria: Record<string, unknown>;
  politicas: Record<string, string>;
  tokens: Map<string, string[]>;
  inits: number;
  criacoesDeToken: number;
  renovacoes: number;
  unseals: number;
};

const criarVaultFalso = () => {
  const estado: EstadoDoVault = {
    initialized: false,
    sealed: true,
    chave: '',
    root: '',
    montagens: {},
    casObrigatorio: false,
    auditoria: {},
    politicas: {},
    tokens: new Map(),
    inits: 0,
    criacoesDeToken: 0,
    renovacoes: 0,
    unseals: 0,
  };
  let contador = 0;

  const json = (corpo: unknown, status = 200): Response =>
    new Response(status === 204 ? null : JSON.stringify(corpo), { status });

  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const rota = String(url).replace(/^.*\/v1\//, '');
    const metodo = init?.method ?? 'GET';
    const token = new Headers(init?.headers).get('x-vault-token');
    const corpo = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;

    if (rota === 'sys/seal-status') return json({ initialized: estado.initialized, sealed: estado.sealed });
    if (rota === 'sys/init' && metodo === 'PUT') {
      if (estado.initialized) return json({ errors: ['already initialized'] }, 400);
      estado.initialized = true;
      estado.inits++;
      estado.chave = `chave-unseal-${++contador}`;
      estado.root = `root-${contador}`;
      return json({ keys_base64: [estado.chave], root_token: estado.root });
    }
    if (rota === 'sys/unseal') {
      if (corpo.key !== estado.chave) return json({ errors: ['invalid key'] }, 400);
      estado.sealed = false;
      estado.unseals++;
      return json({ sealed: false });
    }
    if (estado.sealed) return json({ errors: ['Vault is sealed'] }, 503);
    if (rota.startsWith('sys/health')) return json({ sealed: false });

    if (rota === 'auth/token/lookup-self') {
      const politicas = token ? estado.tokens.get(token) : undefined;
      return politicas ? json({ data: { policies: ['default', ...politicas] } }) : json({ errors: ['denied'] }, 403);
    }
    if (rota === 'auth/token/renew-self') {
      estado.renovacoes++;
      return token && estado.tokens.has(token) ? json({}) : json({ errors: ['denied'] }, 403);
    }

    if (token !== estado.root) return json({ errors: ['permission denied'] }, 403);
    if (rota === 'sys/mounts' && metodo === 'GET') return json({ data: estado.montagens });
    if (rota === 'sys/mounts/kv') {
      estado.montagens['kv/'] = corpo;
      return json({}, 204);
    }
    if (rota === 'kv/config') {
      if (metodo === 'POST') estado.casObrigatorio = corpo.cas_required === true;
      return metodo === 'GET' ? json({ data: { cas_required: estado.casObrigatorio } }) : json({}, 204);
    }
    if (rota === 'sys/audit' && metodo === 'GET') return json({ data: estado.auditoria });
    if (rota === 'sys/audit/file') {
      estado.auditoria['file/'] = corpo;
      return json({}, 204);
    }
    if (rota.startsWith('sys/policies/acl/')) {
      estado.politicas[rota.replace('sys/policies/acl/', '')] = corpo.policy;
      return json({}, 204);
    }
    if (rota === 'auth/token/create') {
      estado.criacoesDeToken++;
      const novo = `s.token-${++contador}`;
      estado.tokens.set(novo, corpo.policies);
      return json({ auth: { client_token: novo } });
    }
    return json({ errors: ['unsupported'] }, 404);
  }) as typeof fetch;

  return { estado, fetchImpl };
};

const criarArquivosEmMemoria = () => {
  const arquivos = new Map<string, string>();
  return {
    arquivos,
    api: {
      ler: async (caminho: string) => arquivos.get(caminho.replaceAll('\\', '/')) ?? null,
      gravarSecreto: async (caminho: string, texto: string) => void arquivos.set(caminho.replaceAll('\\', '/'), texto),
    },
  };
};

const montar = () => {
  const vault = criarVaultFalso();
  const memoria = criarArquivosEmMemoria();
  const logs: string[] = [];
  const bootstrap = criarBootstrap({
    addr: 'http://vault.local:8200',
    dir: '/local',
    fetchImpl: vault.fetchImpl,
    arquivos: memoria.api,
    esperar: async () => {},
    log: (m: string) => logs.push(m),
    tentativas: 3,
  });
  return { ...vault, ...memoria, logs, bootstrap };
};

describe('bootstrap do Vault — primeira execução', () => {
  it('inicializa, desseleia, habilita KV v2 e auditoria, grava as políticas e emite os três tokens', async () => {
    const { estado, arquivos, bootstrap } = montar();

    const resultado = await bootstrap.garantir();

    expect(resultado).toEqual({
      inicializadoAgora: true,
      tokensReemitidos: ['token-cofre-ingestao', 'token-signer-leitura', 'token-api-principal'],
    });
    expect(estado.sealed).toBe(false);
    expect(estado.montagens['kv/']).toEqual({ type: 'kv', options: { version: '2' } });
    expect(estado.auditoria['file/']).toMatchObject({ type: 'file', options: { file_path: '/vault/logs/audit.log' } });
    expect(Object.keys(estado.politicas).sort()).toEqual(['api-principal', 'cofre-ingestao', 'signer-leitura']);
    expect(JSON.parse(arquivos.get('/local/init.json')!)).toEqual({
      chave_unseal_base64: estado.chave,
      root_token: estado.root,
    });
    for (const { arquivo, politica } of TOKENS) {
      const token = arquivos.get(`/local/${arquivo}`)!.trim();
      expect(estado.tokens.get(token)).toEqual([politica]);
    }
  });

  it('shares=1/threshold=1 e tokens periódicos órfãos', async () => {
    const chamadas: { rota: string; corpo: unknown }[] = [];
    const vault = criarVaultFalso();
    const espiao = (async (url: string | URL | Request, init?: RequestInit) => {
      if (typeof init?.body === 'string') chamadas.push({ rota: String(url), corpo: JSON.parse(init.body) });
      return vault.fetchImpl(url, init);
    }) as typeof fetch;
    const memoria = criarArquivosEmMemoria();

    await criarBootstrap({ addr: 'http://v', dir: '/l', fetchImpl: espiao, arquivos: memoria.api, esperar: async () => {}, tentativas: 2 }).garantir();

    expect(chamadas.find((c) => c.rota.endsWith('sys/init'))?.corpo).toEqual({ secret_shares: 1, secret_threshold: 1 });
    const criacao = chamadas.find((c) => c.rota.endsWith('auth/token/create'))?.corpo as Record<string, unknown>;
    expect(criacao).toMatchObject({ period: '768h', renewable: true, no_parent: true });
  });

  it('o log nunca contém chave de unseal, root token nem tokens técnicos', async () => {
    const { estado, arquivos, logs, bootstrap } = montar();

    await bootstrap.garantir();

    const tudo = logs.join('\n');
    const segredos = [estado.chave, estado.root, ...[...estado.tokens.keys()], ...[...arquivos.values()].map((v) => v.trim())];
    for (const segredo of segredos.filter((s) => s.length > 8 && !s.startsWith('{'))) {
      expect(tudo).not.toContain(segredo);
    }
  });
});

describe('bootstrap do Vault — cas_required', () => {
  it('liga cas_required no KV na primeira execução e não reescreve na segunda', async () => {
    const { estado, bootstrap } = montar();

    await bootstrap.garantir();
    expect(estado.casObrigatorio).toBe(true);

    estado.casObrigatorio = true;
    await bootstrap.garantir();
    expect(estado.casObrigatorio).toBe(true);
  });

  it('religa se alguém desligou', async () => {
    const { estado, bootstrap } = montar();
    await bootstrap.garantir();
    estado.casObrigatorio = false;

    await bootstrap.garantir();

    expect(estado.casObrigatorio).toBe(true);
  });
});

describe('bootstrap do Vault — idempotência', () => {
  it('segunda execução não reinicializa, não reemite tokens e mantém os arquivos', async () => {
    const { estado, arquivos, bootstrap } = montar();
    await bootstrap.garantir();
    const antes = new Map(arquivos);

    const resultado = await bootstrap.garantir();

    expect(resultado).toEqual({ inicializadoAgora: false, tokensReemitidos: [] });
    expect(estado.inits).toBe(1);
    expect(estado.criacoesDeToken).toBe(3);
    expect(arquivos).toEqual(antes);
  });

  it('depois de um reinício (selado) desseleia com a chave do init.json e preserva os tokens', async () => {
    const { estado, arquivos, bootstrap } = montar();
    await bootstrap.garantir();
    const tokensAntes = TOKENS.map(({ arquivo }) => arquivos.get(`/local/${arquivo}`));
    estado.sealed = true;

    const resultado = await bootstrap.garantir();

    expect(resultado.tokensReemitidos).toEqual([]);
    expect(estado.sealed).toBe(false);
    expect(estado.unseals).toBe(2);
    expect(TOKENS.map(({ arquivo }) => arquivos.get(`/local/${arquivo}`))).toEqual(tokensAntes);
  });

  it('reemite só o token que o Vault recusa', async () => {
    const { estado, arquivos, bootstrap } = montar();
    await bootstrap.garantir();
    const revogado = arquivos.get('/local/token-signer-leitura')!.trim();
    estado.tokens.delete(revogado);

    const resultado = await bootstrap.garantir();

    expect(resultado.tokensReemitidos).toEqual(['token-signer-leitura']);
    expect(arquivos.get('/local/token-signer-leitura')!.trim()).not.toBe(revogado);
  });

  it('reemite token cuja política diverge da esperada (ex.: ganhou política a mais)', async () => {
    const { estado, arquivos, bootstrap } = montar();
    await bootstrap.garantir();
    const token = arquivos.get('/local/token-cofre-ingestao')!.trim();
    estado.tokens.set(token, ['cofre-ingestao', 'signer-leitura']);

    const resultado = await bootstrap.garantir();

    expect(resultado.tokensReemitidos).toEqual(['token-cofre-ingestao']);
  });

  it('arquivo de token ausente é emitido de novo', async () => {
    const { arquivos, bootstrap } = montar();
    await bootstrap.garantir();
    arquivos.delete('/local/token-api-principal');

    expect((await bootstrap.garantir()).tokensReemitidos).toEqual(['token-api-principal']);
  });
});

describe('bootstrap do Vault — falhas explícitas', () => {
  it('Vault inicializado sem init.json: erro claro, sem tentar adivinhar', async () => {
    const { arquivos, bootstrap } = montar();
    await bootstrap.garantir();
    arquivos.delete('/local/init.json');

    await expect(bootstrap.garantir()).rejects.toThrow(/init\.json não existe/);
  });

  it('kv/ que não é KV v2 aborta', async () => {
    const { estado, bootstrap } = montar();
    await bootstrap.garantir();
    estado.montagens['kv/'] = { type: 'kv', options: { version: '1' } };

    await expect(bootstrap.garantir()).rejects.toBeInstanceOf(ErroDeBootstrap);
  });

  it('Vault que nunca responde esgota as tentativas', async () => {
    const memoria = criarArquivosEmMemoria();
    const bootstrap = criarBootstrap({
      addr: 'http://v',
      dir: '/l',
      fetchImpl: (async () => {
        throw new Error('ECONNREFUSED');
      }) as typeof fetch,
      arquivos: memoria.api,
      esperar: async () => {},
      tentativas: 2,
    });

    await expect(bootstrap.garantir()).rejects.toThrow(/não respondeu/);
  });
});

describe('vigia', () => {
  it('desseleia sozinha depois de o Vault reiniciar e renova os tokens no intervalo', async () => {
    const { estado, bootstrap, logs } = montar();
    await bootstrap.garantir();
    estado.sealed = true;

    let ciclos = 0;
    let relogio = 0;
    await vigiar(bootstrap, {
      log: (m: string) => logs.push(m),
      esperar: async () => {
        ciclos++;
        relogio += 7 * 60 * 60 * 1000; // passa o intervalo de renovação a cada ciclo
      },
      deveParar: () => ciclos >= 2,
      agora: () => relogio,
    });

    expect(estado.sealed).toBe(false);
    expect(estado.renovacoes).toBeGreaterThanOrEqual(3);
  });

  it('erro num ciclo não derruba a vigia', async () => {
    const memoria = criarArquivosEmMemoria();
    const bootstrap = criarBootstrap({
      addr: 'http://v',
      dir: '/l',
      fetchImpl: (async () => {
        throw new Error('down');
      }) as typeof fetch,
      arquivos: memoria.api,
      esperar: async () => {},
      tentativas: 1,
    });
    const logs: string[] = [];
    let ciclos = 0;

    await vigiar(bootstrap, { log: (m: string) => logs.push(m), esperar: async () => void ciclos++, deveParar: () => ciclos >= 2 });

    expect(logs.filter((l) => l.startsWith('vigia:'))).toHaveLength(2);
  });
});

describe('políticas mínimas', () => {
  const capacidades = (politica: keyof typeof POLITICAS): string[] =>
    (POLITICAS[politica] as { capacidades: string[] }[]).flatMap((r) => r.capacidades);

  it('cofre-ingestao é write-only: sem read, list, delete, sudo ou metadata', () => {
    const regras = POLITICAS['cofre-ingestao'] as { caminho: string; capacidades: string[] }[];

    expect(capacidades('cofre-ingestao').sort()).toEqual(['create', 'update', 'update', 'update']);
    expect(regras.every((r) => r.caminho.startsWith('kv/') && r.caminho.endsWith('/certificados/*'))).toBe(true);
    expect(regras.some((r) => r.caminho.includes('metadata'))).toBe(false);
    for (const proibida of ['read', 'list', 'delete', 'sudo']) {
      expect(capacidades('cofre-ingestao')).not.toContain(proibida);
    }
  });

  it('cofre-ingestao só CRIA em kv/data: sem update, não sobrescreve uma referência existente', () => {
    const regras = POLITICAS['cofre-ingestao'] as { caminho: string; capacidades: string[] }[];
    const dados = regras.find((r) => r.caminho === 'kv/data/certificados/*');

    expect(dados?.capacidades).toEqual(['create']);
  });

  it('signer-leitura só lê o dado: sem list, metadata ou escrita', () => {
    expect(POLITICAS['signer-leitura']).toEqual([{ caminho: 'kv/data/certificados/*', capacidades: ['read'] }]);
  });

  it('api-principal não tem nenhuma capacidade em kv/', () => {
    const regras = POLITICAS['api-principal'] as { caminho: string }[];

    expect(regras.some((r) => r.caminho.startsWith('kv/'))).toBe(false);
  });

  it('só signer-leitura tem read em kv/', () => {
    for (const [nome, regras] of Object.entries(POLITICAS) as [string, { caminho: string; capacidades: string[] }[]][]) {
      const leKv = regras.some((r) => r.caminho.startsWith('kv/') && r.capacidades.includes('read'));
      expect(leKv, nome).toBe(nome === 'signer-leitura');
    }
  });

  it('gera HCL por regra', () => {
    expect(gerarPoliticaHcl([{ caminho: 'a/*', capacidades: ['read', 'list'] }])).toBe(
      'path "a/*" {\n  capabilities = ["read", "list"]\n}\n',
    );
  });
});

describe('funções puras', () => {
  it('decidirReemissao: 200 com a política certa mantém; o resto reemite', () => {
    const ok = { status: 200, corpo: { data: { policies: ['default', 'cofre-ingestao'] } } };

    expect(decidirReemissao(ok, 'cofre-ingestao')).toBe(false);
    expect(decidirReemissao(ok, 'signer-leitura')).toBe(true);
    expect(decidirReemissao({ status: 403, corpo: null }, 'cofre-ingestao')).toBe(true);
    expect(decidirReemissao({ status: 200, corpo: { data: { policies: ['default'] } } }, 'cofre-ingestao')).toBe(true);
    expect(decidirReemissao({ status: 200, corpo: null }, 'cofre-ingestao')).toBe(true);
  });

  it('interpretarInit e lerInitJson recusam resposta incompleta', () => {
    expect(interpretarInit({ keys_base64: ['k'], root_token: 'r' })).toEqual({ chave_unseal_base64: 'k', root_token: 'r' });
    expect(() => interpretarInit({})).toThrow(ErroDeBootstrap);
    expect(() => interpretarInit({ keys_base64: [], root_token: 'r' })).toThrow(ErroDeBootstrap);
    expect(() => lerInitJson('{"root_token":"r"}')).toThrow(ErroDeBootstrap);
    expect(lerInitJson('{"chave_unseal_base64":"k","root_token":"r"}').root_token).toBe('r');
  });
});
