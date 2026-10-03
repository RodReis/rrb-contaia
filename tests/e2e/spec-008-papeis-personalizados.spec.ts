/**
 * E2E SPEC-008: criar papel de cada base → atribuir → provar o acesso → reduzir →
 * provar a negação na mesma sessão → bloquear o arquivamento do papel em uso →
 * desatribuir → arquivar → revisar → reativar → conferir a auditoria.
 *
 * Roda contra a pilha real: Keycloak (identidade e sessões), PostgreSQL e o
 * Mailpit, que captura o e-mail do convite. Nada é dublado — o que se prova é o
 * que o usuário vive e o que o servidor decide a cada requisição.
 *
 * Isolamento: escritório e administrador próprios (como na F7) e e-mails
 * exclusivos da execução; a limpeza das execuções anteriores cobre usuários,
 * papéis, revisões, vínculos e eventos do escritório da spec.
 *
 * Depende do ambiente local: `pnpm docker:up && pnpm db:migrate`.
 */
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { Pool } from 'pg';

const MAILPIT = process.env['MAILPIT_URL'] ?? 'http://127.0.0.1:18025';
const KEYCLOAK = (process.env['KEYCLOAK_ISSUER_URL'] ?? 'http://127.0.0.1:18080/realms/contaia').replace(
  /\/realms\/.*$/,
  '',
);
const REALM = process.env['KEYCLOAK_REALM'] ?? 'contaia';
const ESCOPO = process.env['PROVA_ESCOPO'] ?? 'local';

const ADMIN_USUARIO = 'e2e-f8-admin';
const ADMIN_SENHA = 'senha-do-admin-e2e-123456';
const ADMIN_EMAIL = 'e2e-f8-admin@escritorio.local';
const CNPJ_DO_ESCRITORIO = '11222333000181';

const SUFIXO = Date.now().toString(36);
const EMAIL_U = `e2e-f8-${SUFIXO}-u@escritorio.local`;
const NOME_U = 'Revisor Convidado E2E';
const SENHA_U = 'senha-do-usuario-e2e-123';
const NOME_DO_PAPEL = `Revisor E2E ${SUFIXO}`;

const BASES = [
  { rotulo: 'Administrador do escritório', nome: `Gestor E2E ${SUFIXO}` },
  { rotulo: 'Contador', nome: `Contábil E2E ${SUFIXO}` },
  { rotulo: 'Auxiliar', nome: NOME_DO_PAPEL },
  { rotulo: 'Auditor (somente leitura)', nome: `Auditor E2E ${SUFIXO}` },
] as const;

const pool = new Pool({
  connectionString:
    process.env['DATABASE_URL'] ?? 'postgresql://contaia:contaia_local@127.0.0.1:15432/contaia',
});

test.describe.configure({ mode: 'serial' });

// -- Keycloak ----------------------------------------------------------------------

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

const removerIdentidadesDeExecucoesAnteriores = async (): Promise<void> => {
  const cabecalhos = { authorization: `Bearer ${await tokenDeAdministracao()}` };
  const resposta = await fetch(`${KEYCLOAK}/admin/realms/${REALM}/users?search=e2e-f8-&max=200`, {
    headers: cabecalhos,
  });

  for (const usuario of (await resposta.json()) as Array<{ id: string }>) {
    await fetch(`${KEYCLOAK}/admin/realms/${REALM}/users/${usuario.id}`, {
      method: 'DELETE',
      headers: cabecalhos,
    });
  }
};

const criarIdentidadeDoAdministrador = async (): Promise<string> => {
  const cabecalhos = {
    authorization: `Bearer ${await tokenDeAdministracao()}`,
    'content-type': 'application/json',
  };
  const criacao = await fetch(`${KEYCLOAK}/admin/realms/${REALM}/users`, {
    method: 'POST',
    headers: cabecalhos,
    body: JSON.stringify({
      username: ADMIN_USUARIO,
      email: ADMIN_EMAIL,
      firstName: 'Administrador',
      lastName: 'E2E F8',
      enabled: true,
      emailVerified: true,
      credentials: [{ type: 'password', value: ADMIN_SENHA, temporary: false }],
    }),
  });

  if (criacao.status !== 201) {
    throw new Error(`Keycloak recusou criar o administrador da spec (${criacao.status})`);
  }

  return (criacao.headers.get('location') ?? '').split('/').pop() ?? '';
};

// -- Banco -----------------------------------------------------------------------------

const idDoEscritorio = async (): Promise<string> => {
  const { rows } = await pool.query<{ id: string }>('select id from app.tenant where cnpj = $1', [
    CNPJ_DO_ESCRITORIO,
  ]);

  return rows[0]?.id ?? '';
};

