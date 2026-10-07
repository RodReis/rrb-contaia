import { readFileSync } from 'node:fs';
import https from 'node:https';
import net from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { criarDuble, type Duble } from '../../../infra/docker/dubles/servidor-mtls.mjs';
import { criarPki, emitirPfx, raizConfiavelEmPem } from '../../../scripts/gerar-pki-de-teste.mjs';
import { criarPkiMtls, emitirServidorDoDuble } from '../../../scripts/gerar-pki-mtls-de-teste.mjs';
import { chamarDestino, type EntradaDoDestino } from './destino.js';

const CNPJ = '11222333000181';
const XML_ASSINADO = '<NFe><infNFe Id="A1"/><Signature xmlns="http://www.w3.org/2000/09/xmldsig#"></Signature></NFe>';

const pkiA1 = criarPki();
const pkiMtls = criarPkiMtls();
const servidor = emitirServidorDoDuble(pkiMtls, { dns: 'duble-dfe' });
const a1 = emitirPfx(pkiA1, { cnpj: CNPJ });
const a1DeOutraRaiz = emitirPfx(pkiA1, { cnpj: CNPJ, hierarquia: 'desconhecida' });

let duble: Duble;
let porta = 0;
const aberturas: { fechar: () => Promise<void> }[] = [];

beforeAll(async () => {
  duble = criarDuble({
    nome: 'duble-dfe',
    certificadoPem: servidor.certificadoPem,
    chavePem: servidor.chavePem,
    caDosClientesPem: raizConfiavelEmPem(pkiA1),
  });
  porta = await duble.ouvir(0, '127.0.0.1');
});

afterAll(async () => {
  await duble.fechar();
  await Promise.all(aberturas.map((a) => a.fechar()));
});

const base = (parcial: Partial<EntradaDoDestino> = {}): EntradaDoDestino => ({
  destino: { host: '127.0.0.1', porta, servername: 'duble-dfe', caminho: '/v1/recepcao' },
  pfx: a1.pfx,
  senha: a1.senha,
  caPem: pkiMtls.dubles.certificadoPem,
  idempotencyKey: 'op-0001',
  cnpj: CNPJ,
  xml: XML_ASSINADO,
  tempoLimiteMs: 2_000,
  ...parcial,
});

