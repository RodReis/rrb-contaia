import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { prepararSegredosDoSigner } from './preparar-segredos-do-signer.mjs';

const RAIZ_A = '-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n';
const RAIZ_B = '-----BEGIN CERTIFICATE-----\nBBBB\n-----END CERTIFICATE-----\n';

const diretorios = [];

const novoAmbiente = async ({ comRaizes = true } = {}) => {
  const base = await mkdtemp(join(tmpdir(), 'segredos-signer-'));

  diretorios.push(base);

  const raizes = join(base, 'raizes-icp');

  await mkdir(raizes, { recursive: true });
  if (comRaizes) {
    await writeFile(join(raizes, 'a.pem'), RAIZ_A);
    await writeFile(join(raizes, 'b.pem'), RAIZ_B);
    await writeFile(join(raizes, 'leia-me.txt'), 'nao e raiz');
  }

  return { diretorio: base, raizesIcpDir: raizes };
};

after(async () => {
  await Promise.all(diretorios.map((d) => rm(d, { recursive: true, force: true })));
});

describe('preparar segredos do Signer', () => {
  it('gera a PKI mTLS, o pepper e o bundle de raízes que os dublês aceitam como cliente', async () => {
    const ambiente = await novoAmbiente();

    await prepararSegredosDoSigner(ambiente);

    for (const arquivo of [
      'ca-interna.pem',
      'ca-dubles.pem',
      'api.crt.pem',
      'api.key.pem',
      'worker.crt.pem',
      'worker.key.pem',
      'signer.crt.pem',
      'signer.key.pem',
      'duble-dfe.crt.pem',
      'duble-esocial.key.pem',
    ]) {
      assert.ok((await stat(join(ambiente.diretorio, 'pki-mtls', arquivo))).isFile(), arquivo);
    }

    const pepper = (await readFile(join(ambiente.diretorio, 'signer-pepper'), 'utf8')).trim();

    assert.ok(pepper.length >= 32, 'pepper com 32 caracteres ou mais');

    const bundle = await readFile(join(ambiente.diretorio, 'pki-mtls', 'ca-clientes-dos-dubles.pem'), 'utf8');

    assert.ok(bundle.includes('AAAA') && bundle.includes('BBBB'), 'reúne todas as raízes .pem');
    assert.ok(!bundle.includes('nao e raiz'), 'ignora o que não é PEM');
  });

  it('cria o arquivo do token do Signer vazio (o Docker o criaria como PASTA) e nunca apaga um token já emitido', async () => {
    const ambiente = await novoAmbiente();
    const token = join(ambiente.diretorio, 'token-signer-leitura');

    await prepararSegredosDoSigner(ambiente);

    assert.ok((await stat(token)).isFile(), 'arquivo, não diretório');
    assert.equal(await readFile(token, 'utf8'), '');

    await writeFile(token, 'hvs.token-emitido\n');
    await prepararSegredosDoSigner(ambiente);

    assert.equal(await readFile(token, 'utf8'), 'hvs.token-emitido\n');
  });

  it('é idempotente: o pepper e a PKI existentes são preservados (a chave idempotente depende deles)', async () => {
    const ambiente = await novoAmbiente();

    await prepararSegredosDoSigner(ambiente);
    const pepper = await readFile(join(ambiente.diretorio, 'signer-pepper'), 'utf8');
    const ca = await readFile(join(ambiente.diretorio, 'pki-mtls', 'ca-interna.pem'), 'utf8');

    await prepararSegredosDoSigner(ambiente);

    assert.equal(await readFile(join(ambiente.diretorio, 'signer-pepper'), 'utf8'), pepper);
    assert.equal(await readFile(join(ambiente.diretorio, 'pki-mtls', 'ca-interna.pem'), 'utf8'), ca);
  });

  it('forcar renova a PKI, mas nunca o pepper', async () => {
    const ambiente = await novoAmbiente();

    await prepararSegredosDoSigner(ambiente);
    const pepper = await readFile(join(ambiente.diretorio, 'signer-pepper'), 'utf8');
    const ca = await readFile(join(ambiente.diretorio, 'pki-mtls', 'ca-interna.pem'), 'utf8');

    await prepararSegredosDoSigner({ ...ambiente, forcar: true });

    assert.equal(await readFile(join(ambiente.diretorio, 'signer-pepper'), 'utf8'), pepper);
    assert.notEqual(await readFile(join(ambiente.diretorio, 'pki-mtls', 'ca-interna.pem'), 'utf8'), ca);
  });

  it('sem nenhuma raiz ICP de teste falha dizendo o que rodar, em vez de subir dublês que confiam em nada', async () => {
    const ambiente = await novoAmbiente({ comRaizes: false });

    await assert.rejects(prepararSegredosDoSigner(ambiente), /cofre:pki-teste/u);
  });
});
