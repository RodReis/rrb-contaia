import { afterAll, describe, expect, it } from 'vitest';
import { criarPool } from './client.js';
import { verificarSaudeDoBanco, verificarRoleDaAplicacao } from './health.js';

const pool = criarPool();

afterAll(async () => {
  await pool.end();
});

describe('saúde do PostgreSQL local', () => {
  it('responde ao select de sanidade', async () => {
    await expect(verificarSaudeDoBanco(pool)).resolves.toEqual({ ok: true });
  });

  it('mantém a role da aplicação sem BYPASSRLS', async () => {
    const role = await verificarRoleDaAplicacao(pool, 'contaia_app');

    expect(role).toEqual({ existe: true, bypassRls: false, superusuario: false });
  });
});
