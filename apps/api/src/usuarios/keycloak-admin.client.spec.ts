import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CODIGOS_DE_ERRO, ErroDeDominio } from '@contaia/domain';

import { KeycloakAdminClient } from './keycloak-admin.client';

type Chamada = Readonly<{ url: string; metodo: string; corpo: string | null }>;

// 204 não admite corpo no `Response` do runtime: `new Response('', { status: 204 })` lança.
const resposta = (status: number, corpo: unknown = '', cabecalhos: Record<string, string> = {}) =>
  new Response(
    status === 204 ? null : typeof corpo === 'string' ? corpo : JSON.stringify(corpo),
    { status, headers: cabecalhos },
  );

const ADMIN = 'http://kc.local/admin/realms/contaia';
const TOKEN_URL = 'http://kc.local/realms/contaia/protocol/openid-connect/token';

describe('KeycloakAdminClient', () => {
  const chamadas: Chamada[] = [];
  let respostas: Array<(chamada: Chamada) => Response | Promise<Response>>;
  let logs: string[];

  const instalarFetch = (): void => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const chamada: Chamada = {
          url,
          metodo: init?.method ?? 'GET',
          corpo: typeof init?.body === 'string' ? init.body : init?.body?.toString() ?? null,
        };

        chamadas.push(chamada);

        if (url === TOKEN_URL) {
          return resposta(200, { access_token: 'token-admin', expires_in: 300 });
        }

        const proxima = respostas.shift();

        if (proxima === undefined) {
          throw new Error(`chamada inesperada: ${chamada.metodo} ${url}`);
        }

        return proxima(chamada);
      }),
    );
  };

  beforeEach(() => {
    chamadas.length = 0;
    respostas = [];
    logs = [];
    process.env['KEYCLOAK_ISSUER_URL'] = 'http://kc.local/realms/contaia';
    process.env['KEYCLOAK_ADMIN_CLIENT_ID'] = 'contaia-api-admin';
    process.env['KEYCLOAK_ADMIN_CLIENT_SECRET'] = 'segredo-de-teste';

    for (const nivel of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
      vi.spyOn(Logger.prototype, nivel).mockImplementation((...argumentos: unknown[]) => {
        logs.push(argumentos.map(String).join(' '));
      });
    }

    instalarFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const codigoDe = async (executar: () => Promise<unknown>): Promise<string | undefined> => {
    try {
      await executar();
    } catch (erro) {
      return erro instanceof ErroDeDominio ? erro.codigo : 'OUTRO';
    }

    return undefined;
  };

  describe('endereço interno (API em contêiner)', () => {
    afterEach(() => {
      delete process.env['KEYCLOAK_INTERNAL_URL'];
    });

    it('com KEYCLOAK_INTERNAL_URL, token e Admin API vão ao endereço interno, não ao público', async () => {
      process.env['KEYCLOAK_INTERNAL_URL'] = 'http://keycloak:8080/realms/contaia';
      // O token (primeira chamada) também vai ao endereço interno: o dublê do `fetch` só reconhece o público.
      respostas.push(() => resposta(200, { access_token: 'token-admin', expires_in: 300 }));
      respostas.push(() => resposta(201, '', { location: 'http://keycloak:8080/admin/realms/contaia/users/sub-i' }));

      await new KeycloakAdminClient().criar({ email: 'a@b.com', nome: 'Ana Souza' });

      const urls = chamadas.map((chamada) => chamada.url);

      expect(urls.length).toBeGreaterThan(0);
      expect(urls.every((url) => url.startsWith('http://keycloak:8080/'))).toBe(true);
    });
  });

  describe('criar', () => {
    it('cria a identidade desabilitada e devolve o sub do cabeçalho Location', async () => {
      respostas.push(() => resposta(201, '', { location: `${ADMIN}/users/sub-novo-1` }));

      const sub = await new KeycloakAdminClient().criar({
        email: 'Ana.Souza@Escritorio.com',
        nome: 'Ana Maria Souza',
      });

      const criacao = chamadas.find((c) => c.metodo === 'POST' && c.url === `${ADMIN}/users`);
      const corpo = JSON.parse(criacao?.corpo ?? '{}') as Record<string, unknown>;

      expect(sub).toBe('sub-novo-1');
      expect(corpo).toMatchObject({
        username: 'ana.souza@escritorio.com',
        email: 'ana.souza@escritorio.com',
        firstName: 'Ana',
        lastName: 'Maria Souza',
        enabled: false,
        emailVerified: true,
      });
    });

    it('nome de uma palavra só ainda gera sobrenome (o perfil do Keycloak exige)', async () => {
      respostas.push(() => resposta(201, '', { location: `${ADMIN}/users/sub-2` }));

      await new KeycloakAdminClient().criar({ email: 'x@y.com', nome: 'Madonna' });

      const corpo = JSON.parse(
        chamadas.find((c) => c.url === `${ADMIN}/users`)?.corpo ?? '{}',
      ) as { firstName: string; lastName: string };

      expect(corpo.firstName).toBe('Madonna');
      expect(corpo.lastName.length).toBeGreaterThan(0);
    });

    it('409 do Keycloak vira EMAIL_JA_UTILIZADO sem revelar nada', async () => {
      respostas.push(() => resposta(409, { errorMessage: 'User exists with same email' }));

      expect(await codigoDe(() => new KeycloakAdminClient().criar({ email: 'a@b.com', nome: 'A B' }))).toBe(
        CODIGOS_DE_ERRO.EMAIL_JA_UTILIZADO,
      );
    });

    it('5xx vira IDENTIDADE_INDISPONIVEL', async () => {
      respostas.push(() => resposta(503));

      expect(await codigoDe(() => new KeycloakAdminClient().criar({ email: 'a@b.com', nome: 'A B' }))).toBe(
        CODIGOS_DE_ERRO.IDENTIDADE_INDISPONIVEL,
      );
    });

    it('falha de rede vira IDENTIDADE_INDISPONIVEL', async () => {
      respostas.push(() => {
        throw new TypeError('fetch failed');
      });

      expect(await codigoDe(() => new KeycloakAdminClient().criar({ email: 'a@b.com', nome: 'A B' }))).toBe(
        CODIGOS_DE_ERRO.IDENTIDADE_INDISPONIVEL,
      );
    });
  });

  describe('definirSenhaEAtivar', () => {
    it('redefine a senha definitiva e habilita a conta, nesta ordem', async () => {
      respostas.push(() => resposta(204), () => resposta(204));

      await new KeycloakAdminClient().definirSenhaEAtivar('sub-1', 'senha-bem-longa-123');

      const [senha, ativacao] = chamadas.filter((c) => c.url !== TOKEN_URL);

      expect(senha?.url).toBe(`${ADMIN}/users/sub-1/reset-password`);
      expect(JSON.parse(senha?.corpo ?? '{}')).toEqual({
        type: 'password',
        value: 'senha-bem-longa-123',
        temporary: false,
      });
      expect(ativacao?.url).toBe(`${ADMIN}/users/sub-1`);
      expect(JSON.parse(ativacao?.corpo ?? '{}')).toEqual({ enabled: true });
    });

    it('política de senha recusada (400) vira SENHA_FRACA e não habilita a conta', async () => {
      respostas.push(() =>
        resposta(400, { error: 'invalidPasswordMinLengthMessage' }),
      );

      expect(
        await codigoDe(() => new KeycloakAdminClient().definirSenhaEAtivar('sub-1', 'curta')),
      ).toBe(CODIGOS_DE_ERRO.SENHA_FRACA);
      expect(chamadas.filter((c) => c.metodo === 'PUT' && c.url === `${ADMIN}/users/sub-1`)).toHaveLength(0);
    });

    it('nunca registra a senha em log', async () => {
      respostas.push(() => resposta(500, 'erro interno'));

      await codigoDe(() =>
        new KeycloakAdminClient().definirSenhaEAtivar('sub-1', 'senha-secreta-nao-logar'),
      );

      expect(logs.join('\n')).not.toContain('senha-secreta-nao-logar');
    });
  });

  describe('demais operações', () => {
    it('habilitar(false) desabilita a conta', async () => {
      respostas.push(() => resposta(204));

      await new KeycloakAdminClient().habilitar('sub-1', false);

      const chamada = chamadas.find((c) => c.url === `${ADMIN}/users/sub-1`);

      expect(chamada?.metodo).toBe('PUT');
      expect(JSON.parse(chamada?.corpo ?? '{}')).toEqual({ enabled: false });
    });

    it('encerrarSessoes chama o logout do usuário', async () => {
      respostas.push(() => resposta(204));

      await new KeycloakAdminClient().encerrarSessoes('sub-1');

      expect(chamadas.some((c) => c.metodo === 'POST' && c.url === `${ADMIN}/users/sub-1/logout`)).toBe(
        true,
      );
    });

    it('atualizarEmail troca e-mail e username normalizados', async () => {
      respostas.push(() => resposta(204));

      await new KeycloakAdminClient().atualizarEmail('sub-1', 'Novo@Escritorio.com');

      const chamada = chamadas.find((c) => c.url === `${ADMIN}/users/sub-1`);

      expect(JSON.parse(chamada?.corpo ?? '{}')).toEqual({
        email: 'novo@escritorio.com',
        username: 'novo@escritorio.com',
      });
    });

    it('remover é idempotente: 404 não é erro', async () => {
      respostas.push(() => resposta(404));

      await expect(new KeycloakAdminClient().remover('sub-1')).resolves.toBeUndefined();
    });

    it('operação sobre usuário que o Keycloak não conhece é IDENTIDADE_INDISPONIVEL', async () => {
      respostas.push(() => resposta(404));

      expect(await codigoDe(() => new KeycloakAdminClient().habilitar('sub-1', true))).toBe(
        CODIGOS_DE_ERRO.IDENTIDADE_INDISPONIVEL,
      );
    });
  });

  describe('token de administração', () => {
    it('é reaproveitado entre chamadas enquanto vale', async () => {
      respostas.push(() => resposta(204), () => resposta(204));
      const cliente = new KeycloakAdminClient();

      await cliente.habilitar('sub-1', true);
      await cliente.habilitar('sub-2', true);

      expect(chamadas.filter((c) => c.url === TOKEN_URL)).toHaveLength(1);
    });

    it('sem segredo configurado a operação falha como indisponível, sem chamar o Keycloak', async () => {
      delete process.env['KEYCLOAK_ADMIN_CLIENT_SECRET'];

      expect(await codigoDe(() => new KeycloakAdminClient().habilitar('sub-1', true))).toBe(
        CODIGOS_DE_ERRO.IDENTIDADE_INDISPONIVEL,
      );
      expect(chamadas).toHaveLength(0);
    });

    it('401 em uma operação descarta o token: a chamada seguinte pede outro', async () => {
      respostas.push(() => resposta(401), () => resposta(204));
      const cliente = new KeycloakAdminClient();

      expect(await codigoDe(() => cliente.habilitar('sub-1', true))).toBe(
        CODIGOS_DE_ERRO.IDENTIDADE_INDISPONIVEL,
      );

      await cliente.habilitar('sub-1', true);

      expect(chamadas.filter((c) => c.url === TOKEN_URL)).toHaveLength(2);
    });

    it('falha ao obter o token vira IDENTIDADE_INDISPONIVEL', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => resposta(401, { error: 'unauthorized_client' })),
      );

      expect(await codigoDe(() => new KeycloakAdminClient().habilitar('sub-1', true))).toBe(
        CODIGOS_DE_ERRO.IDENTIDADE_INDISPONIVEL,
      );
    });
  });
});