const apagarPapeisDoEscritorio = async (tenantId: string): Promise<void> => {
  // As triggers append-only recusam DELETE até para o dono da tabela: limpar fixture é a única
  // exceção legítima e as desliga de forma explícita, reativando-as em seguida.
  await pool.query('alter table app.usuario_evento disable trigger usuario_evento_append_only');
  await pool.query(
    'alter table app.papel_personalizado_revisao disable trigger papel_personalizado_revisao_append_only',
  );

  try {
    await pool.query('delete from app.usuario_evento where tenant_id = $1', [tenantId]);
    await pool.query('delete from app.papel_personalizado_revisao where tenant_id = $1', [tenantId]);
  } finally {
    await pool.query('alter table app.usuario_evento enable trigger usuario_evento_append_only');
    await pool.query(
      'alter table app.papel_personalizado_revisao enable trigger papel_personalizado_revisao_append_only',
    );
  }

  await pool.query('delete from app.usuario_papel_personalizado where tenant_id = $1', [tenantId]);
  await pool.query('delete from app.papel_personalizado where tenant_id = $1', [tenantId]);
};

const limparExecucoesAnteriores = async (): Promise<void> => {
  const tenantId = await idDoEscritorio();

  if (tenantId !== '') {
    await apagarPapeisDoEscritorio(tenantId);
  }

  await pool.query(`delete from app.usuario_convite where usuario_id in (select id from app.usuario where email like 'e2e-f8-%')`);
  await pool.query(`delete from app.usuario_papel where usuario_id in (select id from app.usuario where email like 'e2e-f8-%')`);
  await pool.query(`delete from app.usuario where email like 'e2e-f8-%'`);
};

const prepararEscritorioDaSpec = async (sub: string): Promise<void> => {
  const tenant = await pool.query<{ id: string }>(
    `insert into app.tenant (cnpj, razao_social, status)
     values ($1, 'Escritório E2E da F8', 'ATIVO')
     on conflict (cnpj) do update set status = 'ATIVO'
     returning id`,
    [CNPJ_DO_ESCRITORIO],
  );
  const tenantId = tenant.rows[0]?.id ?? '';
  const usuarioCriado = await pool.query<{ id: string }>(
    `insert into app.usuario (tenant_id, sub_oidc, email, nome, estado)
     values ($1, $2, $3, 'Administrador E2E F8', 'ATIVO')
     returning id`,
    [tenantId, sub, ADMIN_EMAIL],
  );

  await pool.query(
    `insert into app.usuario_papel (tenant_id, usuario_id, papel)
     values ($1, $2, 'admin_escritorio')`,
    [tenantId, usuarioCriado.rows[0]?.id ?? ''],
  );
};

const idDoPapel = async (nome: string): Promise<string> => {
  const { rows } = await pool.query<{ id: string }>(
    'select id from app.papel_personalizado where nome = $1',
    [nome],
  );

  return rows[0]?.id ?? '';
};

const idDoUsuario = async (email: string): Promise<string> => {
  const { rows } = await pool.query<{ id: string }>('select id from app.usuario where email = $1', [email]);

  return rows[0]?.id ?? '';
};

/** Papel de outro escritório, criado direto no banco com o contexto dele, para provar o isolamento. */
const criarPapelDeOutroEscritorio = async (): Promise<{ papelId: string; tenantId: string }> => {
  const { rows } = await pool.query<{ id: string }>(
    'select id from app.tenant where cnpj <> $1 order by criado_em limit 1',
    [CNPJ_DO_ESCRITORIO],
  );
  const tenantId = rows[0]?.id ?? '';
  const cliente = await pool.connect();

  try {
    await cliente.query('begin');
    await cliente.query("select set_config('app.tenant_id', $1, true)", [tenantId]);

    const papel = await cliente.query<{ id: string }>(
      `insert into app.papel_personalizado (tenant_id, nome, papel_base)
       values ($1, $2, 'auxiliar') returning id`,
      [tenantId, `Papel alheio ${SUFIXO}`],
    );
    const papelId = papel.rows[0]?.id ?? '';

    await cliente.query(
      `insert into app.papel_personalizado_revisao (tenant_id, papel_id, revisao, permissoes)
       values ($1, $2, 1, array['empresas.cadastro.consultar'])`,
      [tenantId, papelId],
    );
    await cliente.query('commit');

    return { papelId, tenantId };
  } catch (erro) {
    await cliente.query('rollback');
    throw erro;
  } finally {
    cliente.release();
  }
};

const apagarPapelDeOutroEscritorio = async (tenantId: string): Promise<void> => {
  await pool.query(
    'alter table app.papel_personalizado_revisao disable trigger papel_personalizado_revisao_append_only',
  );

  try {
    await pool.query(
      `delete from app.papel_personalizado_revisao where papel_id in (select id from app.papel_personalizado where tenant_id = $1 and nome = $2)`,
      [tenantId, `Papel alheio ${SUFIXO}`],
    );
  } finally {
    await pool.query(
      'alter table app.papel_personalizado_revisao enable trigger papel_personalizado_revisao_append_only',
    );
  }

  await pool.query('delete from app.papel_personalizado where tenant_id = $1 and nome = $2', [
    tenantId,
    `Papel alheio ${SUFIXO}`,
  ]);
};

