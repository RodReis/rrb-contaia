import assert from 'node:assert/strict';
import https from 'node:https';
import { after, before, describe, it } from 'node:test';

import { criarPki, emitirPfx, raizConfiavelEmPem } from '../../../scripts/gerar-pki-de-teste.mjs';
import {
  criarPkiMtls,
  emitirIdentidade,
  emitirServidorDoDuble,
} from '../../../scripts/gerar-pki-mtls-de-teste.mjs';
import { criarDuble } from './servidor-mtls.mjs';

const CNPJ = '11222333000181';
const XML_ASSINADO = '<NFe><infNFe Id="NFe1"/><Signature xmlns="http://www.w3.org/2000/09/xmldsig#"></Signature></NFe>';

const pkiA1 = criarPki();
const pkiMtls = criarPkiMtls();
const servidor = emitirServidorDoDuble(pkiMtls, { dns: 'duble-dfe' });
const a1Valido = emitirPfx(pkiA1, { cnpj: CNPJ });
const a1DeOutraRaiz = emitirPfx(pkiA1, { cnpj: CNPJ, hierarquia: 'desconhecida' });

let duble;
let porta;

before(async () => {
  duble = criarDuble({
    nome: 'duble-dfe',
    certificadoPem: servidor.certificadoPem,
    chavePem: servidor.chavePem,
    caDosClientesPem: raizConfiavelEmPem(pkiA1),
  });
  porta = await duble.ouvir(0, '127.0.0.1');
});

after(async () => {
  await duble.fechar();
});

/** Cliente que valida o servidor contra a CA dos dublês e apresenta o A1 (como o Signer fará). */
const chamar = ({
  credencial = a1Valido,
  ca = pkiMtls.dubles.certificadoPem,
  servername = 'duble-dfe',
  chave = 'chave-0001',
  cnpjDeclarado = CNPJ,
  corpo = XML_ASSINADO,
  semCredencial = false,
} = {}) =>
  new Promise((resolver, rejeitar) => {
    const requisicao = https.request(
      {
        host: '127.0.0.1',
        port: porta,
        method: 'POST',
        path: '/v1/recepcao',
        servername,
        ca,
        ...(semCredencial ? {} : { pfx: credencial.pfx, passphrase: credencial.senha }),
        headers: {
          'content-type': 'application/xml',
          ...(chave === null ? {} : { 'idempotency-key': chave }),
          'x-cnpj-declarado': cnpjDeclarado,
        },
      },
      (resposta) => {
        const partes = [];
        resposta.on('data', (parte) => partes.push(parte));
        resposta.on('end', () =>
          resolver({
            status: resposta.statusCode,
            replay: resposta.headers['x-idempotent-replay'] === 'true',
            corpo: JSON.parse(Buffer.concat(partes).toString('utf8') || '{}'),
          }),
        );
      },
    );
    requisicao.on('error', rejeitar);
    requisicao.end(corpo);
  });

describe('dublê DF-e/eSocial com mTLS (SPEC-012 §3.7)', () => {
  it('aceita o A1 de teste correto e registra um efeito', async () => {
    const antes = duble.efeitos();
    const resposta = await chamar({ chave: 'aceita-0001' });

    assert.equal(resposta.status, 200);
    assert.equal(resposta.corpo.aceito, true);
    assert.match(resposta.corpo.protocolo, /^[0-9a-f]{16}$/u);
    assert.equal(duble.efeitos(), antes + 1);
  });

  it('deduplica pela Idempotency-Key: a repetição devolve a resposta original e não gera efeito novo', async () => {
    const primeira = await chamar({ chave: 'dedup-0001' });
    const depois = duble.efeitos();
    const repetida = await chamar({ chave: 'dedup-0001' });

    assert.equal(repetida.status, 200);
    assert.equal(repetida.replay, true);
    assert.equal(repetida.corpo.protocolo, primeira.corpo.protocolo);
    assert.equal(duble.efeitos(), depois);
  });

  it('exige a Idempotency-Key', async () => {
    const resposta = await chamar({ chave: null });

    assert.equal(resposta.status, 400);
    assert.equal(resposta.corpo.codigo, 'IDEMPOTENCY_KEY_OBRIGATORIA');
  });

  it('recusa conexão sem certificado cliente', async () => {
    const recusasAntes = duble.recusasDeTls();

    await assert.rejects(chamar({ semCredencial: true, chave: 'sem-cert-0001' }));
    assert.ok(duble.recusasDeTls() > recusasAntes);
  });

  it('recusa certificado cliente de uma raiz não confiável', async () => {
    await assert.rejects(chamar({ credencial: a1DeOutraRaiz, chave: 'raiz-ruim-0001' }));
  });

  it('recusa identidade incompatível: o CNPJ declarado difere do certificado', async () => {
    const resposta = await chamar({ cnpjDeclarado: '45723174000110', chave: 'cnpj-0001' });

    assert.equal(resposta.status, 403);
    assert.equal(resposta.corpo.codigo, 'IDENTIDADE_INCOMPATIVEL');
  });

  it('recusa XML sem assinatura', async () => {
    const resposta = await chamar({ corpo: '<NFe/>', chave: 'sem-assinatura-0001' });

    assert.equal(resposta.status, 422);
    assert.equal(resposta.corpo.codigo, 'ASSINATURA_AUSENTE');
  });

  it('o cliente que confia na CA errada rejeita o servidor (a validação nunca é desligada)', async () => {
    await assert.rejects(chamar({ ca: pkiMtls.interna.certificadoPem, chave: 'ca-errada-0001' }), {
      code: /UNABLE_TO_VERIFY|SELF_SIGNED|CERT/u,
    });
  });

  it('o cliente rejeita o servidor quando o nome não confere com o certificado', async () => {
    await assert.rejects(chamar({ servername: 'outro-host', chave: 'nome-0001' }), {
      code: 'ERR_TLS_CERT_ALTNAME_INVALID',
    });
  });

  it('uma identidade de serviço da CA interna não serve de certificado cliente do dublê', async () => {
    const worker = emitirIdentidade(pkiMtls, { nome: 'worker', papel: 'cliente' });

    await assert.rejects(
      new Promise((resolver, rejeitar) => {
        const requisicao = https.request(
          {
            host: '127.0.0.1',
            port: porta,
            method: 'POST',
            path: '/v1/recepcao',
            servername: 'duble-dfe',
            ca: pkiMtls.dubles.certificadoPem,
            cert: worker.certificadoPem,
            key: worker.chavePem,
            headers: { 'idempotency-key': 'servico-0001', 'x-cnpj-declarado': CNPJ },
          },
          resolver,
        );
        requisicao.on('error', rejeitar);
        requisicao.end(XML_ASSINADO);
      }),
    );
  });
});
