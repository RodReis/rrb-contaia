/**
 * Isolamento de tenant nas tabelas da SPEC-001 (TESTING.md §3.1).
 *
 * Roda com a role `contaia_app`, que não tem BYPASSRLS: é o caminho de
 * aplicação real, não o do superusuário do Compose.
 */
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { criarPool } from './client.js';

const TABELAS_DA_FATIA = [
  'tenant',
  'usuario',
  'escritorio_endereco',
  'escritorio_arquivo',
] as const;

const urlDaAplicacao = (): string => {
  const url = new URL(process.env['DATABASE_URL'] ?? '');
  url.username = 'contaia_app';
  url.password = 'contaia_app_local';

  return url.toString();
};

const poolAdmin = criarPool();
let poolApp: Pool;
let tenantA = '';
let tenantB = '';

/** Executa no contexto de um tenant, como a API faz a cada requisição. */
const comTenant = async <T>(
  tenantId: string | null,
  executar: (cliente: PoolClient) => Promise<T>,
): Promise<T> => {
  const cliente = await poolApp.connect();

  try {
    await cliente.query('begin');

    if (tenantId !== null) {
      await cliente.query('select set_config($1, $2, true)', ['app.tenant_id', tenantId]);
    }

    const resultado = await executar(cliente);
    await cliente.query('commit');

    return resultado;
  } catch (erro) {
    await cliente.query('rollback');
    throw erro;
  } finally {
    cliente.release();
  }
};

/** CNPJs exclusivos desta suíte, para não colidir com dado de outra origem. */
const CNPJ_A = '19131243000197';
const CNPJ_B = '27865757000102';

beforeAll(async () => {
  // Resíduo de uma execução anterior faria o INSERT abaixo violar a unicidade
  // e a suíte inteira seria pulada — 13 provas de isolamento desaparecendo sem
  // falha explícita. A suíte limpa o que ela mesma cria antes de começar.
  await poolAdmin.query(
    `delete from app.escritorio_endereco where tenant_id in
       (select id from app.tenant where cnpj = any($1) or razao_social = any($2))`,
    [[CNPJ_A, CNPJ_B], ['Escritório A', 'Escritório B']],
  );
  await poolAdmin.query(
    `delete from app.tenant where cnpj = any($1) or razao_social = any($2)`,
    [[CNPJ_A, CNPJ_B], ['Escritório A', 'Escritório B']],
  );

  // Os dois tenants são semeados pela role dona da tabela, fora do caminho de
  // aplicação: o que se prova adiante é o acesso, não a criação.
  const { rows } = await poolAdmin.query<{ id: string }>(
    `insert into app.tenant (cnpj, razao_social)
     values ($1, 'Escritório A'), ($2, 'Escritório B')
     returning id`,
    [CNPJ_A, CNPJ_B],
  );

  tenantA = rows[0]?.id ?? '';
  tenantB = rows[1]?.id ?? '';

  await poolAdmin.query(
    `insert into app.escritorio_endereco
       (tenant_id, principal, cep, logradouro, numero, bairro, municipio, uf)
     values ($1, true, '01310100', 'Avenida Paulista', '1000', 'Bela Vista', 'São Paulo', 'SP'),
            ($2, true, '30130010', 'Avenida Afonso Pena', '500', 'Centro', 'Belo Horizonte', 'MG')`,
    [tenantA, tenantB],
  );

  poolApp = new Pool({ connectionString: urlDaAplicacao(), max: 5 });
});

afterAll(async () => {
  await poolAdmin.query('delete from app.escritorio_endereco where tenant_id = any($1)', [
    [tenantA, tenantB],
  ]);
  await poolAdmin.query('delete from app.tenant where id = any($1)', [[tenantA, tenantB]]);
  await poolApp.end();
  await poolAdmin.end();
});

describe('consulta sem contexto de tenant (invariante I-2)', () => {
  it.each(TABELAS_DA_FATIA)('não retorna nada de app.%s', async (tabela) => {
    const linhas = await comTenant(null, async (cliente) =>
      cliente.query(`select 1 from app.${tabela}`),
    );

    expect(linhas.rowCount).toBe(0);
  });
});

