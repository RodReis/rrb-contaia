/**
 * Política do Vault do Signer (SPEC-012 §3.4, plano T7): o token `signer-leitura` LÊ o dado do
 * certificado e nada mais; o da API não lê nada em `kv/`. Roda contra o Vault real da composição
 * (ou o efêmero da CI), com os tokens emitidos pelo bootstrap. Sem Vault ou sem token o teste é
 * PULADO com a razão explícita — `not_run`, nunca PASS.
 *
 *   node --env-file-if-exists=.env --test infra/docker/vault/signer-politica.test.mjs
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const VAULT = (process.env.VAULT_ADDR ?? 'http://127.0.0.1:18200').replace(/\/+$/u, '');
const DIRETORIO = process.env.VAULT_LOCAL_DIR ?? join(dirname(fileURLToPath(import.meta.url)), '..', '.vault-local');

const lerToken = (arquivo) => {
  try {
    const token = readFileSync(join(DIRETORIO, arquivo), 'utf8').trim();

    return token === '' ? null : token;
  } catch {
    return null;
  }
};

const TOKENS = {
  ingestao: lerToken('token-cofre-ingestao'),
  signer: lerToken('token-signer-leitura'),
  api: lerToken('token-api-principal'),
};

const chamar = async (token, metodo, caminho, corpo) => {
  const resposta = await fetch(`${VAULT}/v1/${caminho}`, {
    method: metodo,
    headers: { 'X-Vault-Token': token, 'content-type': 'application/json' },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });

  return resposta.status;
};

const razaoParaPular = async () => {
  if (Object.values(TOKENS).some((token) => token === null)) {
    return `tokens do Vault ausentes em ${DIRETORIO} (rode o bootstrap): not_run`;
  }

  try {
    const saude = await fetch(`${VAULT}/v1/sys/health`);

    return saude.status === 200 ? false : `Vault em ${VAULT} não está pronto (HTTP ${saude.status}): not_run`;
  } catch {
    return `Vault em ${VAULT} inalcançável: not_run`;
  }
};

const pular = await razaoParaPular();

// Na CI (`EXIGIR_INFRA=1`) o Vault e os tokens são obrigatórios: sem eles a prova FALHA, não vira `not_run` verde.
if (pular !== false && process.env.EXIGIR_INFRA === '1') {
  throw new Error(`EXIGIR_INFRA=1 e ${pular}`);
}

describe('política `signer-leitura` e `api-principal` no Vault', { skip: pular }, () => {
  const tenant = randomUUID();
  const empresa = randomUUID();
  const referencia = randomUUID();
  const dado = `kv/data/certificados/${tenant}/${empresa}/${referencia}`;
  const metadado = `kv/metadata/certificados/${tenant}/${empresa}/${referencia}`;

  before(async () => {
    // Quem cria é a política de ingestão (write-only): é a F11 que grava o PKCS#12 cifrado.
    const status = await chamar(TOKENS.ingestao, 'POST', dado, {
      options: { cas: 0 },
      data: { valor: 'material-sintetico-de-teste' },
    });

    assert.equal(status, 200, 'a ingestão precisa conseguir criar o segredo de prova');
  });

  it('o Signer lê o dado do segredo', async () => {
    assert.equal(await chamar(TOKENS.signer, 'GET', dado), 200);
  });

  it('o Signer NÃO lista, nem lê metadados, nem escreve, nem apaga', async () => {
    assert.equal(await chamar(TOKENS.signer, 'LIST', `kv/metadata/certificados/${tenant}/`), 403, 'list');
    assert.equal(await chamar(TOKENS.signer, 'GET', metadado), 403, 'metadata');
    assert.equal(await chamar(TOKENS.signer, 'POST', dado, { data: { valor: 'x' } }), 403, 'escrita');
    assert.equal(await chamar(TOKENS.signer, 'DELETE', dado), 403, 'delete');
    assert.equal(await chamar(TOKENS.signer, 'POST', `kv/delete/certificados/${tenant}/${empresa}/${referencia}`, { versions: [1] }), 403, 'delete por versão');
    assert.equal(await chamar(TOKENS.signer, 'POST', `kv/destroy/certificados/${tenant}/${empresa}/${referencia}`, { versions: [1] }), 403, 'destroy');
  });

  it('o Signer NÃO alcança o sistema do Vault (políticas, montagens, tokens)', async () => {
    assert.equal(await chamar(TOKENS.signer, 'GET', 'sys/policies/acl/signer-leitura'), 403);
    assert.equal(await chamar(TOKENS.signer, 'GET', 'sys/mounts'), 403);
    assert.equal(await chamar(TOKENS.signer, 'POST', 'auth/token/create', { policies: ['root'] }), 403);
  });

  it('a API não lê nada em kv/ (nem o dado, nem a metadata, nem a lista)', async () => {
    assert.equal(await chamar(TOKENS.api, 'GET', dado), 403, 'dado');
    assert.equal(await chamar(TOKENS.api, 'GET', metadado), 403, 'metadata');
    assert.equal(await chamar(TOKENS.api, 'LIST', `kv/metadata/certificados/${tenant}/`), 403, 'lista');
  });

  it('a ingestão não lê o que gravou (write-only)', async () => {
    assert.equal(await chamar(TOKENS.ingestao, 'GET', dado), 403);
  });
});