describe('saída mTLS para o dublê (SPEC-012 §3.7)', () => {
  it('apresenta o A1 como certificado cliente e o dublê aceita', async () => {
    const antes = duble.efeitos();

    const resultado = await chamarDestino(base({ idempotencyKey: 'aceito-0001' }));

    expect(resultado).toEqual({ tipo: 'ACEITO', statusHttp: 200 });
    expect(duble.efeitos()).toBe(antes + 1);
  });

  it('não usa agente compartilhado: o PKCS#12 não fica retido no pool de conexões depois da operação', async () => {
    const espiao = vi.spyOn(https, 'request');

    try {
      await chamarDestino(base({ idempotencyKey: 'sem-agente-0001' }));

      expect(espiao).toHaveBeenCalledTimes(1);
      expect((espiao.mock.calls[0]?.[0] as { agent?: unknown }).agent).toBe(false);
    } finally {
      espiao.mockRestore();
    }
  });

  it('a repetição com a MESMA Idempotency-Key não gera efeito novo no dublê', async () => {
    await chamarDestino(base({ idempotencyKey: 'dedup-0001' }));
    const depois = duble.efeitos();

    const repetida = await chamarDestino(base({ idempotencyKey: 'dedup-0001' }));

    expect(repetida.tipo).toBe('ACEITO');
    expect(duble.efeitos()).toBe(depois);
  });

  it('A1 de uma raiz que o dublê não confia é falha de TLS: transitória, o operador corrige a confiança', async () => {
    const resultado = await chamarDestino(base({ pfx: a1DeOutraRaiz.pfx, senha: a1DeOutraRaiz.senha, idempotencyKey: 'raiz-ruim' }));

    expect(resultado).toEqual({ tipo: 'FALHA_DE_TLS' });
  });

  it('identidade incompatível (CNPJ declarado difere do certificado) é recusa de aplicação, definitiva', async () => {
    const resultado = await chamarDestino(base({ cnpj: '45723174000110', idempotencyKey: 'cnpj-ruim' }));

    expect(resultado).toMatchObject({ tipo: 'RECUSADO', statusHttp: 403 });
  });

  it('XML sem assinatura é recusado pelo destino', async () => {
    const resultado = await chamarDestino(base({ xml: '<NFe/>', idempotencyKey: 'sem-assinatura' }));

    expect(resultado).toMatchObject({ tipo: 'RECUSADO', statusHttp: 422 });
  });

  it('servidor fora da CA configurada nunca é aceito: a validação não é desligada', async () => {
    const resultado = await chamarDestino(base({ caPem: pkiMtls.interna.certificadoPem, idempotencyKey: 'ca-errada' }));

    expect(resultado).toEqual({ tipo: 'FALHA_DE_TLS' });
  });

  it('nome do servidor que não confere com o certificado é recusado', async () => {
    const resultado = await chamarDestino(
      base({ destino: { host: '127.0.0.1', porta, servername: 'outro-host', caminho: '/v1/recepcao' }, idempotencyKey: 'nome' }),
    );

    expect(resultado).toEqual({ tipo: 'FALHA_DE_TLS' });
  });

  it('destino fora do ar é falha transitória (o retry é do worker)', async () => {
    const ocupada = await new Promise<number>((resolver) => {
      const temporario = net.createServer().listen(0, '127.0.0.1', () => {
        const { port } = temporario.address() as net.AddressInfo;
        temporario.close(() => resolver(port));
      });
    });

    const resultado = await chamarDestino(
      base({ destino: { host: '127.0.0.1', porta: ocupada, servername: 'duble-dfe', caminho: '/v1/recepcao' } }),
    );

    expect(resultado).toEqual({ tipo: 'INDISPONIVEL' });
  });

  it('destino que aceita a conexão e nunca responde estoura o tempo limite como indisponível', async () => {
    const conexoes: net.Socket[] = [];
    const mudo = net.createServer((socket) => conexoes.push(socket)).listen(0, '127.0.0.1');
    aberturas.push({
      fechar: () =>
        new Promise((resolver) => {
          conexoes.forEach((socket) => socket.destroy());
          mudo.close(() => resolver());
        }),
    });
    await new Promise((resolver) => mudo.once('listening', resolver));

    const resultado = await chamarDestino(
      base({
        destino: { host: '127.0.0.1', porta: (mudo.address() as net.AddressInfo).port, servername: 'duble-dfe', caminho: '/v1/recepcao' },
        tempoLimiteMs: 300,
      }),
    );

    expect(resultado).toEqual({ tipo: 'INDISPONIVEL' });
  });

  it('HTTP 5xx do destino é falha transitória', async () => {
    const falho = https
      .createServer({ cert: servidor.certificadoPem, key: servidor.chavePem }, (_req, resposta) => {
        resposta.writeHead(503);
        resposta.end();
      })
      .listen(0, '127.0.0.1');
    aberturas.push({ fechar: () => new Promise((resolver) => { falho.closeAllConnections(); falho.close(() => resolver()); }) });
    await new Promise((resolver) => falho.once('listening', resolver));

    const resultado = await chamarDestino(
      base({ destino: { host: '127.0.0.1', porta: (falho.address() as net.AddressInfo).port, servername: 'duble-dfe', caminho: '/v1/recepcao' } }),
    );

    expect(resultado).toEqual({ tipo: 'INDISPONIVEL' });
  });
});

describe('a validação TLS nunca é desligada (SPEC-012 §11)', () => {
  it('o código de saída não contém rejectUnauthorized falso nem variável global de bypass', () => {
    const fonte = readFileSync(new URL('./destino.ts', import.meta.url), 'utf8');

    expect(fonte).not.toMatch(/rejectUnauthorized\s*:\s*false/u);
    expect(fonte).not.toMatch(/NODE_TLS_REJECT_UNAUTHORIZED/u);
    expect(fonte).not.toMatch(/checkServerIdentity/u);
  });
});
