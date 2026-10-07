import { readFileSync } from 'node:fs';
import https from 'node:https';
import net from 'node:net';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { TLSSocket } from 'node:tls';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { criarPkiMtls, emitirIdentidade } from '../../../scripts/gerar-pki-mtls-de-teste.mjs';
import { ErroDoClienteDoSigner, criarClienteDoSigner } from './cliente.js';

const TENANT = '0198f3c2-0000-7000-8000-000000000001';
const EMPRESA = '0198f3c2-0000-7000-8000-000000000002';

const pki = criarPkiMtls();
const servidorTls = emitirIdentidade(pki, { nome: 'signer', papel: 'servidor', dns: ['signer'] });
const worker = emitirIdentidade(pki, { nome: 'worker', papel: 'cliente' });
const outraPki = criarPkiMtls();

type Capturada = { metodo: string; caminho: string; corpo: string; cabecalhos: IncomingMessage['headers']; san: string };
const capturadas: Capturada[] = [];
let resposta: { status: number; tipo: string; corpo: unknown } = { status: 200, tipo: 'application/json', corpo: {} };
let porta = 0;

const servidor = https.createServer(
  { cert: servidorTls.certificadoPem, key: servidorTls.chavePem, ca: pki.interna.certificadoPem, requestCert: true, rejectUnauthorized: true },
  (req: IncomingMessage, res: ServerResponse) => {
    const partes: Buffer[] = [];
    req.on('data', (p: Buffer) => partes.push(p));
    req.on('end', () => {
      capturadas.push({
        metodo: req.method ?? '',
        caminho: req.url ?? '',
        corpo: Buffer.concat(partes).toString('utf8'),
        cabecalhos: req.headers,
        san: (req.socket as TLSSocket).getPeerCertificate().subjectaltname ?? '',
      });
      res.writeHead(resposta.status, { 'content-type': resposta.tipo });
      res.end(JSON.stringify(resposta.corpo));
    });
  },
);

beforeAll(async () => {
  await new Promise<void>((resolver) => servidor.listen(0, '127.0.0.1', resolver));
  porta = (servidor.address() as net.AddressInfo).port;
});

afterAll(async () => {
  servidor.closeAllConnections();
  await new Promise((resolver) => servidor.close(resolver));
});

const cliente = (parcial: Partial<Parameters<typeof criarClienteDoSigner>[0]> = {}) =>
  criarClienteDoSigner({
    host: '127.0.0.1',
    porta,
    servername: 'signer',
    certificadoPem: worker.certificadoPem,
    chavePem: worker.chavePem,
    caPem: pki.interna.certificadoPem,
    tempoLimiteMs: 1_500,
    ...parcial,
  });

const definir = (status: number, corpo: unknown, tipo = 'application/json'): void => {
  resposta = { status, tipo, corpo };
};

