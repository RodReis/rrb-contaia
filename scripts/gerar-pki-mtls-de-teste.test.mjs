import assert from 'node:assert/strict';
import { X509Certificate, createPrivateKey } from 'node:crypto';
import { describe, it } from 'node:test';

import {
  URN_DE_SERVICO,
  criarPkiMtls,
  emitirIdentidade,
  emitirServidorDoDuble,
} from './gerar-pki-mtls-de-teste.mjs';

const EKU_SERVER_AUTH = '1.3.6.1.5.5.7.3.1';
const EKU_CLIENT_AUTH = '1.3.6.1.5.5.7.3.2';

const pki = criarPkiMtls();
const x509 = (pem) => new X509Certificate(pem);

describe('PKI mTLS de teste (SPEC-012 §3.1, §3.7)', () => {
  it('cria duas autoridades independentes e autoassinadas, só de teste', () => {
    const interna = x509(pki.interna.certificadoPem);
    const dubles = x509(pki.dubles.certificadoPem);

    assert.equal(interna.ca, true);
    assert.equal(dubles.ca, true);
    assert.ok(interna.verify(interna.publicKey));
    assert.ok(dubles.verify(dubles.publicKey));
    assert.notEqual(interna.fingerprint256, dubles.fingerprint256);
    assert.match(interna.subject, /TESTE/u);
    assert.match(dubles.subject, /TESTE/u);
  });

  it('a identidade da API é cliente puro, emitida pela CA interna, com URN próprio', () => {
    const api = x509(emitirIdentidade(pki, { nome: 'api', papel: 'cliente' }).certificadoPem);

    assert.ok(api.checkIssued(x509(pki.interna.certificadoPem)));
    assert.ok(api.verify(x509(pki.interna.certificadoPem).publicKey));
    assert.match(api.subjectAltName, new RegExp(`URI:${URN_DE_SERVICO('api')}`, 'u'));
    assert.deepEqual(api.keyUsage, [EKU_CLIENT_AUTH]);
    assert.equal(api.ca, false);
  });

  it('a identidade do worker tem URN distinto do da API', () => {
    const worker = x509(emitirIdentidade(pki, { nome: 'worker', papel: 'cliente' }).certificadoPem);

    assert.match(worker.subjectAltName, new RegExp(`URI:${URN_DE_SERVICO('worker')}`, 'u'));
    assert.doesNotMatch(worker.subjectAltName, new RegExp(URN_DE_SERVICO('api'), 'u'));
  });

  it('o Signer é servidor e cliente, com o nome DNS da rede privada', () => {
    const signer = x509(emitirIdentidade(pki, { nome: 'signer', papel: 'servidor', dns: ['signer'] }).certificadoPem);

    assert.match(signer.subjectAltName, /DNS:signer/u);
    assert.match(signer.subjectAltName, new RegExp(`URI:${URN_DE_SERVICO('signer')}`, 'u'));
    assert.deepEqual([...signer.keyUsage].sort(), [EKU_SERVER_AUTH, EKU_CLIENT_AUTH].sort());
  });

  it('o servidor do dublê vem da CA dos dublês, nunca da interna, e só serve', () => {
    const duble = x509(emitirServidorDoDuble(pki, { dns: 'duble-dfe' }).certificadoPem);

    assert.ok(duble.checkIssued(x509(pki.dubles.certificadoPem)));
    assert.ok(!duble.checkIssued(x509(pki.interna.certificadoPem)));
    assert.match(duble.subjectAltName, /DNS:duble-dfe/u);
    assert.deepEqual(duble.keyUsage, [EKU_SERVER_AUTH]);
  });

  it('emite identidade vencida para as provas negativas', () => {
    const ontem = new Date(pki.agora.getTime() - 24 * 60 * 60 * 1000);
    const vencida = x509(
      emitirIdentidade(pki, {
        nome: 'api',
        papel: 'cliente',
        naoAntes: new Date(ontem.getTime() - 24 * 60 * 60 * 1000),
        naoDepois: ontem,
      }).certificadoPem,
    );

    assert.ok(new Date(vencida.validTo) < pki.agora);
  });

  it('a chave privada é da identidade (par consistente)', () => {
    const identidade = emitirIdentidade(pki, { nome: 'worker', papel: 'cliente' });

    assert.match(identidade.chavePem, /PRIVATE KEY/u);
    assert.ok(x509(identidade.certificadoPem).checkPrivateKey(createPrivateKey(identidade.chavePem)));
  });
});
