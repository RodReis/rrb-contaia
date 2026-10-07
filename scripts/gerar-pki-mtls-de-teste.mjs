#!/usr/bin/env node
/**
 * PKI SINTÉTICA de mTLS de teste para o Signer (SPEC-012 / F12).
 *
 * Duas autoridades independentes, ambas só de teste e geradas a cada execução:
 *   - `interna`: "AC mTLS Interna ContaIA (teste)". Emite as identidades de serviço (API, worker
 *     e o próprio Signer), cada uma com um URN `urn:contaia:servico:<nome>` no SAN. É o que a rede
 *     privada usa para decidir QUEM é o chamador — estar na rede Docker não autentica ninguém.
 *   - `dubles`: "AC dos Dubles Governamentais ContaIA (teste)". Emite o certificado de servidor
 *     dos dublês locais de DF-e e eSocial; o Signer só confia nela ao falar com eles.
 *
 * O certificado cliente apresentado aos dublês é o A1 de teste do cofre (F11), emitido pela PKI
 * do `gerar-pki-de-teste.mjs`; os dublês confiam na raiz dela.
 *
 * Chave e certificado NUNCA são versionados: saída padrão em `infra/docker/.vault-local/pki-mtls/`
 * (ignorada pelo Git; `*.pem` também).
 *
 * uso: node scripts/gerar-pki-mtls-de-teste.mjs [--saida <dir>]   (ou `pnpm signer:pki-mtls`)
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import forge from 'node-forge';

import { assinar, gerarChave } from './gerar-pki-de-teste.mjs';

const { pki } = forge;

const DIA_MS = 24 * 60 * 60 * 1000;
const TIPO_SAN_DNS = 2;
const TIPO_SAN_URI = 6;

/** URN da identidade de serviço. É o que o Signer lê do certificado do chamador. */
export const URN_DE_SERVICO = (nome) => `urn:contaia:servico:${nome}`;

const atributos = (nome) => [
  { name: 'countryName', value: 'BR' },
  { name: 'organizationName', value: 'ContaIA (TESTE mTLS)' },
  { name: 'commonName', value: nome },
];

const criarAutoridade = (nome, agora) => {
  const chaves = gerarChave();
  const assunto = atributos(nome);
  const cert = assinar({
    assunto,
    emissor: assunto,
    chavePublica: chaves.publicKey,
    chaveDoEmissor: chaves.privateKey,
    naoAntes: new Date(agora.getTime() - DIA_MS),
    naoDepois: new Date(agora.getTime() + 10 * 365 * DIA_MS),
    extensoes: [
      { name: 'basicConstraints', cA: true, critical: true },
      { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
    ],
  });

  return {
    cert,
    chaves,
    certificadoPem: pki.certificateToPem(cert),
    chavePem: pki.privateKeyToPem(chaves.privateKey),
  };
};

/** Cria as duas autoridades. `agora` entra por parâmetro, como em todo cálculo de data do repo. */
export const criarPkiMtls = ({ agora = new Date() } = {}) => ({
  agora,
  interna: criarAutoridade('AC mTLS Interna ContaIA (teste)', agora),
  dubles: criarAutoridade('AC dos Dubles Governamentais ContaIA (teste)', agora),
});

const emitir = (autoridade, agora, { nome, extUso, altNames, naoAntes, naoDepois }) => {
  const chaves = gerarChave();
  const cert = assinar({
    assunto: atributos(nome),
    emissor: autoridade.cert.subject.attributes,
    chavePublica: chaves.publicKey,
    chaveDoEmissor: autoridade.chaves.privateKey,
    naoAntes: naoAntes ?? new Date(agora.getTime() - DIA_MS),
    naoDepois: naoDepois ?? new Date(agora.getTime() + 365 * DIA_MS),
    extensoes: [
      { name: 'basicConstraints', cA: false, critical: true },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
      { name: 'extKeyUsage', ...extUso },
      { name: 'subjectAltName', altNames },
    ],
  });

  return { certificadoPem: pki.certificateToPem(cert), chavePem: pki.privateKeyToPem(chaves.privateKey) };
};

/**
 * Identidade de serviço da CA interna.
 *  - `cliente`: só `clientAuth` (API e worker);
 *  - `servidor`: `serverAuth` + `clientAuth` e nomes DNS da rede privada (o Signer).
 */
export const emitirIdentidade = (pkiMtls, { nome, papel, dns = [], naoAntes, naoDepois }) =>
  emitir(pkiMtls.interna, pkiMtls.agora, {
    nome: `contaia-${nome}`,
    extUso: papel === 'servidor' ? { serverAuth: true, clientAuth: true } : { clientAuth: true },
    altNames: [
      { type: TIPO_SAN_URI, value: URN_DE_SERVICO(nome) },
      ...dns.map((value) => ({ type: TIPO_SAN_DNS, value })),
    ],
    naoAntes,
    naoDepois,
  });

/** Servidor de um dublê: certificado da CA dos dublês, só `serverAuth`, com o nome DNS da rede. */
export const emitirServidorDoDuble = (pkiMtls, { dns, naoAntes, naoDepois }) =>
  emitir(pkiMtls.dubles, pkiMtls.agora, {
    nome: dns,
    extUso: { serverAuth: true },
    altNames: [{ type: TIPO_SAN_DNS, value: dns }],
    naoAntes,
    naoDepois,
  });

const lerArgumento = (nome, padrao) => {
  const indice = process.argv.indexOf(`--${nome}`);
  return indice > 0 && process.argv[indice + 1] ? process.argv[indice + 1] : padrao;
};

const executarComoCli = async () => {
  const raizDoRepo = resolve(fileURLToPath(new URL('../', import.meta.url)));
  const saida = resolve(lerArgumento('saida', join(raizDoRepo, 'infra/docker/.vault-local/pki-mtls')));
  const pkiMtls = criarPkiMtls();

  await mkdir(saida, { recursive: true });
  await writeFile(join(saida, 'ca-interna.pem'), pkiMtls.interna.certificadoPem);
  await writeFile(join(saida, 'ca-dubles.pem'), pkiMtls.dubles.certificadoPem);

  const identidades = {
    api: emitirIdentidade(pkiMtls, { nome: 'api', papel: 'cliente' }),
    worker: emitirIdentidade(pkiMtls, { nome: 'worker', papel: 'cliente' }),
    signer: emitirIdentidade(pkiMtls, { nome: 'signer', papel: 'servidor', dns: ['signer'] }),
    'duble-dfe': emitirServidorDoDuble(pkiMtls, { dns: 'duble-dfe' }),
    'duble-esocial': emitirServidorDoDuble(pkiMtls, { dns: 'duble-esocial' }),
  };

  for (const [nome, { certificadoPem, chavePem }] of Object.entries(identidades)) {
    await writeFile(join(saida, `${nome}.crt.pem`), certificadoPem);
    await writeFile(join(saida, `${nome}.key.pem`), chavePem, { mode: 0o600 });
  }

  console.warn(`PKI mTLS de teste gerada em ${saida}`);
  console.warn('  Material sintético; nunca versionar.');
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await executarComoCli();
}
