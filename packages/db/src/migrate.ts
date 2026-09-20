import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Pool } from 'pg';
import { criarPool } from './client.js';

/** Resolve a partir da raiz do pacote: vale para `src/` e para `dist/`. */
const PASTA_MIGRATIONS = new URL('../migrations/', import.meta.url);


const CRIAR_CONTROLE = `
  CREATE TABLE IF NOT EXISTS public.__migrations (
    nome text PRIMARY KEY,
    aplicada_em timestamptz NOT NULL DEFAULT now()
  )
`;

export const listarMigrations = async (): Promise<string[]> => {
  const arquivos = await readdir(fileURLToPath(PASTA_MIGRATIONS));
  return arquivos.filter((nome) => nome.endsWith('.sql')).sort();
};

export const aplicarMigrations = async (pool: Pool): Promise<string[]> => {
  await pool.query(CRIAR_CONTROLE);

  const { rows } = await pool.query<{ nome: string }>('select nome from public.__migrations');
  const jaAplicadas = new Set(rows.map((linha) => linha.nome));

  const aplicadas: string[] = [];

  for (const nome of await listarMigrations()) {
    if (jaAplicadas.has(nome)) continue;

    const sql = await readFile(new URL(nome, PASTA_MIGRATIONS), 'utf8');
    const cliente = await pool.connect();

    try {
      await cliente.query('begin');
      await cliente.query(sql);
      await cliente.query('insert into public.__migrations (nome) values ($1)', [nome]);
      await cliente.query('commit');
      aplicadas.push(nome);
    } catch (erro) {
      await cliente.query('rollback');
      throw erro;
    } finally {
      cliente.release();
    }
  }

  return aplicadas;
};

/**
 * Execução como script.
 *
 * O `await` fica dentro da função: um top-level await aqui tornaria todo o
 * pacote um módulo assíncrono, e a API (CommonJS) não consegue `require()` um
 * grafo ESM com TLA — o processo nem sobe.
 */
export const executarMigrations = async (): Promise<void> => {
  const pool = criarPool();

  try {
    const aplicadas = await aplicarMigrations(pool);

    console.warn(
      aplicadas.length > 0
        ? `[db] migrations aplicadas: ${aplicadas.join(', ')}`
        : '[db] nenhuma migration pendente',
    );
  } finally {
    await pool.end();
  }
};

const executadoComoScript =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (executadoComoScript) {
  void executarMigrations().catch((erro: unknown) => {
    console.error('[db] falha ao aplicar migrations', erro);
    process.exitCode = 1;
  });
}
