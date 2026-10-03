import { describe, expect, it, vi } from 'vitest';
import { classificarResposta, criarClienteDaApi } from './api.js';

const PEDIDO = {
  ticket: 't.t',
  referenciaDoSegredo: '33333333-3333-4333-8333-333333333333',
  metadados: {},
} as unknown as Parameters<ReturnType<typeof criarClienteDaApi>['ativar']>[0];

const cliente = (resposta: Response | Error) => {
  const fetchImpl = vi.fn(async () => {
    if (resposta instanceof Error) throw resposta;
    return resposta;
  }) as unknown as typeof fetch;
  return { api: criarClienteDaApi({ apiUrl: 'http://api.local', serviceToken: 'tok', fetchImpl }), fetchImpl };
};

const json = (corpo: unknown, status: number): Response =>
  new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/problem+json' } });

describe('classificarResposta', () => {
  it('4xx com problem+json (code) é recusa DEFINITIVA e leva título e detalhe truncados', () => {
    const r = classificarResposta(422, { code: 'EMPRESA_ARQUIVADA', title: 'Arquivada', detail: 'x'.repeat(1000) });

    expect(r).toMatchObject({ ok: false, definitiva: true, status: 422, codigo: 'EMPRESA_ARQUIVADA', titulo: 'Arquivada' });
    expect((r as { detalhe: string }).detalhe).toHaveLength(300);
  });

  it.each([
    [500, { code: 'ERRO_INTERNO' }],
    [502, null],
    [503, { code: 'X' }],
    [408, { code: 'TIMEOUT' }],
    [429, { code: 'MUITAS' }],
    [404, null],
    [400, 'texto solto'],
    [401, {}],
    [409, { code: 42 }],
  ])('HTTP %i com corpo %j é AMBÍGUO (não autoriza destruir o segredo)', (status, corpo) => {
    expect(classificarResposta(status, corpo)).toEqual({ ok: false, definitiva: false, status });
  });
});

describe('criarClienteDaApi.ativar', () => {
  it('manda Bearer, correlation id e o pedido; 200 com certificado é sucesso', async () => {
    const { api, fetchImpl } = cliente(json({ certificado: { id: 'c1' } }, 200));

    expect(await api.ativar(PEDIDO, 'corr-1')).toEqual({ ok: true, corpo: { certificado: { id: 'c1' } } });

    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://api.local/interno/cofre/ativacao');
    expect(init.headers).toMatchObject({ authorization: 'Bearer tok', 'x-correlation-id': 'corr-1' });
  });

  it('erro de rede/timeout é ambíguo', async () => {
    expect(await cliente(new Error('timeout')).api.ativar(PEDIDO, 'c')).toEqual({
      ok: false,
      definitiva: false,
      status: null,
    });
  });

  it('2xx sem a forma esperada NÃO prova ativação: ambíguo', async () => {
    expect(await cliente(json({ outra: 1 }, 200)).api.ativar(PEDIDO, 'c')).toMatchObject({ ok: false, definitiva: false });
    expect(await cliente(new Response('<html>', { status: 200 })).api.ativar(PEDIDO, 'c')).toMatchObject({
      definitiva: false,
    });
  });

  it('4xx com problem+json é definitivo; 5xx é ambíguo', async () => {
    expect(await cliente(json({ code: 'CERTIFICADO_JA_VIGENTE', title: 'já' }, 409)).api.ativar(PEDIDO, 'c')).toMatchObject({
      definitiva: true,
      codigo: 'CERTIFICADO_JA_VIGENTE',
    });
    expect(await cliente(json({ code: 'ERRO' }, 500)).api.ativar(PEDIDO, 'c')).toMatchObject({ definitiva: false, status: 500 });
  });
});
