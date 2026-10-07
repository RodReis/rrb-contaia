#!/usr/bin/env node
/**
 * Prepara, em `infra/docker/.vault-local/`, os segredos de TESTE que o Compose monta nos
 * contêineres do Signer, da API, dos workers e dos dublês (SPEC-012 / F12):
 *
 *   - `pki-mtls/`: as duas CAs de teste e as identidades de serviço (ver `gerar-pki-mtls-de-teste.mjs`);
 *   - `pki-mtls/ca-clientes-dos-dubles.pem`: as raízes ICP de TESTE do cofre (F11) em que os dublês
 *     confiam para aceitar o A1 como certificado cliente;
 *   - `signer-pepper`: o pepper do HMAC da chave idempotente.
 *
 * Idempotente. O pepper NUNCA é renovado: trocá-lo faria toda chave idempotente já gravada deixar de
 * ser encontrada. A PKI só é renovada com `--forcar`. Nada disto é versionado nem serve fora da
 * máquina de desenvolvimento ou da CI.
 *
 * uso: node scripts/preparar-segredos-do-signer.mjs [--forcar]    (`pnpm docker:up` já o executa)
 */
import { randomBytes } from 'node:crypto';
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { escreverPkiMtls } from './gerar-pki-mtls-de-teste.mjs';

const BYTES_DO_PEPPER = 48;
const MARCA_DE_PEM = '-----BEGIN CERTIFICATE-----';

const existe = (caminho) =>
  access(caminho).then(
    () => true,
    () => false,
  );

/** Reúne as raízes `.pem` do diretório num arquivo só; o que não for certificado fica de fora. */
const reunirRaizes = async (raizesIcpDir) => {
  const entradas = (await readdir(raizesIcpDir).catch(() => [])).filter((nome) => nome.endsWith('.pem')).sort();
  const pems = [];

  for (const nome of entradas) {
    const conteudo = await readFile(join(raizesIcpDir, nome), 'utf8');

    if (conteudo.includes(MARCA_DE_PEM)) {
      pems.push(conteudo.endsWith('\n') ? conteudo : `${conteudo}\n`);
    }
  }

  if (pems.length === 0) {
    throw new Error(
      `Nenhuma raiz ICP de teste em ${raizesIcpDir}. Rode \`pnpm cofre:pki-teste\` antes: sem ela os dublês não aceitariam nenhum A1 como cliente.`,
    );
  }

  return pems.join('');
};

export const prepararSegredosDoSigner = async ({ diretorio, raizesIcpDir, forcar = false, aleatorio = randomBytes }) => {
  const pasta = join(diretorio, 'pki-mtls');

  await mkdir(diretorio, { recursive: true });

  // Antes de gerar qualquer coisa: sem raízes não há o que preparar.
  const raizes = await reunirRaizes(raizesIcpDir);

  if (forcar || !(await existe(join(pasta, 'ca-interna.pem')))) {
    await escreverPkiMtls(pasta);
  }

  await writeFile(join(pasta, 'ca-clientes-dos-dubles.pem'), raizes);

  // Ponto de montagem do token que o bootstrap do Vault emite depois. Se o arquivo não existir, o
  // Docker cria uma PASTA com esse nome e o bootstrap passa a falhar com EISDIR. O bootstrap
  // regrava o conteúdo no mesmo arquivo (mesmo inode), então a montagem enxerga o token novo.
  const arquivoDoToken = join(diretorio, 'token-signer-leitura');

  if (!(await existe(arquivoDoToken))) {
    await writeFile(arquivoDoToken, '', { mode: 0o600 });
  }

  const arquivoDoPepper = join(diretorio, 'signer-pepper');

  if (!(await existe(arquivoDoPepper))) {
    await writeFile(arquivoDoPepper, `${aleatorio(BYTES_DO_PEPPER).toString('hex')}\n`, { mode: 0o600 });
  }
};

const lerArgumento = (nome, padrao) => {
  const indice = process.argv.indexOf(`--${nome}`);

  return indice > 0 && process.argv[indice + 1] ? process.argv[indice + 1] : padrao;
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const raizDoRepo = resolve(fileURLToPath(new URL('../', import.meta.url)));
  const diretorio = resolve(lerArgumento('saida', join(raizDoRepo, 'infra/docker/.vault-local')));
  const raizesIcpDir = resolve(
    lerArgumento('raizes', process.env['COFRE_RAIZES_ICP_DIR'] ?? join(diretorio, 'raizes-icp')),
  );

  await prepararSegredosDoSigner({ diretorio, raizesIcpDir, forcar: process.argv.includes('--forcar') });

  console.warn(`Segredos de teste do Signer prontos em ${diretorio}`);
}
