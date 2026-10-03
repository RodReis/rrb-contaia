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

/**
 * URL do papel da aplicação (`contaia_app`, sem SUPERUSER nem BYPASSRLS). É o
 * único que a API usa: com o superusuário das migrations a RLS não valeria.
 * `DATABASE_APP_URL` vence; sem ela, troca usuário e senha da `DATABASE_URL`
 * pelas do papel criado no bootstrap (migration 0000).
 */
export const obterUrlDaAplicacao = (): string => {
  const explicita = process.env['DATABASE_APP_URL'];

  if (explicita) {
    return explicita;
  }

  const url = new URL(obterUrlDoBanco());
  url.username = 'contaia_app';
  url.password = 'contaia_app_local';

  return url.toString();
};

export const criarPoolDaAplicacao = (url: string = obterUrlDaAplicacao()): Pool =>
  new Pool({ connectionString: url, max: 10 });
