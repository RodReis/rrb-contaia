#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Categorias que o gate exige — ausencia nao e sucesso (CI-PR.md §2). */
export const CATEGORIAS_OBRIGATORIAS = ['quality', 'regras', 'banco', 'tela', 'e2e'];

/**
 * @typedef {{ categoria: string, total: number, passou: number, falhou: number,
 *   pulado: number, not_run: number, motivo: string | null, duracao_ms: number }} Resumo
 */

/** @param {Resumo[]} resumos */
export const validarResumos = (resumos) => {
  const problemas = [];
  const porCategoria = new Map(resumos.map((r) => [r.categoria, r]));

  for (const categoria of CATEGORIAS_OBRIGATORIAS) {
    const resumo = porCategoria.get(categoria);

    if (!resumo) {
      problemas.push(`categoria obrigatória não reportou: ${categoria}`);
      continue;
    }

    if (resumo.falhou > 0) {
      problemas.push(`categoria ${categoria} tem ${resumo.falhou} teste(s) falhando`);
    }

    // not_run sem motivo declarado é mentira na evidência (TESTING.md §7).
    if (resumo.not_run > 0 && !resumo.motivo) {
      problemas.push(`categoria ${categoria} tem not_run sem motivo declarado`);
    }

    if (resumo.total === 0 && resumo.not_run === 0) {
      problemas.push(`categoria ${categoria} reportou zero teste e zero not_run`);
    }
  }

  return problemas;
};

export const lerResumos = async (diretorio) => {
  const entradas = await readdir(diretorio, { withFileTypes: true });
  const resumos = [];

  for (const entrada of entradas) {
    if (!entrada.isFile() || !entrada.name.endsWith('.json')) continue;
    resumos.push(JSON.parse(await readFile(join(diretorio, entrada.name), 'utf8')));
  }

  return resumos;
};

const executadoComoScript = process.argv[1]?.endsWith('validate-gate.mjs') === true;

if (executadoComoScript) {
  const diretorio = process.argv[2];

  if (!diretorio) {
    console.error('uso: node scripts/ci/validate-gate.mjs <diretorio-de-resumos>');
    process.exit(2);
  }

  const problemas = validarResumos(await lerResumos(diretorio));

  if (problemas.length > 0) {
    for (const problema of problemas) console.error(`✗ ${problema}`);
    console.error(`\ngate reprovado: ${problemas.length} problema(s).`);
    process.exit(1);
  }

  console.log('✓ gate aprovado: todas as categorias obrigatórias reportaram.');
}
