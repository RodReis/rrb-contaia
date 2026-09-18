import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';

export const obterUrlDoBanco = (): string => {
  const url = process.env['DATABASE_URL'];

  if (!url) {
    throw new Error('DATABASE_URL não definida: copie .env.example para .env antes de rodar.');
  }

  return url;
};

export const criarPool = (url: string = obterUrlDoBanco()): Pool =>
  new Pool({ connectionString: url, max: 10 });

export const criarDb = (pool: Pool): NodePgDatabase => drizzle(pool);
