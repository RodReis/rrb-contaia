import https from 'node:https';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  criarPkiMtls,
  emitirIdentidade,
  type CredencialPem,
} from '../../../scripts/gerar-pki-mtls-de-teste.mjs';
import { ErroDoSigner } from './erro.js';
import { criarServidorDoSigner, escutar, type ServicosDoSigner } from './server.js';

const TENANT = '0198f3c2-0000-7000-8000-000000000001';
const EMPRESA = '0198f3c2-0000-7000-8000-000000000002';

const pki = criarPkiMtls();
const outraPki = criarPkiMtls();
const servidorTls = emitirIdentidade(pki, { nome: 'signer', papel: 'servidor', dns: ['signer'] });

const credenciais = {
  api: emitirIdentidade(pki, { nome: 'api', papel: 'cliente' }),
  worker: emitirIdentidade(pki, { nome: 'worker', papel: 'cliente' }),
  signer: emitirIdentidade(pki, { nome: 'signer', papel: 'servidor', dns: ['signer'] }),
  intruso: emitirIdentidade(pki, { nome: 'intruso', papel: 'cliente' }),
  deOutraCa: emitirIdentidade(outraPki, { nome: 'worker', papel: 'cliente' }),
  vencida: emitirIdentidade(pki, {
    nome: 'worker',
    papel: 'cliente',
    naoAntes: new Date(Date.now() - 3 * 86_400_000),
    naoDepois: new Date(Date.now() - 86_400_000),
  }),
} satisfies Record<string, CredencialPem>;

const servicos = {
  saude: vi.fn(),
  assinar: vi.fn(),
  executarMtls: vi.fn(),
  diagnosticar: vi.fn(),
  estados: vi.fn(),
  historico: vi.fn(),
} satisfies Record<keyof ServicosDoSigner, ReturnType<typeof vi.fn>>;

const contexto = {
  tenantId: TENANT,
  empresaId: EMPRESA,
  finalidade: 'DFE_TESTE',
  chaveIdempotente: 'chave-de-teste-0001',
  correlationId: 'corr-0001-abcd',
} as const;

const servidor = criarServidorDoSigner({
  certificadoPem: servidorTls.certificadoPem,
  chavePem: servidorTls.chavePem,
  caInternaPem: pki.interna.certificadoPem,
  servicos: servicos as unknown as ServicosDoSigner,
});
let porta = 0;

beforeAll(async () => {
  await escutar(servidor, 0, '127.0.0.1');
  porta = (servidor.address() as AddressInfo).port;
});

afterAll(async () => {
  servidor.closeAllConnections();
  await new Promise((resolve) => servidor.close(resolve));
});

beforeEach(() => {
  for (const funcao of Object.values(servicos)) {
    funcao.mockReset();
  }
});

type Resposta = { status: number; tipo: string; corpo: Record<string, unknown>; bruto: string };

const chamar = (
  credencial: CredencialPem | null,
  metodo: 'GET' | 'POST',
  caminho: string,
  corpo?: unknown,
  cabecalhos: Record<string, string> = {},
): Promise<Resposta> =>
  new Promise((resolver, rejeitar) => {
    const requisicao = https.request(
      {
        host: '127.0.0.1',
        port: porta,
        method: metodo,
        path: caminho,
        servername: 'signer',
        ca: pki.interna.certificadoPem,
        ...(credencial === null ? {} : { cert: credencial.certificadoPem, key: credencial.chavePem }),
        headers: { 'content-type': 'application/json', ...cabecalhos },
      },
      (resposta) => {
        const partes: Buffer[] = [];
        resposta.on('data', (parte: Buffer) => partes.push(parte));
        resposta.on('end', () => {
          const bruto = Buffer.concat(partes).toString('utf8');
          resolver({
            status: resposta.statusCode ?? 0,
            tipo: String(resposta.headers['content-type'] ?? ''),
            corpo: bruto === '' ? {} : (JSON.parse(bruto) as Record<string, unknown>),
            bruto,
          });
        });
      },
    );
    requisicao.on('error', rejeitar);
    requisicao.end(corpo === undefined ? undefined : JSON.stringify(corpo));
  });

