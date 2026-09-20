/**
 * A resolução de identidade é o único caminho que lê `app.usuario` sem contexto
 * de tenant. Estes testes provam que ele é estreito: devolve o par do próprio
 * `sub` e nada mais.
 */
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { criarPool } from './client.js';

const poolAdmin = criarPool();
let poolApp: Pool;
let tenantA = '';
let tenantB = '';

const urlDaAplicacao = (): string => {
  const url = new URL(process.env['DATABASE_URL'] ?? '');
  url.username = 'contaia_app';
  url.password = 'contaia_app_local';

  return url.toString();
};

beforeAll(async () => {
  const { rows } = await poolAdmin.query<{ id: string }>(
    `insert into app.tenant (cnpj, razao_social, status)
     values ('22333444000195', 'Identidade A', 'CADASTRO_INCOMPLETO'),
            ('33444555000156', 'Identidade B', 'ATIVO')
     returning id`,
  );

  tenantA = rows[0]?.id ?? '';
  tenantB = rows[1]?.id ?? '';

  await poolAdmin.query(
    `insert into app.usuario (tenant_id, sub_oidc, email, nome, papel)
     values ($1, 'sub-identidade-a', 'a@escritorio.cnt.br', 'Admin A', 'admin_escritorio'),
            ($2, 'sub-identidade-b', 'b@escritorio.cnt.br', 'Admin B', 'admin_escritorio')`,
    [tenantA, tenantB],
  );

  poolApp = new Pool({ connectionString: urlDaAplicacao(), max: 5 });
});

afterAll(async () => {
  await poolAdmin.query('delete from app.usuario where tenant_id = any($1)', [[tenantA, tenantB]]);
  await poolAdmin.query('delete from app.tenant where id = any($1)', [[tenantA, tenantB]]);
  await poolApp.end();
  await poolAdmin.end();
});

describe('app.resolver_identidade', () => {
  it('resolve o tenant e o papel do próprio sub, sem contexto prévio', async () => {
    const { rows } = await poolApp.query<{
      tenant_id: string;
      papel: string;
      tenant_status: string;
    }>('select * from app.resolver_identidade($1)', ['sub-identidade-a']);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.tenant_id).toBe(tenantA);
    expect(rows[0]?.papel).toBe('admin_escritorio');
    expect(rows[0]?.tenant_status).toBe('CADASTRO_INCOMPLETO');
  });

  it('não devolve nada para um sub desconhecido', async () => {
    const { rows } = await poolApp.query('select * from app.resolver_identidade($1)', [
      'sub-que-nao-existe',
    ]);

    expect(rows).toHaveLength(0);
  });

  it('não devolve nada para usuário arquivado', async () => {
    await poolAdmin.query(
      `update app.usuario set situacao = 'arquivado' where sub_oidc = 'sub-identidade-b'`,
    );

    const { rows } = await poolApp.query('select * from app.resolver_identidade($1)', [
      'sub-identidade-b',
    ]);

    expect(rows).toHaveLength(0);

    await poolAdmin.query(
      `update app.usuario set situacao = 'ativo' where sub_oidc = 'sub-identidade-b'`,
    );
  });

  it('continua sem permitir leitura direta da tabela de usuários', async () => {
    // A função é o caminho estreito; a tabela permanece fechada sem contexto.
    const { rows } = await poolApp.query('select id from app.usuario');

    expect(rows).toHaveLength(0);
  });

  it('não expõe o usuário de um tenant ao resolver o sub de outro', async () => {
    const { rows } = await poolApp.query<{ tenant_id: string }>(
      'select * from app.resolver_identidade($1)',
      ['sub-identidade-a'],
    );

    expect(rows.map((linha) => linha.tenant_id)).not.toContain(tenantB);
  });
});
