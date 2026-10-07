#!/usr/bin/env node
import { readFile, access } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);

const REQUIRED_PACKAGES = [
  'apps/web',
  'apps/api',
  'apps/workers',
  'apps/signer',
  'apps/cofre',
  'packages/config',
  'packages/shared',
  'packages/domain',
  'packages/db',
  'packages/signer-client',
];

const REQUIRED_FILES = [
  'package.json',
  'pnpm-workspace.yaml',
  'turbo.json',
  'tsconfig.base.json',
  '.nvmrc',
  '.npmrc',
  '.env.example',
  'infra/docker/compose.yml',
  'infra/docker/vault/bootstrap.mjs',
];

const REQUIRED_SCRIPTS = [
  'build',
  'lint',
  'typecheck',
  'test:regras',
  'test:banco',
  'test:tela',
  'test:e2e',
];

const errors = [];

const fail = (message) => errors.push(message);

for (const file of REQUIRED_FILES) {
  try {
    await access(new URL(file, root));
  } catch {
    fail(`Arquivo obrigatório ausente: ${file}`);
  }
}

let pkg;
try {
  pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
} catch {
  fail('package.json da raiz não pôde ser lido');
}

if (pkg) {
  if (pkg.engines?.node !== '>=24 <25') fail('Node 24 não está fixado em engines.node');
  if (pkg.packageManager !== 'pnpm@10.33.2') fail('pnpm 10.33.2 não está fixado em packageManager');
  for (const script of REQUIRED_SCRIPTS) {
    if (!pkg.scripts?.[script]) fail(`Script obrigatório ausente na raiz: ${script}`);
  }
}

let workspace;
try {
  workspace = await readFile(new URL('pnpm-workspace.yaml', root), 'utf8');
} catch {
  fail('pnpm-workspace.yaml não pôde ser lido');
}

if (workspace) {
  for (const dir of ['apps/*', 'packages/*']) {
    if (!workspace.includes(dir)) fail(`Workspace não declara o glob: ${dir}`);
  }
}

for (const dir of REQUIRED_PACKAGES) {
  try {
    const manifest = JSON.parse(await readFile(new URL(`${dir}/package.json`, root), 'utf8'));
    if (!manifest.name?.startsWith('@contaia/')) {
      fail(`Pacote ${dir} deve usar o escopo @contaia/`);
    }
    if (manifest.private !== true) {
      fail(`Pacote ${dir} deve ser private`);
    }
  } catch {
    fail(`Pacote obrigatório ausente ou inválido: ${dir}/package.json`);
  }
}

// Workflow invalido falha no runner em 0s, sem reportar check algum na PR — o
// que deixa a PR sem prova em vez de vermelha. Um `: ` dentro de um escalar nao
// citado basta para isso, entao o parse e verificado aqui.
const workflow = await readFile(new URL('.github/workflows/ci.yml', root), 'utf8').catch(
  () => null,
);

if (workflow === null) {
  fail('.github/workflows/ci.yml ausente');
} else {
  try {
    const { parse } = await import('yaml');
    const documento = parse(workflow);
    const jobs = Object.keys(documento?.jobs ?? {});

    if (!jobs.includes('gate')) fail('ci.yml não declara o job `gate`');
  } catch (erro) {
    fail(`ci.yml não é YAML válido: ${erro instanceof Error ? erro.message : String(erro)}`);
  }
}

const nvmrc = await readFile(new URL('.nvmrc', root), 'utf8').catch(() => null);
if (nvmrc !== null && nvmrc.trim() !== '24.15.0') {
  fail(`.nvmrc deve fixar 24.15.0 (encontrado: ${nvmrc.trim()})`);
}

if (errors.length > 0) {
  for (const error of errors) console.error(`✗ ${error}`);
  console.error(`\n${errors.length} problema(s) estrutural(is) no workspace.`);
  process.exit(1);
}

console.log('✓ Workspace válido: arquivos, engines, scripts e pacotes obrigatórios presentes.');
