/**
 * Conexão encerrada pelo servidor (ex.: `idle_in_transaction_session_timeout`, reinício do banco).
 *
 * O `pg` emite `error` no cliente quando a sessão cai sem consulta em andamento. Sem ouvinte, esse
 * evento derruba o processo Node inteiro. Prova que: (1) dentro de uma transação, a falha chega ao
 * chamador como rejeição comum e a conexão quebrada sai do pool; (2) conexão ociosa derrubada no
 * pool também não derruba o processo.
 */
import { setTimeout as esperar } from 'node:timers/promises';

import { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

import { criarPool, criarPoolDaAplicacao, obterUrlDaAplicacao } from './client.js';
import { comContextoHumano } from './contexto.js';

const TENANT = '0197a1b2-0000-7000-8000-0000000000c1';
const USUARIO = '0197a1b2-0000-7000-8000-0000000000c2';

const admin = criarPool();
const soltos: unknown[] = [];
const registrarSolto = (erro: unknown): void => {
  soltos.push(erro);
};
process.on('uncaughtException', registrarSolto);

afterAll(async () => {
  process.removeListener('uncaughtException', registrarSolto);
  await admin.end();
});

describe('conexão derrubada pelo servidor', () => {
  it('no meio da transação: rejeição comum, sem evento solto, e o pool segue utilizável', async () => {
    // `max: 1`: se a conexão quebrada voltasse ao pool, a próxima transação falharia.
    const pool = new Pool({ connectionString: obterUrlDaAplicacao(), max: 1 });

    try {
      const falha = await comContextoHumano(pool, { tenantId: TENANT, usuarioId: USUARIO }, async (cliente) => {
        await cliente.query('select set_config($1, $2, true)', ['idle_in_transaction_session_timeout', '100ms']);
        await esperar(500);
        await cliente.query('select 1');
      }).catch((erro: unknown) => erro);

      expect(falha).toBeInstanceOf(Error);
      expect(soltos).toEqual([]);

      const depois = await comContextoHumano(pool, { tenantId: TENANT, usuarioId: USUARIO }, async (cliente) =>
        (await cliente.query<{ um: number }>('select 1 as um')).rows[0]?.um,
      );
      expect(depois).toBe(1);
    } finally {
      await pool.end();
    }
  });

  it('conexão ociosa derrubada no pool da aplicação não derruba o processo', async () => {
    const pool = criarPoolDaAplicacao();

    try {
      const cliente = await pool.connect();
      const pid = (await cliente.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0]!.pid;
      cliente.release();

      await admin.query('select pg_terminate_backend($1)', [pid]);
      await esperar(300);

      expect(soltos).toEqual([]);
      expect((await pool.query<{ um: number }>('select 1 as um')).rows[0]?.um).toBe(1);
    } finally {
      await pool.end();
    }
  });
});
