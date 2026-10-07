/**
 * Preparação de ambiente das provas E2E que montam o próprio escritório (Keycloak + PostgreSQL):
 * identidades, escritório, usuários, empresas, carteira, login e limpeza. Isolamento por prefixo e
 * por CNPJ: cada spec cuida só do que criou, sem tocar o tenant do seed nem o das outras specs.
 */
import type { Page } from '@playwright/test';
import type { Pool } from 'pg';

export type Pessoa = Readonly<{ usuario: string; senha: string; nome: string }>;
export type PapelDeEscritorio = 'admin_escritorio' | 'contador' | 'auxiliar' | 'auditor_readonly';

const KEYCLOAK = (process.env['KEYCLOAK_ISSUER_URL'] ?? 'http://127.0.0.1:18080/realms/contaia').replace(
  /\/realms\/.*$/u,
  '',
);
const REALM = process.env['KEYCLOAK_REALM'] ?? 'contaia';

/** CNPJ com os dois dígitos verificadores corretos a partir dos 12 primeiros. */
export const cnpjValido = (raiz12: string): string => {
  const digito = (base: string, pesos: readonly number[]): number => {
    const soma = [...base].reduce((total, caractere, indice) => total + Number(caractere) * (pesos[indice] ?? 0), 0);
    const resto = soma % 11;

    return resto < 2 ? 0 : 11 - resto;
  };
  const primeiro = digito(raiz12, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const segundo = digito(`${raiz12}${primeiro}`, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);

  return `${raiz12}${primeiro}${segundo}`;
};

// -- Keycloak ------------------------------------------------------------------------------------

const tokenDeAdministracao = async (): Promise<string> => {
  const resposta = await fetch(`${KEYCLOAK}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: 'admin-cli',
      username: process.env['KEYCLOAK_ADMIN'] ?? 'admin',
      password: process.env['KEYCLOAK_ADMIN_PASSWORD'] ?? 'admin_local',
    }),
  });

  return ((await resposta.json()) as { access_token: string }).access_token;
};

export const removerIdentidadesComPrefixo = async (prefixo: string): Promise<void> => {
  const cabecalhos = { authorization: `Bearer ${await tokenDeAdministracao()}` };
  const resposta = await fetch(`${KEYCLOAK}/admin/realms/${REALM}/users?search=${prefixo}&max=200`, {
    headers: cabecalhos,
  });

  for (const usuario of (await resposta.json()) as Array<{ id: string }>) {
    await fetch(`${KEYCLOAK}/admin/realms/${REALM}/users/${usuario.id}`, { method: 'DELETE', headers: cabecalhos });
  }
};

export const criarIdentidade = async (pessoa: Pessoa): Promise<string> => {
  const criacao = await fetch(`${KEYCLOAK}/admin/realms/${REALM}/users`, {
    method: 'POST',
    headers: { authorization: `Bearer ${await tokenDeAdministracao()}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      username: pessoa.usuario,
      email: `${pessoa.usuario}@escritorio.local`,
      firstName: pessoa.nome,
      lastName: 'E2E',
      enabled: true,
      emailVerified: true,
      credentials: [{ type: 'password', value: pessoa.senha, temporary: false }],
    }),
  });

  if (criacao.status !== 201) {
    throw new Error(`Keycloak recusou criar ${pessoa.usuario} (${criacao.status})`);
  }

  return (criacao.headers.get('location') ?? '').split('/').pop() ?? '';
};

// -- Banco ---------------------------------------------------------------------------------------