// -- Mailpit ---------------------------------------------------------------------------

const idsJaLidos = new Set<string>();

const linkDoConvite = async (para: string): Promise<string> => {
  const limite = Date.now() + 20_000;

  while (Date.now() < limite) {
    const busca = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${para}`)}`);
    const { messages } = (await busca.json()) as { messages: Array<{ ID: string }> };
    const novo = messages.find((mensagem) => !idsJaLidos.has(mensagem.ID));

    if (novo !== undefined) {
      idsJaLidos.add(novo.ID);

      const corpo = (await (await fetch(`${MAILPIT}/api/v1/message/${novo.ID}`)).json()) as {
        Text: string;
      };
      const link = /(https?:\/\/\S+\/convite\/[A-Za-z0-9_-]{43})/.exec(corpo.Text)?.[1];

      if (link === undefined) {
        throw new Error('o e-mail chegou, mas sem link de convite');
      }

      return link;
    }

    await new Promise((resolver) => setTimeout(resolver, 500));
  }

  throw new Error(`nenhum e-mail novo para ${para} em 20 s`);
};

// -- Navegação -----------------------------------------------------------------------------

const entrarComo = async (page: Page, usuario: string, senha: string): Promise<void> => {
  await page.goto('/api/auth/entrar?destino=%2Fempresas');

  const campo = page.getByRole('textbox', { name: 'Username or email' });

  await Promise.race([
    campo.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => undefined),
    page.waitForURL(/\/empresas/, { timeout: 15_000 }).catch(() => undefined),
  ]);

  if (await campo.isVisible().catch(() => false)) {
    await campo.fill(usuario);
    await page.getByRole('textbox', { name: 'Password' }).fill(senha);
    await page.getByRole('button', { name: 'Sign In' }).click();
  }
};

const itensDoMenu = async (page: Page): Promise<string[]> =>
  page
    .getByRole('navigation', { name: 'Navegação principal' })
    .getByRole('link')
    .allTextContents();

const criarPapelPeloWizard = async (
  page: Page,
  dados: {
    nome: string;
    descricao: string;
    base: string;
    ajustar?: (pagina: Page) => Promise<void>;
  },
): Promise<void> => {
  await page.goto('/configuracoes/usuarios/papeis/novo');
  await page.getByLabel(/Nome do papel/).fill(dados.nome);
  await page.getByLabel('Descrição').fill(dados.descricao);
  await page.getByRole('radio', { name: dados.base }).check();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByText(/Marque o que o papel pode fazer/).waitFor();
  await dados.ajustar?.(page);
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByRole('heading', { name: 'Revisão do papel' }).waitFor();
  await page.getByRole('button', { name: 'Criar papel' }).click();
  await page.waitForURL(/aba=papeis/);
};