describe('cliente mTLS do Signer', () => {
  it('apresenta a identidade de serviço e valida o servidor contra a CA interna', async () => {
    definir(200, { versaoDoContrato: 'v1', estado: 'OPERACIONAL', verificadoEm: '2026-10-07T12:00:00.000Z' });

    const saude = await cliente().saude('corr-0001-abcd');

    expect(saude.estado).toBe('OPERACIONAL');
    const ultima = capturadas.at(-1)!;
    expect(ultima.san).toContain('urn:contaia:servico:worker');
    expect(ultima.cabecalhos['x-correlation-id']).toBe('corr-0001-abcd');
  });

  it('assina: POST JSON com o comando e devolve a resposta tipada', async () => {
    definir(200, { operacaoId: 'op-1', reutilizado: false, xmlAssinado: '<a/>' });
    const comando = {
      tenantId: TENANT,
      empresaId: EMPRESA,
      finalidade: 'DFE_TESTE' as const,
      chaveIdempotente: 'chave-de-teste-0001',
      correlationId: 'corr-0001-abcd',
      xml: '<NFe/>',
    };

    const resultado = await cliente().assinar(comando);

    expect(resultado).toEqual({ operacaoId: 'op-1', reutilizado: false, xmlAssinado: '<a/>' });
    const ultima = capturadas.at(-1)!;
    expect(ultima).toMatchObject({ metodo: 'POST', caminho: '/v1/assinar' });
    expect(JSON.parse(ultima.corpo)).toEqual(comando);
  });

  it('consulta estados e histórico por GET com a query codificada', async () => {
    definir(200, { empresas: [] });
    await cliente().estados({ tenantId: TENANT, empresaId: EMPRESA, correlationId: 'corr-0001-abcd' });
    expect(capturadas.at(-1)!.caminho).toBe(`/v1/estados?tenantId=${TENANT}&empresaId=${EMPRESA}&correlationId=corr-0001-abcd`);

    definir(200, { pagina: 2, itensPorPagina: 15, total: 0, itens: [] });
    await cliente().historico({
      tenantId: TENANT,
      empresaId: EMPRESA,
      correlationId: 'corr-0001-abcd',
      pagina: 2,
      finalidade: 'ESOCIAL_TESTE',
      resultado: 'FALHA',
    });
    expect(capturadas.at(-1)!.caminho).toContain('pagina=2&finalidade=ESOCIAL_TESTE&resultado=FALHA');
  });

  it('problem+json vira erro com código estável, status e correlationId', async () => {
    definir(
      409,
      { type: 'x', title: 'Certificado vencido', status: 409, code: 'SIGNER_CERTIFICADO_VENCIDO', correlationId: 'corr-0001-abcd' },
      'application/problem+json',
    );

    const erro = await cliente()
      .executarMtls({ tenantId: TENANT, empresaId: EMPRESA, finalidade: 'DFE_TESTE', chaveIdempotente: 'chave-de-teste-0002', correlationId: 'corr-0001-abcd', xml: '<a/>' })
      .catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(ErroDoClienteDoSigner);
    expect(erro).toMatchObject({ codigo: 'SIGNER_CERTIFICADO_VENCIDO', status: 409, correlationId: 'corr-0001-abcd', transitorio: false });
  });

  it.each([
    [502, 'SIGNER_MTLS_RECUSADO', true],
    [503, 'SIGNER_VAULT_INDISPONIVEL', true],
    [504, 'SIGNER_DESTINO_INDISPONIVEL', true],
    [409, 'SIGNER_OPERACAO_EM_ANDAMENTO', true],
    [409, 'SIGNER_IDEMPOTENCIA_CONFLITO', false],
    [400, 'SIGNER_CONTEXTO_INVALIDO', false],
    [403, 'SIGNER_ALCADA_NEGADA', false],
  ])('HTTP %i %s: transitório = %s (o retry é do chamador)', async (status, code, transitorio) => {
    definir(status, { type: 'x', title: 't', status, code, correlationId: 'corr-0001-abcd' }, 'application/problem+json');

    const erro = await cliente().saude('corr-0001-abcd').catch((e: unknown) => e);

    expect(erro).toMatchObject({ codigo: code, transitorio });
  });

  it('servidor fora do ar é erro de transporte transitório', async () => {
    const livre = await new Promise<number>((resolver) => {
      const t = net.createServer().listen(0, '127.0.0.1', () => {
        const { port } = t.address() as net.AddressInfo;
        t.close(() => resolver(port));
      });
    });

    const erro = await cliente({ porta: livre }).saude('corr-0001-abcd').catch((e: unknown) => e);

    expect(erro).toMatchObject({ codigo: 'SIGNER_INDISPONIVEL', status: null, transitorio: true });
  });

  it('tempo limite estoura como transitório', async () => {
    const conexoes: net.Socket[] = [];
    const mudo = net.createServer((s) => conexoes.push(s)).listen(0, '127.0.0.1');
    await new Promise((resolver) => mudo.once('listening', resolver));

    const erro = await cliente({ porta: (mudo.address() as net.AddressInfo).port, tempoLimiteMs: 300 })
      .saude('corr-0001-abcd')
      .catch((e: unknown) => e);
    conexoes.forEach((s) => s.destroy());
    await new Promise((resolver) => mudo.close(resolver));

    expect(erro).toMatchObject({ codigo: 'SIGNER_INDISPONIVEL', transitorio: true });
  });

  it('servidor de outra CA nunca é aceito: a validação não é desligada', async () => {
    const erro = await cliente({ caPem: outraPki.interna.certificadoPem }).saude('corr-0001-abcd').catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(ErroDoClienteDoSigner);
    expect((erro as ErroDoClienteDoSigner).status).toBeNull();
  });

  it('nome do servidor que não confere é recusado', async () => {
    const erro = await cliente({ servername: 'outro-host' }).saude('corr-0001-abcd').catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(ErroDoClienteDoSigner);
  });

  it('resposta que não é problem+json nem JSON válido vira erro genérico, sem eco do corpo', async () => {
    definir(500, 'SENHA-SENTINELA-NAO-PODE-VAZAR', 'text/plain');

    const erro = await cliente().saude('corr-0001-abcd').catch((e: unknown) => e);

    expect(erro).toMatchObject({ codigo: 'SIGNER_INDISPONIVEL', status: 500 });
    expect(String((erro as Error).message)).not.toContain('SENTINELA');
  });

  it('o código não desliga a validação TLS', () => {
    const fonte = readFileSync(new URL('./cliente.ts', import.meta.url), 'utf8');

    expect(fonte).not.toMatch(/rejectUnauthorized\s*:\s*false/u);
    expect(fonte).not.toMatch(/NODE_TLS_REJECT_UNAUTHORIZED/u);
    expect(fonte).not.toMatch(/checkServerIdentity/u);
  });
});
