import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';

export const obterUrlDoBanco = (): string => {
  const url = process.env['DATABASE_URL'];

  if (!url) {
    throw new Error('DATABASE_URL não definida: copie .env.example para .env antes de rodar.');
  }

  return url;
};

/**
 * Conexão OCIOSA derrubada pelo servidor (reinício, `pg_terminate_backend`): o pool já a descarta,
 * mas emite `error` — e evento `error` sem ouvinte derruba o processo Node. Só o código vai ao aviso.
 */
const tratarQuedaDeConexaoOciosa = (pool: Pool): Pool => {
  pool.on('error', (erro: Error & { code?: string }) => {
    process.emitWarning(`conexão ociosa do PostgreSQL encerrada pelo servidor: ${erro.code ?? erro.name}`);
  });

  return pool;
};

export const criarPool = (url: string = obterUrlDoBanco()): Pool =>
  tratarQuedaDeConexaoOciosa(new Pool({ connectionString: url, max: 10 }));

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

  // A senha de desenvolvimento do papel é pública no repositório: fora do ambiente local a
  // aplicação exige a URL própria, em vez de conectar com credencial conhecida.
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error('DATABASE_APP_URL não definida: produção não usa a credencial local do papel da aplicação.');
  }

  const url = new URL(obterUrlDoBanco());
  url.username = 'contaia_app';
  url.password = 'contaia_app_local';

  return url.toString();
};

export const criarPoolDaAplicacao = (url: string = obterUrlDaAplicacao()): Pool =>
  tratarQuedaDeConexaoOciosa(new Pool({ connectionString: url, max: 10 }));