describe('autenticação mTLS interna (SPEC-012 §3.1)', () => {
  it('recusa quem não apresenta certificado cliente', async () => {
    await expect(chamar(null, 'GET', '/v1/saude')).rejects.toThrow();
    expect(servicos.saude).not.toHaveBeenCalled();
  });

  it('recusa certificado de outra autoridade', async () => {
    await expect(chamar(credenciais.deOutraCa, 'GET', '/v1/saude')).rejects.toThrow();
    expect(servicos.saude).not.toHaveBeenCalled();
  });

  it('recusa certificado cliente vencido', async () => {
    await expect(chamar(credenciais.vencida, 'GET', '/v1/saude')).rejects.toThrow();
    expect(servicos.saude).not.toHaveBeenCalled();
  });

  it('certificado válido da CA interna, mas de identidade desconhecida, é 401 antes do domínio', async () => {
    const resposta = await chamar(credenciais.intruso, 'GET', '/v1/saude');

    expect(resposta.status).toBe(401);
    expect(resposta.tipo).toContain('application/problem+json');
    expect(resposta.corpo['code']).toBe('SIGNER_IDENTIDADE_INVALIDA');
    expect(servicos.saude).not.toHaveBeenCalled();
  });
});

describe('alçada técnica por rota', () => {
  it('a API consulta a saúde', async () => {
    servicos.saude.mockResolvedValue({ versaoDoContrato: 'v1', estado: 'OPERACIONAL', verificadoEm: 'agora' });

    const resposta = await chamar(credenciais.api, 'GET', '/v1/saude');

    expect(resposta.status).toBe(200);
    expect(resposta.corpo['estado']).toBe('OPERACIONAL');
  });

  it('a identidade do próprio Signer serve só para a saúde (healthcheck do contêiner)', async () => {
    servicos.saude.mockResolvedValue({ estado: 'OPERACIONAL' });

    expect((await chamar(credenciais.signer, 'GET', '/v1/saude')).status).toBe(200);
    expect((await chamar(credenciais.signer, 'POST', '/v1/assinar', { ...contexto, xml: '<a/>' })).status).toBe(403);
  });

  it('a API não assina: 403 por alçada e o serviço nem é chamado', async () => {
    const resposta = await chamar(credenciais.api, 'POST', '/v1/assinar', { ...contexto, xml: '<a/>' });

    expect(resposta.status).toBe(403);
    expect(resposta.corpo['code']).toBe('SIGNER_ALCADA_NEGADA');
    expect(servicos.assinar).not.toHaveBeenCalled();
  });

  it('a API também não executa mTLS em nome do worker', async () => {
    const resposta = await chamar(credenciais.api, 'POST', '/v1/executar-mtls', { ...contexto, xml: '<a/>' });

    expect(resposta.status).toBe(403);
    expect(servicos.executarMtls).not.toHaveBeenCalled();
  });

  it('o worker assina: o serviço recebe a identidade e o comando validado', async () => {
    servicos.assinar.mockResolvedValue({ operacaoId: 'op-1', reutilizado: false, xmlAssinado: '<a/>' });

    const resposta = await chamar(credenciais.worker, 'POST', '/v1/assinar', { ...contexto, xml: '<a/>' });

    expect(resposta.status).toBe(200);
    expect(servicos.assinar).toHaveBeenCalledWith('worker', { ...contexto, xml: '<a/>' });
  });

  it('o worker não consulta estados; a API consulta, com query tipada', async () => {
    servicos.estados.mockResolvedValue({ empresas: [] });
    const consulta = `/v1/estados?tenantId=${TENANT}&empresaId=${EMPRESA}&correlationId=corr-0001-abcd`;

    expect((await chamar(credenciais.worker, 'GET', consulta)).status).toBe(403);
    expect((await chamar(credenciais.api, 'GET', consulta)).status).toBe(200);
    expect(servicos.estados).toHaveBeenCalledWith('api', {
      tenantId: TENANT,
      empresaId: EMPRESA,
      correlationId: 'corr-0001-abcd',
    });
  });

  it('o histórico converte a página em número e valida os filtros', async () => {
    servicos.historico.mockResolvedValue({ itens: [] });
    const base = `tenantId=${TENANT}&empresaId=${EMPRESA}&correlationId=corr-0001-abcd`;

    const boa = await chamar(credenciais.api, 'GET', `/v1/historico?${base}&pagina=2&finalidade=DFE_TESTE&resultado=FALHA`);
    const ruim = await chamar(credenciais.api, 'GET', `/v1/historico?${base}&pagina=0`);

    expect(boa.status).toBe(200);
    expect(servicos.historico).toHaveBeenCalledWith('api', expect.objectContaining({ pagina: 2, resultado: 'FALHA' }));
    expect(ruim.status).toBe(400);
  });
});