const aceitarConvite = async (page: Page, link: string, senha: string): Promise<void> => {
  await page.goto(link);
  await page.getByLabel(/^Nova senha/).fill(senha);
  await page.getByLabel(/^Confirme a senha/).fill(senha);
  await page.getByRole('button', { name: 'Definir senha e entrar' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Senha definida' })).toBeVisible();
};

const linhaDoPapel = (page: Page, nome: string) =>
  page.getByRole('table').getByRole('row', { name: new RegExp(nome, 'u') });

// -- Contextos compartilhados -----------------------------------------------------------------

let admin: Page;
let contextoDoAdmin: BrowserContext;
let usuario: Page;
let contextoDoUsuario: BrowserContext;
let navegador: Browser;
let tenantAlheio = '';

test.beforeAll(async ({ browser }) => {
  navegador = browser;

  await limparExecucoesAnteriores();
  await removerIdentidadesDeExecucoesAnteriores();
  await prepararEscritorioDaSpec(await criarIdentidadeDoAdministrador());

  contextoDoAdmin = await browser.newContext();
  admin = await contextoDoAdmin.newPage();
  await entrarComo(admin, ADMIN_USUARIO, ADMIN_SENHA);
  await admin.waitForURL(/\/empresas/);

  contextoDoUsuario = await browser.newContext();
  usuario = await contextoDoUsuario.newPage();
});

test.afterAll(async () => {
  if (tenantAlheio !== '') {
    await apagarPapelDeOutroEscritorio(tenantAlheio);
  }

  await contextoDoAdmin.close();
  await contextoDoUsuario.close();
  await pool.end();
});

// -- Caminho crítico ----------------------------------------------------------------------------

test('a aba Papéis e permissões mostra os papéis padrão e nenhum personalizado ainda', async () => {
  await admin.goto('/configuracoes/usuarios?aba=papeis');

  for (const papel of ['Administrador do escritório', 'Contador', 'Auxiliar', 'Auditor (somente leitura)']) {
    await expect(admin.getByRole('heading', { level: 3, name: papel })).toBeVisible();
  }

  await expect(admin.getByText('Nenhum papel personalizado')).toBeVisible();
  // Uma ação primária por página: nesta aba é Criar papel, não Convidar usuário.
  await expect(admin.getByRole('link', { name: 'Criar papel' }).first()).toBeVisible();
  await expect(admin.getByRole('link', { name: 'Convidar usuário' })).toHaveCount(0);
});

test('cria um papel a partir de cada base e a lista mostra a origem de cada um', async () => {
  test.setTimeout(180_000);

  for (const base of BASES) {
    await criarPapelPeloWizard(admin, {
      nome: base.nome,
      descricao: `Criado a partir de ${base.rotulo}`,
      base: base.rotulo,
      // O Revisor ganha o que a base Auxiliar não tem: consultar o histórico (global e cadastral).
      ajustar:
        base.rotulo === 'Auxiliar'
          ? async (pagina) => {
              await pagina
                .getByRole('button', { name: 'Liberar consulta em Histórico de Informações' })
                .click();
              await pagina
                .getByRole('region', { name: 'Empresas' })
                .getByRole('group', { name: 'Histórico cadastral' })
                .getByRole('checkbox', { name: 'Consultar' })
                .check();
            }
          : undefined,
    });
  }

  await admin.goto('/configuracoes/usuarios?aba=papeis');
  await admin.getByRole('table').waitFor();

  for (const base of BASES) {
    const linha = linhaDoPapel(admin, base.nome);

    await expect(linha).toBeVisible();
    await expect(linha.getByRole('cell', { name: base.rotulo, exact: true })).toBeVisible();
    await expect(linha.getByRole('cell', { name: 'Ativo', exact: true })).toBeVisible();
  }
});

test('o wizard partindo do administrador mostra a área de usuários e papéis bloqueada', async () => {
  await admin.goto('/configuracoes/usuarios/papeis/novo');
  await admin.getByLabel(/Nome do papel/).fill('Só para ver a área bloqueada');
  await admin.getByRole('radio', { name: 'Administrador do escritório' }).check();
  await admin.getByRole('button', { name: 'Continuar' }).click();

  const area = admin.getByRole('region', { name: 'Usuários e permissões, bloqueada' });

  await expect(area).toBeVisible();
  await expect(area).toContainText('exclusivo do papel padrão Administrador do escritório');

  for (const caixa of await area.getByRole('checkbox').all()) {
    await expect(caixa).toBeDisabled();
    await expect(caixa).not.toBeChecked();
  }

  // Nada foi criado: o papel só nasce no envio da última etapa.
  expect(await idDoPapel('Só para ver a área bloqueada')).toBe('');
});

test('nome duplicado volta ao campo; chave livre, área exclusiva e matriz vazia são recusadas pelo servidor', async () => {
  // Pelo wizard: o mesmo nome, em outra caixa, é duplicado (§3.1).
  await admin.goto('/configuracoes/usuarios/papeis/novo');
  await admin.getByLabel(/Nome do papel/).fill(NOME_DO_PAPEL.toUpperCase());
  await admin.getByRole('radio', { name: 'Contador' }).check();
  await admin.getByRole('button', { name: 'Continuar' }).click();
  await admin.getByRole('button', { name: 'Continuar' }).click();
  await admin.getByRole('button', { name: 'Criar papel' }).click();

  await expect(admin.getByText('Já existe um papel com este nome neste escritório.')).toBeVisible();
  await expect(admin.getByLabel(/Nome do papel/)).toHaveValue(NOME_DO_PAPEL.toUpperCase());

  // Pela API: nada que a tela impede passa pelo servidor.
  const criar = (permissoes: unknown[], nome = `Tentativa ${SUFIXO}`, papelBase = 'contador') =>
    admin.request.post('/api/proxy/papeis', { data: { nome, papelBase, permissoes } });

  const exclusiva = await criar(['usuarios.usuarios_e_papeis.administrar']);

  expect(exclusiva.status()).toBe(403);
  expect(((await exclusiva.json()) as { code: string }).code).toBe('PERMISSAO_EXCLUSIVA');

  const livre = await criar(['empresas.cadastro.excluir']);

  expect(livre.status()).toBe(422);
  expect(((await livre.json()) as { code: string }).code).toBe('PERMISSAO_INEXISTENTE');

  const vazia = await criar([]);

  expect(vazia.status()).toBe(422);
  expect(((await vazia.json()) as { code: string }).code).toBe('MATRIZ_INVALIDA');

  const baseInvalida = await criar(['empresas.cadastro.consultar'], `Base ${SUFIXO}`, 'gestor_financeiro');

  expect(baseInvalida.status()).toBe(422);

  const duplicada = await criar(['empresas.cadastro.consultar'], NOME_DO_PAPEL.toLowerCase());

  expect(duplicada.status()).toBe(409);
  expect(((await duplicada.json()) as { code: string }).code).toBe('PAPEL_NOME_DUPLICADO');

  // Nenhuma tentativa deixou papel para trás.
  const { rows } = await pool.query(
    `select 1 from app.papel_personalizado where nome like $1`,
    [`%${SUFIXO}%`],
  );

  expect(rows).toHaveLength(BASES.length);
});

test('papel personalizado atribuído a um usuário novo vale: acesso conforme a matriz, nunca a área exclusiva', async () => {
  test.setTimeout(120_000);

  await admin.goto('/configuracoes/usuarios/novo');
  await admin.getByLabel(/Nome completo/).fill(NOME_U);
  await admin.getByLabel(/^E-mail/).fill(EMAIL_U);
  await admin.getByRole('button', { name: 'Continuar' }).click();
  // Só o papel personalizado: a regra é ao menos um papel, de qualquer tipo (§3.4).
  await admin.getByRole('checkbox', { name: NOME_DO_PAPEL }).check();
  await admin.getByRole('button', { name: 'Enviar convite' }).click();
  await admin.waitForURL(/\/configuracoes\/usuarios$/);

  const link = await linkDoConvite(EMAIL_U);

  await aceitarConvite(usuario, link, SENHA_U);
  await usuario.getByRole('link', { name: 'Entrar no ContaIA' }).click();
  await entrarComo(usuario, EMAIL_U, SENHA_U);
  await usuario.waitForURL(/\/empresas/);

  // A matriz do papel: Empresas e o Histórico; nunca Usuários e permissões.
  await expect.poll(() => itensDoMenu(usuario)).toEqual(['Empresas', 'Histórico de Informações', 'Minha carteira']);

  await usuario.goto('/configuracoes/usuarios');
  await expect(usuario.getByText('Você não tem permissão para ver esta área')).toBeVisible();

  // O servidor recusa o que a matriz não concede, pela API direta.
  const idDoRevisor = await idDoPapel(NOME_DO_PAPEL);

  expect((await usuario.request.get('/api/proxy/papeis')).status()).toBe(403);
  expect((await usuario.request.get(`/api/proxy/papeis/${idDoRevisor}`)).status()).toBe(403);
  expect(
    (
      await usuario.request.post('/api/proxy/papeis', {
        data: { nome: 'Invasor', papelBase: 'auxiliar', permissoes: ['empresas.cadastro.consultar'] },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await usuario.request.post('/api/proxy/usuarios', {
        data: { nome: 'Invasor', email: 'invasor-f8@escritorio.local', papeis: ['admin_escritorio'] },
      })
    ).status(),
  ).toBe(403);
  // O que a matriz concede responde.
  expect((await usuario.request.get('/api/proxy/historico')).status()).toBe(200);
});

test('reduzir o papel nega na próxima requisição da mesma sessão, depois de a confirmação nomear o usuário', async () => {
  test.setTimeout(120_000);

  const idDoRevisor = await idDoPapel(NOME_DO_PAPEL);

  await admin.goto(`/configuracoes/usuarios/papeis/${idDoRevisor}`);
  await expect(admin.getByRole('heading', { level: 1, name: NOME_DO_PAPEL })).toBeVisible();
  await expect(admin.getByRole('link', { name: NOME_U })).toBeVisible();

  await admin.getByRole('tab', { name: 'Permissões' }).click();
  await admin.getByRole('button', { name: 'Ocultar módulo Histórico de Informações' }).click();
  await admin.getByRole('alertdialog').getByRole('button', { name: /Ocultar e remover/ }).click();

  // Papel atribuído: a redução passa por uma confirmação que diz quem é afetado.
  await admin.getByRole('button', { name: 'Salvar alterações' }).click();

  const dialogo = admin.getByRole('alertdialog');

  await expect(dialogo).toContainText('Confirmar redução de permissões?');
  await expect(dialogo).toContainText('1 usuário');
  await expect(dialogo).toContainText(NOME_U);
  await dialogo.getByRole('button', { name: 'Confirmar e salvar' }).click();
  await expect(admin.getByText(/Papel atualizado/)).toBeVisible();

  // A mesma sessão, o mesmo token: a revisão vigente já vale.
  await usuario.goto('/empresas');
  await expect.poll(() => itensDoMenu(usuario)).toEqual(['Empresas', 'Minha carteira']);
  expect((await usuario.request.get('/api/proxy/historico')).status()).toBe(403);

  // Revisão concorrente: quem escreve com a revisão antiga é recusado e nada muda.
  const antiga = await admin.request.put(`/api/proxy/papeis/${idDoRevisor}`, {
    data: {
      nome: NOME_DO_PAPEL,
      descricao: null,
      permissoes: ['empresas.cadastro.consultar'],
      revisaoEsperada: 1,
      confirmaReducao: false,
    },
  });

  expect(antiga.status()).toBe(409);
  expect(((await antiga.json()) as { code: string }).code).toBe('CONFLITO_DE_VERSAO');

  // Redução sem confirmação num papel atribuído: o servidor também exige.
  const semConfirmar = await admin.request.put(`/api/proxy/papeis/${idDoRevisor}`, {
    data: {
      nome: NOME_DO_PAPEL,
      descricao: null,
      permissoes: ['empresas.cadastro.consultar'],
      revisaoEsperada: 2,
      confirmaReducao: false,
    },
  });

  expect(semConfirmar.status()).toBe(409);
  expect(((await semConfirmar.json()) as { code: string }).code).toBe('REDUCAO_NAO_CONFIRMADA');
});

test('papel em uso não arquiva; desatribuir libera; arquivado não é atribuído nem editado', async () => {
  test.setTimeout(120_000);

  const idDoRevisor = await idDoPapel(NOME_DO_PAPEL);
  const idDoU = await idDoUsuario(EMAIL_U);

  await admin.goto(`/configuracoes/usuarios/papeis/${idDoRevisor}`);
  await admin.getByRole('button', { name: 'Arquivar papel' }).first().click();
  await admin.getByRole('alertdialog').getByRole('button', { name: 'Arquivar papel' }).click();

  await expect(admin.getByRole('alertdialog')).toContainText('Remova ou substitua o papel nesses usuários');
  await admin.getByRole('button', { name: 'Entendi' }).click();

  // O servidor também recusa, com a quantidade de vínculos na mensagem.
  const direto = await admin.request.post(`/api/proxy/papeis/${idDoRevisor}/arquivar`, {
    data: { revisaoEsperada: 2 },
  });

  expect(direto.status()).toBe(409);
  expect(((await direto.json()) as { code: string }).code).toBe('PAPEL_EM_USO');

  // Substituir o papel no usuário: sai o personalizado, entra o Auxiliar.
  await admin.goto(`/configuracoes/usuarios/${idDoU}`);
  await admin.getByRole('tab', { name: 'Papéis' }).click();
  await admin.getByRole('checkbox', { name: NOME_DO_PAPEL }).uncheck();
  await admin.getByRole('checkbox', { name: 'Auxiliar' }).check();
  await admin.getByRole('button', { name: 'Salvar alterações' }).click();
  await expect(admin.getByText('Usuário atualizado.')).toBeVisible();

  // Sem vínculos, arquiva.
  await admin.goto(`/configuracoes/usuarios/papeis/${idDoRevisor}`);
  await admin.getByRole('button', { name: 'Arquivar papel' }).first().click();
  await admin.getByRole('alertdialog').getByRole('button', { name: 'Arquivar papel' }).click();
  await expect(admin.getByText(/Papel “.*” arquivado/)).toBeVisible();
  await expect(admin.getByText(/Este papel está arquivado e não pode ser atribuído/)).toBeVisible();

  // Arquivado: não se atribui (servidor) e some do padrão da lista, mas o filtro o traz de volta.
  const atribuir = await admin.request.put(`/api/proxy/usuarios/${idDoU}`, {
    data: {
      nome: NOME_U,
      telefone: null,
      crc: null,
      papeis: ['auxiliar'],
      papeisPersonalizados: [idDoRevisor],
    },
  });

  expect(atribuir.status()).toBe(409);
  expect(((await atribuir.json()) as { code: string }).code).toBe('PAPEL_ARQUIVADO');

  const editar = await admin.request.put(`/api/proxy/papeis/${idDoRevisor}`, {
    data: {
      nome: NOME_DO_PAPEL,
      descricao: null,
      permissoes: ['empresas.cadastro.consultar'],
      revisaoEsperada: 3,
      confirmaReducao: true,
    },
  });

  expect(editar.status()).toBe(409);
  expect(((await editar.json()) as { code: string }).code).toBe('PAPEL_ARQUIVADO');

  await admin.goto('/configuracoes/usuarios?aba=papeis');
  await admin.getByRole('table').waitFor();
  await expect(linhaDoPapel(admin, NOME_DO_PAPEL)).toHaveCount(0);

  await admin.goto('/configuracoes/usuarios?aba=papeis&estado=ARQUIVADO');
  await expect(linhaDoPapel(admin, NOME_DO_PAPEL).getByText('Arquivado')).toBeVisible();
});

test('reativar exige a revisão da matriz e não restaura vínculos antigos', async () => {
  test.setTimeout(120_000);

  const idDoRevisor = await idDoPapel(NOME_DO_PAPEL);

  // Sem a matriz revisada, o servidor não reativa.
  const semMatriz = await admin.request.post(`/api/proxy/papeis/${idDoRevisor}/reativar`, {
    data: { revisaoEsperada: 3 },
  });

  expect(semMatriz.status()).toBe(422);

  await admin.goto(`/configuracoes/usuarios/papeis/${idDoRevisor}`);
  await admin.getByRole('tab', { name: 'Permissões' }).click();
  await admin.getByRole('button', { name: 'Reativar papel' }).click();

  const dialogo = admin.getByRole('alertdialog');

  await expect(dialogo).toContainText(`Reativar “${NOME_DO_PAPEL}”?`);
  await expect(dialogo).toContainText('Nenhum vínculo anterior com usuários é restaurado');
  await dialogo.getByRole('button', { name: 'Reativar papel' }).click();
  await expect(admin.getByText(/reativado\. Nenhum vínculo anterior foi restaurado/)).toBeVisible();

  await admin.goto('/configuracoes/usuarios?aba=papeis');
  const linha = linhaDoPapel(admin, NOME_DO_PAPEL);

  await expect(linha.getByText('Ativo')).toBeVisible();
  // Reativar não devolve o usuário ao papel: zero vinculados.
  await expect(linha.getByRole('cell').nth(3)).toHaveText('0');
});

test('a aba Usuários e acessos do Histórico registra o ciclo do papel, com o autor e a revisão', async () => {
  await admin.goto('/historico?aba=USUARIOS_E_ACESSOS');

  const lista = admin.getByRole('list', { name: 'Eventos de usuários e acessos' });

  await expect(lista).toBeVisible();
  await expect(lista).toContainText('Papel criado');
  await expect(lista).toContainText('Permissões do papel alteradas');
  await expect(lista).toContainText('Papel arquivado');
  await expect(lista).toContainText('Papel reativado');
  await expect(lista).toContainText('Dados e papéis alterados');
  await expect(lista).toContainText(NOME_DO_PAPEL);
  await expect(lista).toContainText('Administrador E2E F8');
  // A matriz alterada diz o que saiu, com o nome do catálogo.
  await expect(lista).toContainText('Histórico de Informações › Histórico global › Consultar');
  await expect(lista).toContainText(/revisão \d+/);
});

test('papel de outro escritório não aparece, não é lido nem alterado', async () => {
  const alheio = await criarPapelDeOutroEscritorio();

  tenantAlheio = alheio.tenantId;

  const leitura = await admin.request.get(`/api/proxy/papeis/${alheio.papelId}`);

  expect(leitura.status()).toBe(404);
  expect(((await leitura.json()) as { code: string }).code).toBe('PAPEL_NAO_ENCONTRADO');

  const escrita = await admin.request.put(`/api/proxy/papeis/${alheio.papelId}`, {
    data: {
      nome: 'Invasão',
      descricao: null,
      permissoes: ['empresas.cadastro.consultar'],
      revisaoEsperada: 1,
      confirmaReducao: true,
    },
  });

  expect(escrita.status()).toBe(404);

  // Atribuir papel alheio a um usuário do escritório responde como inexistente.
  const atribuir = await admin.request.put(`/api/proxy/usuarios/${await idDoUsuario(EMAIL_U)}`, {
    data: {
      nome: NOME_U,
      telefone: null,
      crc: null,
      papeis: ['auxiliar'],
      papeisPersonalizados: [alheio.papelId],
    },
  });

  expect(atribuir.status()).toBe(404);

  const lista = (await (await admin.request.get('/api/proxy/papeis?limite=100')).json()) as {
    papeis: Array<{ nome: string }>;
  };

  expect(lista.papeis.some((papel) => papel.nome.startsWith('Papel alheio'))).toBe(false);
});

// -- Provas visuais (FRONTEND.md §20.1): dois temas, 390 / 768 / 1024 / 1440 ----------------------

const LARGURAS = [390, 768, 1024, 1440] as const;
const TEMAS = ['light', 'dark'] as const;

const definirTema = async (page: Page, tema: (typeof TEMAS)[number]): Promise<void> => {
  await page.evaluate((valor) => localStorage.setItem('contaia-theme', valor), tema);
  await page.reload();
};

const semRolagemHorizontal = async (page: Page): Promise<boolean> =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test('provas visuais nos dois temas e nas quatro larguras', async () => {
  test.setTimeout(540_000);
  mkdirSync(`test-results/${ESCOPO}/capturas-f8`, { recursive: true });

  const idDoRevisor = await idDoPapel(NOME_DO_PAPEL);

  // Um papel arquivado para a lista e a edição de papel arquivado.
  const arquivadoId = await idDoPapel(BASES[3].nome);
  const lerRevisao = async (id: string): Promise<number> =>
    ((await (await admin.request.get(`/api/proxy/papeis/${id}`)).json()) as { revisao: number }).revisao;

  await admin.request.post(`/api/proxy/papeis/${arquivadoId}/arquivar`, {
    data: { revisaoEsperada: await lerRevisao(arquivadoId) },
  });

  for (const tema of TEMAS) {
    for (const largura of LARGURAS) {
      const capturar = async (page: Page, nome: string): Promise<void> => {
        expect(await semRolagemHorizontal(page), `${nome} ${tema} ${largura}px sem rolagem horizontal`).toBe(true);
        await page.screenshot({
          path: `test-results/${ESCOPO}/capturas-f8/${tema}-${largura}-${nome}.png`,
          fullPage: true,
        });
      };

      await admin.setViewportSize({ width: largura, height: 900 });

      // Lista de papéis (ativos) e arquivados
      await admin.goto('/configuracoes/usuarios?aba=papeis');
      await definirTema(admin, tema);
      await admin.getByRole('heading', { level: 3, name: 'Auxiliar' }).waitFor();
      await admin.getByText(/papéis personalizados\./).waitFor();
      await capturar(admin, 'lista-de-papeis');

      await admin.goto('/configuracoes/usuarios?aba=papeis&estado=todos');
      await admin.getByText(/papéis personalizados\./).waitFor();
      await capturar(admin, 'lista-todos');

      // Wizard: três etapas
      await admin.goto('/configuracoes/usuarios/papeis/novo');
      await admin.getByLabel(/Nome do papel/).fill('Revisor de conferência fiscal com nome bem comprido');
      await admin.getByLabel('Descrição').fill('Confere guias, obrigações acessórias e documentos antes da entrega.');
      await admin.getByRole('radio', { name: 'Contador' }).check();
      await capturar(admin, 'wizard-identificacao');
      await admin.getByRole('button', { name: 'Continuar' }).click();
      await admin.getByText(/Marque o que o papel pode fazer/).waitFor();
      await capturar(admin, 'wizard-permissoes');
      await admin.getByRole('button', { name: 'Ocultar módulo Notificações de pendências' }).click();
      await admin.getByRole('alertdialog').waitFor();
      await capturar(admin, 'dialogo-ocultar-modulo');
      await admin.getByRole('button', { name: /Ocultar e remover/ }).click();
      await admin.getByRole('button', { name: 'Continuar' }).click();
      await admin.getByRole('heading', { name: 'Revisão do papel' }).waitFor();
      await capturar(admin, 'wizard-revisao');

      // Edição: resumo, permissões e arquivado
      await admin.goto(`/configuracoes/usuarios/papeis/${idDoRevisor}`);
      await admin.getByRole('heading', { level: 1, name: NOME_DO_PAPEL }).waitFor();
      await capturar(admin, 'edicao-resumo');
      await admin.getByRole('tab', { name: 'Permissões' }).click();
      await admin.waitForTimeout(300);
      await capturar(admin, 'edicao-permissoes');

      await admin.goto(`/configuracoes/usuarios/papeis/${arquivadoId}`);
      await admin.getByText(/Este papel está arquivado/).waitFor();
      await capturar(admin, 'edicao-arquivado');

      // Atribuição de papéis ao usuário (padrão + personalizados)
      await admin.goto(`/configuracoes/usuarios/${await idDoUsuario(EMAIL_U)}`);
      await admin.getByRole('tab', { name: 'Papéis' }).click();
      await admin.getByRole('group', { name: 'Papéis personalizados' }).waitFor();
      await admin.waitForTimeout(300);
      await capturar(admin, 'usuario-papeis');

      // Histórico com eventos de papel
      await admin.goto('/historico?aba=USUARIOS_E_ACESSOS');
      await admin.getByRole('list', { name: 'Eventos de usuários e acessos' }).waitFor();
      await capturar(admin, 'historico-papeis');

      // Estados que dependem de resposta do servidor, forçados no navegador.
      await admin.route('**/api/proxy/papeis?*', (rota) =>
        rota.fulfill({ status: 200, contentType: 'application/json', body: '{"papeis":[],"total":0}' }),
      );
      await admin.goto('/configuracoes/usuarios?aba=papeis');
      await admin.getByText('Nenhum papel personalizado').waitFor();
      await capturar(admin, 'estado-vazio');
      await admin.unroute('**/api/proxy/papeis?*');

      await admin.route('**/api/proxy/papeis?*', (rota) =>
        rota.fulfill({
          status: 500,
          contentType: 'application/problem+json',
          body: '{"type":"x","title":"x","status":500,"code":"ERRO_INTERNO","correlationId":"corr-visual-f8-0001"}',
        }),
      );
      await admin.goto('/configuracoes/usuarios?aba=papeis');
      await admin.getByText('corr-visual-f8-0001').waitFor();
      await capturar(admin, 'estado-erro');
      await admin.unroute('**/api/proxy/papeis?*');
    }
  }

  await admin.setViewportSize({ width: 1280, height: 720 });
  expect(navegador).toBeDefined();
});
