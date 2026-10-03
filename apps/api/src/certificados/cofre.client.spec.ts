/**
 * Cliente do cofre: só inutiliza/restaura, com Bearer de serviço; indisponibilidade é erro estável
 * e nenhum corpo de resposta, token ou URL vaza para mensagem de erro.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CODIGOS_DE_ERRO, ErroDeDominio } from '@contaia/domain';

import { CofreClient } from './cofre.client';

const TOKEN = 'k'.repeat(48);
const TOKEN_DE_SERVICO = 's'.repeat(48);
const REFERENCIA = '01927b5c-8e1a-7c3d-9a1b-0123456789ab';
const ESCOPO = { tenantId: 'tenant-1', empresaId: 'empresa-1' };
const ambiente = { ...process.env };

const falhaCom = async (acao: () => Promise<unknown>): Promise<ErroDeDominio> => {
  try {
    await acao();
  } catch (erro) {
    if (erro instanceof ErroDeDominio) {
      return erro;
    }
    throw erro;
  }

  throw new Error('esperava erro de domínio');
};

beforeEach(() => {
  process.env['COFRE_URL'] = 'http://cofre.local:15104/';
  process.env['COFRE_ADMIN_TOKEN'] = TOKEN;
  process.env['COFRE_SERVICE_TOKEN'] = TOKEN_DE_SERVICO;
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env['COFRE_URL'] = ambiente['COFRE_URL'];
  process.env['COFRE_SERVICE_TOKEN'] = ambiente['COFRE_SERVICE_TOKEN'];
  process.env['COFRE_ADMIN_TOKEN'] = ambiente['COFRE_ADMIN_TOKEN'];
});

describe('CofreClient', () => {
  it('inutilizar chama o cofre com Bearer, correlationId e só o escopo no corpo', async () => {
    const fetchFalso = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchFalso);

    await new CofreClient().inutilizar(REFERENCIA, ESCOPO, 'corr-1');

    const chamada = (fetchFalso.mock.calls[0] as unknown as [string, RequestInit]) ?? [];
    expect(chamada[0]).toBe(`http://cofre.local:15104/segredos/${REFERENCIA}/inutilizar`);
    // O Bearer é o ADMIN; o de serviço (cofre → API) nunca sai nesta direção.
    expect(JSON.stringify(chamada[1])).not.toContain(TOKEN_DE_SERVICO);
    expect(chamada[1]).toMatchObject({
      method: 'POST',
      headers: {
        authorization: `Bearer ${TOKEN}`,
        'x-correlation-id': 'corr-1',
        'content-type': 'application/json',
      },
      body: JSON.stringify(ESCOPO),
    });
  });

  it('restaurar usa a rota irmã', async () => {
    const fetchFalso = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchFalso);

    await new CofreClient().restaurar(REFERENCIA, ESCOPO, 'corr-2');

    expect((fetchFalso.mock.calls[0] as unknown as [string])[0]).toMatch(/\/restaurar$/u);
  });

  it('status de erro vira COFRE_INDISPONIVEL sem repetir o corpo da resposta', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('SEGREDO-NO-CORPO', { status: 500 })));

    const erro = await falhaCom(() => new CofreClient().inutilizar(REFERENCIA, ESCOPO, 'corr'));

    expect(erro.codigo).toBe(CODIGOS_DE_ERRO.COFRE_INDISPONIVEL);
    expect(JSON.stringify(erro.message)).not.toContain('SEGREDO-NO-CORPO');
  });

  it('rede fora do ar vira COFRE_INDISPONIVEL sem vazar a URL do erro original', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed http://cofre.local:15104');
      }),
    );

    const erro = await falhaCom(() => new CofreClient().inutilizar(REFERENCIA, ESCOPO, 'corr'));

    expect(erro.codigo).toBe(CODIGOS_DE_ERRO.COFRE_INDISPONIVEL);
    expect(erro.message).not.toContain('cofre.local');
  });

  it('cofre ou token sem configuração falha fechado, sem sequer chamar a rede', async () => {
    const fetchFalso = vi.fn();
    vi.stubGlobal('fetch', fetchFalso);
    process.env['COFRE_URL'] = '';

    expect((await falhaCom(() => new CofreClient().restaurar(REFERENCIA, ESCOPO, 'c'))).codigo).toBe(
      CODIGOS_DE_ERRO.COFRE_INDISPONIVEL,
    );

    process.env['COFRE_URL'] = 'http://cofre.local';
    process.env['COFRE_ADMIN_TOKEN'] = 'curto';

    expect((await falhaCom(() => new CofreClient().restaurar(REFERENCIA, ESCOPO, 'c'))).codigo).toBe(
      CODIGOS_DE_ERRO.COFRE_INDISPONIVEL,
    );
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it('não expõe método de leitura do segredo', () => {
    const metodos = Object.getOwnPropertyNames(CofreClient.prototype).filter((nome) => nome !== 'constructor');

    expect(metodos.sort()).toEqual(['chamar', 'inutilizar', 'restaurar']);
  });
});
