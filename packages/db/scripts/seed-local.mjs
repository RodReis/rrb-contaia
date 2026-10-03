/**
 * Seed do ambiente local (SPEC-001 §2).
 *
 * Cria, de forma idempotente, o tenant mínimo em `CADASTRO_INCOMPLETO` e o
 * usuário do produto associado ao `sub` da identidade que já existe no
 * Keycloak. A identidade vem do realm importado; aqui só se faz a associação,
 * porque estado cadastral e tenant pertencem ao PostgreSQL (ADR-011).
 *
 * Uso: node scripts/seed/seed-local.mjs
 */
import { Pool } from 'pg';

const KEYCLOAK_URL = process.env.KEYCLOAK_URL ?? 'http://127.0.0.1:18080';
const REALM = process.env.KEYCLOAK_REALM ?? 'contaia';
const ADMIN = process.env.KEYCLOAK_ADMIN ?? 'admin';
const ADMIN_SENHA = process.env.KEYCLOAK_ADMIN_PASSWORD ?? 'admin_local';
const USUARIO_SEED = process.env.SEED_USERNAME ?? 'admin.escritorio';
const EMAIL_SEED = process.env.SEED_EMAIL ?? 'admin@escritorio.cnt.br';

const obterTokenAdmin = async () => {
  const resposta = await fetch(
    `${KEYCLOAK_URL}/realms/master/protocol/openid-connect/token`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: 'admin-cli',
        username: ADMIN,
        password: ADMIN_SENHA,
      }),
    },
  );

  if (!resposta.ok) {
    throw new Error(
      `não foi possível autenticar no Keycloak (${resposta.status}). O serviço está no ar?`,
    );
  }

  const corpo = await resposta.json();

  return corpo.access_token;
};

const obterSubDoUsuario = async (token) => {
  const resposta = await fetch(
    `${KEYCLOAK_URL}/admin/realms/${REALM}/users?username=${encodeURIComponent(USUARIO_SEED)}&exact=true`,
    { headers: { authorization: `Bearer ${token}` } },
  );

  if (!resposta.ok) {
    throw new Error(`falha ao consultar o usuário no realm ${REALM} (${resposta.status})`);
  }

  const usuarios = await resposta.json();
  const usuario = usuarios[0];

  if (usuario === undefined) {
    throw new Error(
      `usuário '${USUARIO_SEED}' não existe no realm '${REALM}'. Recrie o container do Keycloak para reimportar o realm.`,
    );
  }

  return usuario.id;
};

const semearBanco = async (sub) => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    const cliente = await pool.connect();

    try {
      await cliente.query('begin');

      // Idempotente: rodar de novo não duplica tenant nem usuário.
      const existente = await cliente.query(
        'select tenant_id from app.usuario where sub_oidc = $1',
        [sub],
      );

      if (existente.rows.length > 0) {
        await cliente.query('commit');
        console.warn(`[seed] usuário já associado ao tenant ${existente.rows[0].tenant_id}`);

        return;
      }

      const tenant = await cliente.query(
        `insert into app.tenant (razao_social, status)
         values ($1, 'CADASTRO_INCOMPLETO')
         returning id`,
        ['Escritório em cadastro'],
      );

      const tenantId = tenant.rows[0].id;

      const usuario = await cliente.query(
        `insert into app.usuario (tenant_id, sub_oidc, email, nome, estado)
         values ($1, $2, $3, $4, 'ATIVO')
         returning id`,
        [tenantId, sub, EMAIL_SEED, 'Rodrigo Administrador'],
      );

      await cliente.query(
        `insert into app.usuario_papel (tenant_id, usuario_id, papel)
         values ($1, $2, 'admin_escritorio')`,
        [tenantId, usuario.rows[0].id],
      );

      await cliente.query('commit');
      console.warn(`[seed] tenant ${tenantId} criado em CADASTRO_INCOMPLETO`);
      console.warn(`[seed] usuário ${USUARIO_SEED} (sub ${sub}) associado`);
    } catch (erro) {
      await cliente.query('rollback');
      throw erro;
    } finally {
      cliente.release();
    }
  } finally {
    await pool.end();
  }
};

const token = await obterTokenAdmin();
const sub = await obterSubDoUsuario(token);
await semearBanco(sub);
