/**
 * Anti-drift de schema (TESTING.md §3.1, CI-PR.md §4).
 *
 * Varre `app` e falha se uma tabela nova escapar de `tenant_id`, do índice ou
 * da RLS por esquecimento. Este teste não pode ser removido: é o que impede
 * que a próxima fatia crie tabela sem isolamento.
 */
import { afterAll, describe, expect, it } from 'vitest';

import { criarPool } from './client.js';

const pool = criarPool();

/**
 * `app.tenant` é a raiz do isolamento: a própria linha é o tenant, então o
 * isolamento vem da PK e não de uma coluna `tenant_id`. Toda outra tabela do
 * schema precisa da coluna.
 */
const TABELAS_RAIZ = new Set(['tenant']);

const tabelasDoSchema = async (): Promise<string[]> => {
  const { rows } = await pool.query<{ tablename: string }>(
    `select tablename from pg_tables where schemaname = 'app' order by tablename`,
  );

  return rows.map((linha) => linha.tablename);
};

describe('anti-drift do schema app', () => {
  // As migrations são aplicadas antes da suíte (`pnpm db:migrate`, passo próprio
  // da CI). Aplicá-las aqui faria as suítes de banco, que rodam em paralelo,
  // disputarem a mesma tabela de controle.
  it('há tabelas para varrer', async () => {
    expect((await tabelasDoSchema()).length).toBeGreaterThan(0);
  });

  it('toda tabela tem RLS habilitada e forçada', async () => {
    const { rows } = await pool.query<{
      tablename: string;
      rowsecurity: boolean;
      forcerowsecurity: boolean;
    }>(
      `select c.relname as tablename, c.relrowsecurity as rowsecurity,
              c.relforcerowsecurity as forcerowsecurity
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'app' and c.relkind = 'r'`,
    );

    const semRls = rows.filter((linha) => !linha.rowsecurity || !linha.forcerowsecurity);

    expect(semRls.map((linha) => linha.tablename)).toEqual([]);
  });

  it('toda tabela tem ao menos uma política de RLS', async () => {
    const tabelas = await tabelasDoSchema();
    const { rows } = await pool.query<{ tablename: string }>(
      `select distinct tablename from pg_policies where schemaname = 'app'`,
    );

    const comPolitica = new Set(rows.map((linha) => linha.tablename));
    const semPolitica = tabelas.filter((tabela) => !comPolitica.has(tabela));

    expect(semPolitica).toEqual([]);
  });

  it('toda tabela não-raiz tem tenant_id NOT NULL', async () => {
    const tabelas = await tabelasDoSchema();
    const { rows } = await pool.query<{ table_name: string; is_nullable: string }>(
      `select table_name, is_nullable
         from information_schema.columns
        where table_schema = 'app' and column_name = 'tenant_id'`,
    );

    const porTabela = new Map(rows.map((linha) => [linha.table_name, linha.is_nullable]));

    const irregulares = tabelas
      .filter((tabela) => !TABELAS_RAIZ.has(tabela))
      .filter((tabela) => porTabela.get(tabela) !== 'NO');

    expect(irregulares).toEqual([]);
  });

  it('toda tabela não-raiz tem índice sobre tenant_id', async () => {
    const tabelas = await tabelasDoSchema();
    const { rows } = await pool.query<{ tablename: string; indexdef: string }>(
      `select tablename, indexdef from pg_indexes where schemaname = 'app'`,
    );

    const semIndice = tabelas
      .filter((tabela) => !TABELAS_RAIZ.has(tabela))
      .filter(
        (tabela) =>
          !rows.some(
            (indice) => indice.tablename === tabela && indice.indexdef.includes('tenant_id'),
          ),
      );

    expect(semIndice).toEqual([]);
  });

  it('a role da aplicação não tem DELETE nas tabelas desta fatia', async () => {
    // I-7: registro fiscal não se apaga, arquiva-se. Sem GRANT de DELETE o
    // arquivamento é o único caminho possível pela aplicação.
    const { rows } = await pool.query<{ table_name: string }>(
      `select table_name from information_schema.role_table_grants
        where grantee = 'contaia_app' and table_schema = 'app' and privilege_type = 'DELETE'`,
    );

    expect(rows.map((linha) => linha.table_name)).toEqual([]);
  });
});

afterAll(async () => {
  await pool.end();
});