describe('contrato: o chamador não escolhe destino, finalidade livre nem campo extra', () => {
  it('recusa campo extra, como uma URL', async () => {
    const resposta = await chamar(credenciais.worker, 'POST', '/v1/executar-mtls', {
      ...contexto,
      xml: '<a/>',
      url: 'https://evil.example/',
    });

    expect(resposta.status).toBe(400);
    expect(resposta.corpo['code']).toBe('SIGNER_CONTEXTO_INVALIDO');
    expect(servicos.executarMtls).not.toHaveBeenCalled();
  });

  it('finalidade livre tem código próprio', async () => {
    const resposta = await chamar(credenciais.worker, 'POST', '/v1/assinar', {
      ...contexto,
      finalidade: 'LIVRE',
      xml: '<a/>',
    });

    expect(resposta.status).toBe(400);
    expect(resposta.corpo['code']).toBe('SIGNER_FINALIDADE_INVALIDA');
  });

  it('contexto ausente (sem tenant) é recusado antes de qualquer serviço', async () => {
    const { tenantId: _tenant, ...semTenant } = contexto;
    void _tenant;

    const resposta = await chamar(credenciais.worker, 'POST', '/v1/assinar', { ...semTenant, xml: '<a/>' });

    expect(resposta.status).toBe(400);
    expect(resposta.corpo['code']).toBe('SIGNER_CONTEXTO_INVALIDO');
    expect(servicos.assinar).not.toHaveBeenCalled();
  });

  it('JSON malformado é 400, e rota ou método desconhecidos são 404', async () => {
    const malformado = await new Promise<Resposta>((resolver, rejeitar) => {
      const requisicao = https.request(
        {
          host: '127.0.0.1',
          port: porta,
          method: 'POST',
          path: '/v1/assinar',
          servername: 'signer',
          ca: pki.interna.certificadoPem,
          cert: credenciais.worker.certificadoPem,
          key: credenciais.worker.chavePem,
        },
        (resposta) => {
          const partes: Buffer[] = [];
          resposta.on('data', (parte: Buffer) => partes.push(parte));
          resposta.on('end', () =>
            resolver({
              status: resposta.statusCode ?? 0,
              tipo: '',
              corpo: JSON.parse(Buffer.concat(partes).toString('utf8')) as Record<string, unknown>,
              bruto: '',
            }),
          );
        },
      );
      requisicao.on('error', rejeitar);
      requisicao.end('{nao-e-json');
    });

    expect(malformado.status).toBe(400);
    expect((await chamar(credenciais.worker, 'POST', '/v1/nao-existe', {})).status).toBe(404);
    expect((await chamar(credenciais.worker, 'GET', '/v1/assinar')).status).toBe(404);
  });
});

describe('erros e correlação (application/problem+json)', () => {
  it('erro de domínio vira problema com código estável, status e o correlationId recebido', async () => {
    servicos.assinar.mockRejectedValue(new ErroDoSigner('SIGNER_CERTIFICADO_VENCIDO'));

    const resposta = await chamar(credenciais.worker, 'POST', '/v1/assinar', { ...contexto, xml: '<a/>' });

    expect(resposta.status).toBe(409);
    expect(resposta.tipo).toContain('application/problem+json');
    expect(resposta.corpo).toMatchObject({
      status: 409,
      code: 'SIGNER_CERTIFICADO_VENCIDO',
      correlationId: 'corr-0001-abcd',
    });
    expect(typeof resposta.corpo['type']).toBe('string');
    expect(typeof resposta.corpo['title']).toBe('string');
  });

  it('erro inesperado vira 500 genérico e nunca vaza a mensagem', async () => {
    servicos.assinar.mockRejectedValue(new Error('SENHA-SENTINELA-NAO-PODE-VAZAR'));

    const resposta = await chamar(credenciais.worker, 'POST', '/v1/assinar', { ...contexto, xml: '<a/>' });

    expect(resposta.status).toBe(500);
    expect(resposta.corpo['code']).toBe('SIGNER_INDISPONIVEL');
    expect(resposta.bruto).not.toContain('SENTINELA');
  });

  it('usa o x-correlation-id quando o corpo não traz um (rotas de consulta e erros de alçada)', async () => {
    const resposta = await chamar(credenciais.api, 'POST', '/v1/assinar', { ...contexto, xml: '<a/>' }, {
      'x-correlation-id': 'corr-do-cabecalho',
    });

    expect(resposta.corpo['correlationId']).toBe('corr-do-cabecalho');
  });

  it('gera um correlationId quando ninguém envia', async () => {
    const resposta = await chamar(credenciais.intruso, 'GET', '/v1/saude');

    expect(String(resposta.corpo['correlationId'])).toMatch(/^[0-9a-f-]{36}$/u);
  });
});
