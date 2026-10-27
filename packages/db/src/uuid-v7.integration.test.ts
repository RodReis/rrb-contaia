import { afterAll, describe, expect, it } from 'vitest';
import { criarPool } from './client.js';

const pool = criarPool();
afterAll(async () => { await pool.end(); });

describe('app.uuid_v7()', () => {
  it('grava versão 7 e variante RFC 9562 no byte correto', async () => {
    const { rows } = await pool.query<{ id: string; versao: string; variante: string }>(`
      select generated.id::text as id,
        substring(generated.id::text from 15 for 1) as versao,
        substring(generated.id::text from 20 for 1) as variante
      from generate_series(1, 64) as n
      cross join lateral (select app.uuid_v7() as id where n is not null) generated`);

    expect(rows).toHaveLength(64);
    for (const row of rows) {
      expect(row.versao).toBe('7');
      expect(row.variante).toMatch(/^[89ab]$/);
      expect(row.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
  }, 15_000);
});