describe('leitura entre tenants', () => {
  it('o tenant A lê o próprio escritório', async () => {
    const { rows } = await comTenant(tenantA, async (cliente) =>
      cliente.query<{ id: string }>('select id from app.tenant'),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(tenantA);
  });

  it('o tenant A não lê o escritório do tenant B nem sabendo o id', async () => {
    const { rows } = await comTenant(tenantA, async (cliente) =>
      cliente.query('select id from app.tenant where id = $1', [tenantB]),
    );

    expect(rows).toHaveLength(0);
  });

  it('o tenant A não lê endereço do tenant B', async () => {
    const { rows } = await comTenant(tenantA, async (cliente) =>
      cliente.query('select id from app.escritorio_endereco where tenant_id = $1', [tenantB]),
    );

    expect(rows).toHaveLength(0);
  });
});

describe('escrita entre tenants', () => {
  it('o tenant A não altera o escritório do tenant B', async () => {
    const alteradas = await comTenant(tenantA, async (cliente) => {
      const resultado = await cliente.query('update app.tenant set razao_social = $1 where id = $2', [
        'Invadido',
        tenantB,
      ]);

      return resultado.rowCount;
    });

    expect(alteradas).toBe(0);

    const { rows } = await poolAdmin.query<{ razao_social: string }>(
      'select razao_social from app.tenant where id = $1',
      [tenantB],
    );

    expect(rows[0]?.razao_social).toBe('Escritório B');
  });

  it('o tenant A não insere endereço no tenant B', async () => {
    await expect(
      comTenant(tenantA, async (cliente) =>
        cliente.query(
          `insert into app.escritorio_endereco
             (tenant_id, principal, cep, logradouro, numero, bairro, municipio, uf)
           values ($1, false, '01310100', 'Rua Falsa', '1', 'Centro', 'São Paulo', 'SP')`,
          [tenantB],
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('o tenant A não apaga endereço do tenant B', async () => {
    // Duas barreiras protegem a linha: a política de RLS e a ausência de GRANT
    // de DELETE (I-7). Qualquer uma que atue satisfaz o contrato — o que não
    // pode acontecer é a linha do outro tenant desaparecer.
    const apagadas = await comTenant(tenantA, async (cliente) => {
      const resultado = await cliente.query(
        'delete from app.escritorio_endereco where tenant_id = $1',
        [tenantB],
      );

      return resultado.rowCount;
    }).catch((erro: unknown) => {
      expect(String(erro)).toMatch(/permission denied|row-level security/i);

      return 0;
    });

    expect(apagadas).toBe(0);

    const { rows } = await poolAdmin.query(
      'select id from app.escritorio_endereco where tenant_id = $1',
      [tenantB],
    );

    expect(rows).toHaveLength(1);
  });
});

describe('unicidade global do CNPJ do escritório', () => {
  it('recusa um segundo escritório com o mesmo CNPJ', async () => {
    await expect(
      poolAdmin.query(`insert into app.tenant (cnpj, razao_social) values ($1, 'Clone')`, [
        CNPJ_A,
      ]),
    ).rejects.toThrow(/duplicate key|unique/i);
  });
});

describe('endereço principal', () => {
  it('recusa um segundo endereço principal ativo no mesmo tenant', async () => {
    await expect(
      poolAdmin.query(
        `insert into app.escritorio_endereco
           (tenant_id, principal, cep, logradouro, numero, bairro, municipio, uf)
         values ($1, true, '01310100', 'Rua Dois', '2', 'Centro', 'São Paulo', 'SP')`,
        [tenantA],
      ),
    ).rejects.toThrow(/duplicate key|unique/i);
  });

  it('aceita endereço não principal no mesmo tenant', async () => {
    const { rows } = await poolAdmin.query<{ id: string }>(
      `insert into app.escritorio_endereco
         (tenant_id, principal, cep, logradouro, numero, bairro, municipio, uf)
       values ($1, false, '01310100', 'Rua Três', '3', 'Centro', 'São Paulo', 'SP')
       returning id`,
      [tenantA],
    );

    expect(rows[0]?.id).toBeDefined();
  });
});
