#!/usr/bin/env node
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Consolida os JUnit de uma categoria num resumo rastreavel por SPEC/issue
 * (TESTING.md §7). Sem JUnit a categoria vira `not_run` com motivo — nunca `pass`.
 *
 * uso: node scripts/ci/write-summary.mjs <categoria> <escopo> [motivo-do-not-run]
 */

const [, , categoria, escopo, motivoInformado] = process.argv;

if (!categoria || !escopo) {
  console.error('uso: node scripts/ci/write-summary.mjs <categoria> <escopo> [motivo]');
  process.exit(2);
}

const raiz = join('test-results', escopo);

/** Cada pacote escreve em `<pacote>/test-results/<categoria>/`; o E2E, na raiz. */
const PASTAS_DE_PACOTE = ['apps', 'packages'];

const listarJunit = async (diretorio) => {
  const encontrados = [];

  const percorrer = async (atual) => {
    let entradas;
    try {
      entradas = await readdir(atual, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entrada of entradas) {
      const caminho = join(atual, entrada.name);
      if (entrada.isDirectory()) await percorrer(caminho);
      else if (entrada.name.endsWith('.xml')) encontrados.push(caminho);
    }
  };

  await percorrer(diretorio);
  return encontrados;
};

const somarAtributo = (xml, atributo) => {
  const padrao = new RegExp(`<testsuites[^>]*\\b${atributo}="(\\d+)"`, 'g');
  let total = 0;
  let houve = false;

  for (const casamento of xml.matchAll(padrao)) {
    houve = true;
    total += Number(casamento[1]);
  }

  if (houve) return total;

  const porSuite = new RegExp(`<testsuite\\b[^>]*\\b${atributo}="(\\d+)"`, 'g');
  for (const casamento of xml.matchAll(porSuite)) total += Number(casamento[1]);

  return total;
};

const coletarDosPacotes = async () => {
  const encontrados = [];

  for (const grupo of PASTAS_DE_PACOTE) {
    let pacotes;
    try {
      pacotes = await readdir(grupo, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const pacote of pacotes) {
      if (!pacote.isDirectory()) continue;
      encontrados.push(...(await listarJunit(join(grupo, pacote.name, 'test-results', categoria))));
    }
  }

  return encontrados;
};

const arquivos = [...(await listarJunit(join(raiz, categoria))), ...(await coletarDosPacotes())];

let total = 0;
let falhou = 0;
let pulado = 0;

for (const arquivo of arquivos) {
  const xml = await readFile(arquivo, 'utf8');
  total += somarAtributo(xml, 'tests');
  falhou += somarAtributo(xml, 'failures') + somarAtributo(xml, 'errors');
  pulado += somarAtributo(xml, 'skipped');
}

const semEvidencia = arquivos.length === 0;

// Sem relatorio e sem motivo declarado, a categoria fica `not_run` SEM motivo de
// proposito: o gate reprova. Transformar ausencia de prova em passe silencioso e
// exatamente o que CI-PR.md §4 proibe.
const motivo = motivoInformado ?? null;

const resumo = {
  categoria,
  escopo,
  total,
  passou: Math.max(total - falhou - pulado, 0),
  falhou,
  pulado,
  not_run: semEvidencia ? 1 : 0,
  motivo,
  arquivos,
  duracao_ms: Number(process.env['DURACAO_MS'] ?? 0),
  gerado_em: new Date().toISOString(),
};

const pastaResumos = join(raiz, 'resumos');
await mkdir(pastaResumos, { recursive: true });
await writeFile(join(pastaResumos, `${categoria}.json`), `${JSON.stringify(resumo, null, 2)}\n`);

console.log(
  `[resumo] ${categoria}: ${resumo.passou}/${resumo.total} passou, ${resumo.falhou} falhou` +
    (resumo.not_run ? `, not_run (${resumo.motivo ?? 'SEM MOTIVO DECLARADO'})` : ''),
);