/** Apaga TUDO dos escritórios com estes CNPJs (FKs e triggers desligados só nesta conexão). */
export const limparEscritorios = async (pool: Pool, cnpjs: readonly string[]): Promise<void> => {
  const { rows } = await pool.query<{ id: string }>('select id from app.tenant where cnpj = any($1)', [cnpjs]);
  const ids = rows.map((linha) => linha.id);

  if (ids.length === 0) {
    return;
  }

  const cliente = await pool.connect();

  try {
    await cliente.query("set session_replication_role = 'replica'");

    const tabelas = await cliente.query<{ table_name: string }>(
      `select c.table_name
         from information_schema.columns c
         join information_schema.tables t
           on t.table_schema = c.table_schema and t.table_name = c.table_name
        where c.table_schema = 'app' and c.column_name = 'tenant_id'
          and t.table_type = 'BASE TABLE' and c.table_name <> 'tenant'`,
    );

    for (const { table_name: tabela } of tabelas.rows) {
      await cliente.query(`delete from app.${tabela} where tenant_id = any($1)`, [ids]);
    }

    await cliente.query('delete from app.tenant where id = any($1)', [ids]);
  } finally {
    await cliente.query('reset session_replication_role');
    cliente.release();
  }
};

export const criarEscritorio = async (pool: Pool, cnpj: string, razaoSocial: string): Promise<string> =>
  (
    await pool.query<{ id: string }>(
      `insert into app.tenant (cnpj, razao_social, status) values ($1, $2, 'ATIVO') returning id`,
      [cnpj, razaoSocial],
    )
  ).rows[0]?.id ?? '';

export const criarUsuario = async (
  pool: Pool,
  tenantId: string,
  sub: string,
  pessoa: Pessoa,
  papel: PapelDeEscritorio,
): Promise<string> => {
  const id =
    (
      await pool.query<{ id: string }>(
        `insert into app.usuario (tenant_id, sub_oidc, email, nome, estado)
         values ($1, $2, $3, $4, 'ATIVO') returning id`,
        [tenantId, sub, `${pessoa.usuario}@escritorio.local`, pessoa.nome],
      )
    ).rows[0]?.id ?? '';

  await pool.query(`insert into app.usuario_papel (tenant_id, usuario_id, papel) values ($1, $2, $3)`, [
    tenantId,
    id,
    papel,
  ]);

  return id;
};

export const criarEmpresa = async (pool: Pool, tenantId: string, cnpj: string, nome: string): Promise<string> => {
  const id =
    (
      await pool.query<{ id: string }>(
        `insert into app.empresa
           (tenant_id, status, cnpj, razao_social, nome_fantasia, regime_tributario,
            enquadramento_simples, cnae_principal, inscricao_estadual_situacao,
            inscricao_municipal_situacao, situacao_cadastral_externa, validado_por_fonte_externa)
         values ($1, 'ATIVA', $2, $3, $3, 'SIMPLES_NACIONAL', 'NAO_MEI', '4712100', 'POSSUI',
                 'NAO_SE_APLICA', 'Ativa', true)
         returning id`,
        [tenantId, cnpj, nome],
      )
    ).rows[0]?.id ?? '';

  await pool.query(
    `insert into app.empresa_endereco
       (tenant_id, empresa_id, finalidade, principal, cep, logradouro, numero, bairro, municipio, uf)
     values ($1, $2, 'FISCAL', true, '74000000', 'Rua Um', '10', 'Centro', 'Goiania', 'GO')`,
    [tenantId, id],
  );

  return id;
};

export const vincular = async (pool: Pool, tenantId: string, usuarioId: string, empresaId: string): Promise<void> => {
  await pool.query(
    `insert into app.carteira_vinculo (tenant_id, usuario_id, empresa_id) values ($1, $2, $3)`,
    [tenantId, usuarioId, empresaId],
  );
};

// -- Navegação -----------------------------------------------------------------------------------

export const entrarComo = async (page: Page, pessoa: Pick<Pessoa, 'usuario' | 'senha'>): Promise<void> => {
  await page.goto('/api/auth/entrar?destino=%2Fempresas');

  const campo = page.getByRole('textbox', { name: 'Username or email' });

  await Promise.race([
    campo.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => undefined),
    page.waitForURL(/\/empresas/u, { timeout: 15_000 }).catch(() => undefined),
  ]);

  if (await campo.isVisible().catch(() => false)) {
    await campo.fill(pessoa.usuario);
    await page.getByRole('textbox', { name: 'Password' }).fill(pessoa.senha);
    await page.getByRole('button', { name: 'Sign In' }).click();
  }

  await page.waitForURL(/\/empresas/u);
};
