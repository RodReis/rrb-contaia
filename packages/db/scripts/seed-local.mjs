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

      // Keycloak recriado sem reset do Postgres: o e-mail é único globalmente
      // (SPEC-007), então em vez de criar um segundo tenant o seed reassocia o
      // usuário existente à identidade nova.
      const mesmoEmail = await cliente.query(
        'select id, tenant_id from app.usuario where lower(email) = lower($1)',
        [EMAIL_SEED],
      );

      if (mesmoEmail.rows.length > 0) {
        await cliente.query('update app.usuario set sub_oidc = $1 where id = $2', [
          sub,
          mesmoEmail.rows[0].id,
        ]);
        await cliente.query('commit');
        console.warn(
          `[seed] usuário ${EMAIL_SEED} do tenant ${mesmoEmail.rows[0].tenant_id} reassociado à identidade ${sub}`,
        );

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

/**
 * Catálogo tributário global (SPEC-016): fixtures de teste NÃO OFICIAIS, só para o ambiente local e
 * o E2E. Passam pelas mesmas funções `app.tax_rule_*` da API, sob o contexto de serviço do catálogo.
 * Mostram uma regra corrente (ICMS) e a transição IBS/CBS de 2026 para 2027 sem sobreposição.
 * Idempotente: roda de novo sem duplicar.
 */
const MARCA_DO_SEED_TRIBUTARIO = 'Fixture de teste não oficial (seed local F16)';
const AVISO_DO_SEED_TRIBUTARIO = 'Dado de teste não oficial: prova o comportamento do motor e não orienta o recolhimento de tributo.';
const ATOR_DO_SEED_TRIBUTARIO = '00000000-0000-4000-8000-000000000016';

const FIXTURES_TRIBUTARIAS = [
  { taxType: 'ICMS', regime: 'LUCRO_PRESUMIDO', validFrom: '2026-01-01', validUntil: null, rateBasisPoints: 1800 },
  { taxType: 'CBS', regime: 'SIMPLES_NACIONAL', validFrom: '2026-01-01', validUntil: '2026-12-31', rateBasisPoints: 90 },
  { taxType: 'CBS', regime: 'SIMPLES_NACIONAL', validFrom: '2027-01-01', validUntil: null, rateBasisPoints: 880 },
  { taxType: 'IBS_UF', regime: 'SIMPLES_NACIONAL', validFrom: '2026-01-01', validUntil: '2026-12-31', rateBasisPoints: 10 },
  { taxType: 'IBS_UF', regime: 'SIMPLES_NACIONAL', validFrom: '2027-01-01', validUntil: null, rateBasisPoints: 50 },
  { taxType: 'IBS_MUN', regime: 'SIMPLES_NACIONAL', validFrom: '2026-01-01', validUntil: '2026-12-31', rateBasisPoints: 0 },
  { taxType: 'IBS_MUN', regime: 'SIMPLES_NACIONAL', validFrom: '2027-01-01', validUntil: null, rateBasisPoints: 50 },
];

const semearCatalogoTributario = async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const cliente = await pool.connect();

  try {
    await cliente.query('begin');
    await cliente.query(
      `select set_config('app.origem', 'SERVICO', true), set_config('app.finalidade', 'CATALOGO_TRIBUTARIO', true),
              set_config('app.identidade_tecnica', 'api-catalogo-tributario', true),
              set_config('app.correlation_id', 'seed-local-f16', true),
              set_config('app.tenant_id', '', true), set_config('app.usuario_id', '', true),
              set_config('app.empresa_id', '', true), set_config('app.empresa_em_criacao', '', true)`,
    );

    const { rows } = await cliente.query(
      `select count(*)::int as total from app.tax_rule_version where source = $1`,
      [MARCA_DO_SEED_TRIBUTARIO],
    );

    if (rows[0].total > 0) {
      await cliente.query('commit');
      console.warn('[seed] catálogo tributário de teste já semeado');

      return;
    }

    for (const regra of FIXTURES_TRIBUTARIAS) {
      const criada = await cliente.query(
        'select * from app.tax_rule_create_draft($1, now(), $2, $3, $4, $5, $6, $7, null, $8, $9, $10)',
        [
          ATOR_DO_SEED_TRIBUTARIO,
          'seed-local-f16',
          regra.taxType,
          regra.regime,
          'VENDA_MERCADORIA',
          regra.validFrom,
          regra.validUntil,
          regra.rateBasisPoints,
          MARCA_DO_SEED_TRIBUTARIO,
          AVISO_DO_SEED_TRIBUTARIO,
        ],
      );

      await cliente.query('select * from app.tax_rule_publish($1, now(), $2, $3, $4)', [
        ATOR_DO_SEED_TRIBUTARIO,
        'seed-local-f16',
        criada.rows[0].id,
        criada.rows[0].lock_version,
      ]);
    }

    await cliente.query('commit');
    console.warn(`[seed] ${FIXTURES_TRIBUTARIAS.length} regras tributárias de teste (não oficiais) publicadas`);
  } catch (erro) {
    await cliente.query('rollback');
    throw erro;
  } finally {
    cliente.release();
    await pool.end();
  }
};

const token = await obterTokenAdmin();
const sub = await obterSubDoUsuario(token);
await semearBanco(sub);
await semearCatalogoTributario();
