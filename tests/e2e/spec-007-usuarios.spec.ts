/**
 * E2E SPEC-007: convidar → capturar o e-mail → definir a senha → entrar sem
 * carteira → alterar papel → suspender → negar a sessão → reativar → arquivar →
 * novo convite.
 *
 * Roda contra a pilha real: Keycloak (identidade e sessões), PostgreSQL e o
 * Mailpit, que captura o e-mail do convite. Nada é dublado — o que se prova é o
 * que o usuário vive. E-mail externo real é `not_run` (SPEC-007 §9).
 *
 * Isolamento: cada execução usa e-mails exclusivos e limpa os da execução
 * anterior (banco e Keycloak) e roda num escritório e administrador próprios,
 * sem tocar o tenant do seed (as outras suítes dependem dele). O teste do último
 * administrador só confere que o servidor recusa, e o `afterAll` restaura o
 * administrador mesmo se a proteção estivesse quebrada.
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

// Escritório e administrador próprios desta spec: as demais suítes dependem do tenant do
// seed (a SPEC-001 exige que ele comece incompleto), então ativá-lo aqui as quebraria.
const ADMIN_USUARIO = 'e2e-f7-admin';
const ADMIN_SENHA = 'senha-do-admin-e2e-123456';
const ADMIN_EMAIL = 'e2e-f7-admin@escritorio.local';
const CNPJ_DO_ESCRITORIO = '11444777000161';

const SUFIXO = Date.now().toString(36);
const EMAIL_A = `e2e-f7-${SUFIXO}-a@escritorio.local`;
const EMAIL_B = `e2e-f7-${SUFIXO}-b@escritorio.local`;
const EMAIL_C_ERRADO = `e2e-f7-${SUFIXO}-c-errado@escritorio.local`;
const EMAIL_C = `e2e-f7-${SUFIXO}-c@escritorio.local`;
const NOME_C = 'Terceiro E2E';
const NOME_A = 'Contadora E2E';
const NOME_B = 'Segundo E2E';
const SENHA_1 = 'primeira-senha-longa-123';
const SENHA_2 = 'segunda-senha-longa-456';

const pool = new Pool({
  connectionString:
    process.env['DATABASE_URL'] ?? 'postgresql://contaia:contaia_local@127.0.0.1:15432/contaia',
});

test.describe.configure({ mode: 'serial' });

// -- Keycloak (limpeza e restauração) ------------------------------------------

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
  const token = await tokenDeAdministracao();
  const cabecalhos = { authorization: `Bearer ${token}` };
  const resposta = await fetch(`${KEYCLOAK}/admin/realms/${REALM}/users?search=e2e-f7-&max=200`, {
    headers: cabecalhos,
  });

  for (const usuario of (await resposta.json()) as Array<{ id: string }>) {
    await fetch(`${KEYCLOAK}/admin/realms/${REALM}/users/${usuario.id}`, {
      method: 'DELETE',
      headers: cabecalhos,
    });
  }
};

/** Cria no Keycloak o administrador desta spec e devolve o `sub` que o token dele terá. */
const criarIdentidadeDoAdministrador = async (): Promise<string> => {
  const token = await tokenDeAdministracao();
  const cabecalhos = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const criacao = await fetch(`${KEYCLOAK}/admin/realms/${REALM}/users`, {
    method: 'POST',
    headers: cabecalhos,
    body: JSON.stringify({
      username: ADMIN_USUARIO,
      email: ADMIN_EMAIL,
      firstName: 'Administrador',
      lastName: 'E2E',
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

const prepararEscritorioDaSpec = async (sub: string): Promise<void> => {
  const tenant = await pool.query<{ id: string }>(
    `insert into app.tenant (cnpj, razao_social, status)
     values ($1, 'Escritório E2E da F7', 'ATIVO')
     on conflict (cnpj) do update set status = 'ATIVO'
     returning id`,
    [CNPJ_DO_ESCRITORIO],
  );
  const tenantId = tenant.rows[0]?.id ?? '';
  const usuarioCriado = await pool.query<{ id: string }>(
    `insert into app.usuario (tenant_id, sub_oidc, email, nome, estado)
     values ($1, $2, $3, 'Administrador E2E', 'ATIVO')
     returning id`,
    [tenantId, sub, ADMIN_EMAIL],
  );

  await pool.query(
    `insert into app.usuario_papel (tenant_id, usuario_id, papel)
     values ($1, $2, 'admin_escritorio')`,
    [tenantId, usuarioCriado.rows[0]?.id ?? ''],
  );
};

const restaurarAdministrador = async (): Promise<void> => {
  await pool.query(`update app.usuario set estado = 'ATIVO' where email = $1`, [ADMIN_EMAIL]);

  const token = await tokenDeAdministracao();
  const cabecalhos = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const achados = (await (
    await fetch(`${KEYCLOAK}/admin/realms/${REALM}/users?username=${ADMIN_USUARIO}&exact=true`, {
      headers: cabecalhos,
    })
  ).json()) as Array<{ id: string }>;

  for (const usuario of achados) {
    await fetch(`${KEYCLOAK}/admin/realms/${REALM}/users/${usuario.id}`, {
      method: 'PUT',
      headers: cabecalhos,
      body: JSON.stringify({ enabled: true }),
    });
  }
};

// -- Banco (limpeza) -------------------------------------------------------------

const limparUsuariosDeExecucoesAnteriores = async (): Promise<void> => {
  const { rows } = await pool.query<{ id: string }>(
    `select id from app.usuario where email like 'e2e-f7-%'`,
  );
  const ids = rows.map((linha) => linha.id);

  if (ids.length === 0) {
    return;
  }

  // A trigger append-only recusa DELETE até para o dono da tabela: limpar fixture é a
  // única exceção legítima e ela desliga a trigger de forma explícita.
  await pool.query('alter table app.usuario_evento disable trigger usuario_evento_append_only');

  try {
    await pool.query(
      'delete from app.usuario_evento where usuario_afetado_id = any($1) or autor_id = any($1)',
      [ids],
    );
  } finally {
    await pool.query('alter table app.usuario_evento enable trigger usuario_evento_append_only');
  }

  await pool.query('delete from app.usuario_convite where usuario_id = any($1)', [ids]);
  await pool.query('delete from app.usuario_papel where usuario_id = any($1)', [ids]);
  await pool.query('delete from app.usuario where id = any($1)', [ids]);
};

// -- Mailpit -------------------------------------------------------------------------

const idsJaLidos = new Set<string>();

/** Espera chegar um e-mail novo para o endereço e devolve o link do convite que ele traz. */
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

// -- Navegação ---------------------------------------------------------------------------

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

const linhaDoUsuario = (page: Page, nome: string) =>
  page.getByRole('table').getByRole('row', { name: new RegExp(nome, 'u') });

const abrirLista = async (page: Page, email: string): Promise<void> => {
  await page.goto(`/configuracoes/usuarios?busca=${encodeURIComponent(email)}`);
  await page.getByRole('table').waitFor();
};

const convidarPeloWizard = async (
  page: Page,
  dados: { nome: string; email: string; papel: string },
): Promise<void> => {
  await page.goto('/configuracoes/usuarios/novo');
  await page.getByLabel(/Nome completo/).fill(dados.nome);
  await page.getByLabel(/^E-mail/).fill(dados.email);
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByRole('checkbox', { name: dados.papel }).check();
  await page.getByRole('button', { name: 'Enviar convite' }).click();
  await page.waitForURL(/\/configuracoes\/usuarios$/);
};

const aceitarConvite = async (page: Page, link: string, senha: string): Promise<void> => {
  await page.goto(link);
  await page.getByLabel(/^Nova senha/).fill(senha);
  await page.getByLabel(/^Confirme a senha/).fill(senha);
  await page.getByRole('button', { name: 'Definir senha e entrar' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Senha definida' })).toBeVisible();
};

const itensDoMenu = async (page: Page): Promise<string[]> =>
  page
    .getByRole('navigation', { name: 'Navegação principal' })
    .getByRole('link')
    .allTextContents();

// -- Contextos compartilhados --------------------------------------------------------------

let admin: Page;
let contextoDoAdmin: BrowserContext;
let usuario: Page;
let contextoDoUsuario: BrowserContext;
let navegador: Browser;

const novoContexto = async (): Promise<BrowserContext> => navegador.newContext();

test.beforeAll(async ({ browser }) => {
  navegador = browser;

  await limparUsuariosDeExecucoesAnteriores();
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
  await restaurarAdministrador();
  await contextoDoAdmin.close();
  await contextoDoUsuario.close();
  await pool.end();
});

// -- Caminho crítico -----------------------------------------------------------------------------

test('convite completo: convidar, capturar o e-mail, definir a senha e entrar sem carteira', async () => {
  await convidarPeloWizard(admin, { nome: NOME_A, email: EMAIL_A, papel: 'Contador' });

  await abrirLista(admin, EMAIL_A);
  await expect(linhaDoUsuario(admin, NOME_A).getByText('Convidado')).toBeVisible();

  const link = await linkDoConvite(EMAIL_A);

  await aceitarConvite(usuario, link, SENHA_1);
  await usuario.getByRole('link', { name: 'Entrar no ContaIA' }).click();
  await entrarComo(usuario, EMAIL_A, SENHA_1);
  await usuario.waitForURL(/\/empresas/);

  // Sem carteira: nenhuma empresa, e a tela explica em vez de oferecer cadastrar.
  await expect(usuario.getByText('Você ainda não tem empresas na sua carteira')).toBeVisible();
  await expect(usuario.getByRole('link', { name: /Cadastrar empresa/ })).toHaveCount(0);

  // Contador não administra nem consulta usuários: o menu não os oferece...
  await expect.poll(() => itensDoMenu(usuario)).toEqual(['Empresas', 'Histórico de Informações', 'Minha carteira', 'Cofre de certificados']);

  // ...e a API recusa o acesso direto mesmo assim.
  await usuario.goto('/configuracoes/usuarios');
  await expect(usuario.getByText('Você não tem permissão para ver esta área')).toBeVisible();
});

test('alterar papéis vale na próxima requisição, com a mesma sessão', async () => {
  await abrirLista(admin, EMAIL_A);
  await admin.getByRole('link', { name: `Editar — ${NOME_A}` }).first().click();
  // Espera a edição carregar: sem isso, a lista ainda na tela tem a aba "Papéis e permissões",
  // que o nome parcial "Papéis" também encontra.
  await admin.getByRole('heading', { level: 1, name: NOME_A }).waitFor();
  await admin.getByRole('tab', { name: 'Papéis', exact: true }).click();
  await admin.getByRole('checkbox', { name: 'Auditor (somente leitura)' }).check();
  await admin.getByRole('button', { name: 'Salvar alterações' }).click();
  await expect(admin.getByText('Usuário atualizado.')).toBeVisible();

  // A mesma sessão, o mesmo token: a união dos papéis já vale.
  await usuario.goto('/empresas');
  await expect
    .poll(() => itensDoMenu(usuario))
    .toEqual(['Empresas', 'Histórico de Informações', 'Minha carteira', 'Cofre de certificados', 'Usuários e permissões']);

  await usuario.getByRole('link', { name: 'Usuários e permissões' }).click();
  await expect(usuario.getByRole('table')).toBeVisible();

  // Auditor consulta, não muta: nenhum botão de mutação e nem o convite.
  await expect(usuario.getByRole('link', { name: 'Convidar usuário' })).toHaveCount(0);
  await expect(usuario.getByRole('button', { name: /Suspender|Arquivar|Reativar/ })).toHaveCount(0);

  // Nem pela API: o servidor recusa a mutação do auditor.
  const tentativa = await usuario.request.post('/api/proxy/usuarios', {
    data: { nome: 'Invasor', email: 'invasor@escritorio.local', papeis: ['admin_escritorio'] },
  });

  expect(tentativa.status()).toBe(403);
});

test('suspender nega a sessão ativa, reativar libera, e arquivar só volta por novo convite', async () => {
  await abrirLista(admin, EMAIL_A);
  await admin.getByRole('button', { name: `Suspender — ${NOME_A}` }).first().click();

  const dialogo = admin.getByRole('alertdialog');

  await expect(dialogo).toContainText(`Suspender ${NOME_A}?`);
  await dialogo.getByRole('button', { name: 'Suspender usuário' }).click();
  // A suspensão passa pelo Keycloak (desabilitar + encerrar sessões) dentro da transação.
  await expect(linhaDoUsuario(admin, NOME_A).getByText('Suspenso')).toBeVisible({
    timeout: 20_000,
  });

  // A sessão que estava aberta cai na próxima requisição.
  await usuario.goto('/empresas');
  await expect(usuario.getByText(/Sua sessão expirou/)).toBeVisible();

  // E não dá para entrar de novo enquanto estiver suspenso.
  const contextoNovo = await novoContexto();
  const paginaNova = await contextoNovo.newPage();

  await entrarComo(paginaNova, EMAIL_A, SENHA_1);
  await expect(paginaNova.getByText(/Account is disabled|Invalid username or password/)).toBeVisible();
  await contextoNovo.close();

  // Reativar é reversível: age direto e o acesso volta.
  await abrirLista(admin, EMAIL_A);
  await admin.getByRole('button', { name: `Reativar — ${NOME_A}` }).first().click();
  await expect(linhaDoUsuario(admin, NOME_A).getByText('Ativo')).toBeVisible();

  const contextoReativado = await novoContexto();
  const paginaReativada = await contextoReativado.newPage();

  await entrarComo(paginaReativada, EMAIL_A, SENHA_1);
  await paginaReativada.waitForURL(/\/empresas/);
  await contextoReativado.close();

  // Arquivar encerra tudo e exige revisão + novo convite para voltar.
  await abrirLista(admin, EMAIL_A);
  await admin.getByRole('button', { name: `Arquivar — ${NOME_A}` }).first().click();
  await admin.getByRole('alertdialog').getByRole('button', { name: 'Arquivar usuário' }).click();
  await expect(linhaDoUsuario(admin, NOME_A).getByText('Arquivado')).toBeVisible();

  await admin.getByRole('link', { name: `Novo convite — ${NOME_A}` }).first().click();
  await expect(admin.getByText(/Revise os dados e os papéis/)).toBeVisible();
  await admin.getByRole('button', { name: 'Enviar novo convite' }).click();
  await admin.waitForURL(/\/configuracoes\/usuarios$/);

  await abrirLista(admin, EMAIL_A);
  await expect(linhaDoUsuario(admin, NOME_A).getByText('Convidado')).toBeVisible();

  const novoLink = await linkDoConvite(EMAIL_A);
  const contextoDoRetorno = await novoContexto();
  const paginaDoRetorno = await contextoDoRetorno.newPage();

  await aceitarConvite(paginaDoRetorno, novoLink, SENHA_2);
  await paginaDoRetorno.getByRole('link', { name: 'Entrar no ContaIA' }).click();
  await entrarComo(paginaDoRetorno, EMAIL_A, SENHA_2);
  await paginaDoRetorno.waitForURL(/\/empresas/);
  await contextoDoRetorno.close();
});

// -- Contrafactuais --------------------------------------------------------------------------------

test('reenviar invalida o link anterior', async () => {
  await convidarPeloWizard(admin, { nome: NOME_B, email: EMAIL_B, papel: 'Auxiliar' });

  const primeiro = await linkDoConvite(EMAIL_B);

  await abrirLista(admin, EMAIL_B);
  await admin.getByRole('button', { name: `Reenviar convite — ${NOME_B}` }).first().click();

  const segundo = await linkDoConvite(EMAIL_B);

  expect(segundo).not.toBe(primeiro);

  const contexto = await novoContexto();
  const pagina = await contexto.newPage();

  // O link antigo é recusado sem dizer por quê...
  await pagina.goto(primeiro);
  await expect(pagina.getByRole('alert').filter({ hasText: /\S/ })).toContainText('Este convite não é válido');
  await expect(pagina.getByRole('alert').filter({ hasText: /\S/ })).not.toContainText(/expirou|usado|invalidado/i);

  // ...e o novo continua valendo (sem consumi-lo: as provas visuais o usam).
  await pagina.goto(segundo);
  await expect(pagina.getByRole('heading', { level: 1, name: 'Defina a sua senha' })).toBeVisible();
  await contexto.close();
});

const identidadesNoKeycloak = async (emailExato: string): Promise<Array<{ username: string }>> => {
  const token = await tokenDeAdministracao();
  const resposta = await fetch(
    `${KEYCLOAK}/admin/realms/${REALM}/users?email=${encodeURIComponent(emailExato)}&exact=true`,
    { headers: { authorization: `Bearer ${token}` } },
  );

  return (await resposta.json()) as Array<{ username: string }>;
};

test('corrigir o e-mail de um convidado vale na identidade real e manda o link ao endereço certo', async () => {
  // Contra o Keycloak real: trocar o `username` junto com o e-mail exige o realm permitir.
  await convidarPeloWizard(admin, { nome: NOME_C, email: EMAIL_C_ERRADO, papel: 'Auxiliar' });
  await linkDoConvite(EMAIL_C_ERRADO);

  await abrirLista(admin, EMAIL_C_ERRADO);
  await admin.getByRole('link', { name: `Editar — ${NOME_C}` }).click();
  await admin.getByLabel(/^E-mail/).fill(EMAIL_C);
  await admin.getByRole('button', { name: 'Salvar alterações' }).click();

  const link = await linkDoConvite(EMAIL_C);

  expect(link).toMatch(/\/convite\/[A-Za-z0-9_-]{43}$/);
  expect(await identidadesNoKeycloak(EMAIL_C)).toHaveLength(1);
  expect(await identidadesNoKeycloak(EMAIL_C_ERRADO)).toHaveLength(0);
  expect((await identidadesNoKeycloak(EMAIL_C))[0]?.username).toBe(EMAIL_C);
});

test('e-mail repetido é recusado ignorando a caixa, sem revelar de quem é', async () => {
  await admin.goto('/configuracoes/usuarios/novo');
  await admin.getByLabel(/Nome completo/).fill('Duplicada E2E');
  await admin.getByLabel(/^E-mail/).fill(EMAIL_B.toUpperCase());
  await admin.getByRole('button', { name: 'Continuar' }).click();
  await admin.getByRole('checkbox', { name: 'Contador' }).check();
  await admin.getByRole('button', { name: 'Enviar convite' }).click();

  // A mensagem aparece junto ao campo e também no aviso (toast): afirmo a do campo.
  await expect(admin.locator('p', { hasText: 'Este e-mail já está em uso.' })).toBeVisible();
  await expect(admin.getByLabel(/^E-mail/)).toHaveAttribute('aria-invalid', 'true');
});

test('o último administrador não se suspende: o servidor recusa e explica', async () => {
  const { rows } = await pool.query<{ total: string }>(
    `select count(*) as total
       from app.usuario_papel p
       join app.usuario u on u.id = p.usuario_id and u.tenant_id = p.tenant_id
      where p.papel = 'admin_escritorio' and p.removido_em is null and u.estado = 'ATIVO'
        and p.tenant_id = (select tenant_id from app.usuario where email = $1 limit 1)`,
    [ADMIN_EMAIL],
  );

  // O escritório da spec é criado por ela, com um único administrador: se houver outro, a
  // proteção deixaria de ser provada. Falha em vez de pular (um skip esconderia a perda da prova).
  expect(Number(rows[0]?.total), 'o escritório da spec deve ter exatamente um administrador ativo').toBe(1);

  await abrirLista(admin, ADMIN_EMAIL);
  await admin.getByRole('button', { name: /^Suspender — / }).first().click();
  await admin.getByRole('alertdialog').getByRole('button', { name: 'Suspender usuário' }).click();

  const dialogo = admin.getByRole('alertdialog');

  await expect(dialogo).toContainText('Não é possível continuar');
  await expect(dialogo).toContainText('ao menos um administrador ativo');
  await dialogo.getByRole('button', { name: 'Entendi' }).click();

  await expect(linhaDoUsuario(admin, 'Administrador').getByText('Ativo')).toBeVisible();
});

test('a aba Usuários e acessos do Histórico registra o que aconteceu, com o autor', async () => {
  await admin.goto('/historico?aba=USUARIOS_E_ACESSOS');

  const lista = admin.getByRole('list', { name: 'Eventos de usuários e acessos' });

  await expect(lista).toBeVisible();
  await expect(lista).toContainText('Convite criado');
  await expect(lista).toContainText('Convite aceito');
  await expect(lista).toContainText('Usuário suspenso');
  await expect(lista).toContainText('Usuário reativado');
  await expect(lista).toContainText('Usuário arquivado');
  await expect(lista).toContainText('Novo convite iniciado');
  await expect(lista).toContainText('Convite reenviado');
  await expect(lista).toContainText('Dados e papéis alterados');
  // O token do convite nunca aparece na auditoria.
  await expect(lista).not.toContainText(/convite\/[A-Za-z0-9_-]{43}/);
});

// -- Provas visuais (FRONTEND.md §20.1): dois temas, 768 / 1024 / 1440 --------------------------

const LARGURAS = [390, 768, 1024, 1440] as const;
const TEMAS = ['light', 'dark'] as const;

const definirTema = async (page: Page, tema: (typeof TEMAS)[number]): Promise<void> => {
  await page.evaluate((valor) => localStorage.setItem('contaia-theme', valor), tema);
  await page.reload();
};

const semRolagemHorizontal = async (page: Page): Promise<boolean> =>
  page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  );

test('provas visuais nos dois temas e nas quatro larguras', async () => {
  test.setTimeout(480_000);
  mkdirSync(`test-results/${ESCOPO}/capturas`, { recursive: true });

  const { rows: achados } = await pool.query<{ id: string }>(
    'select id from app.usuario where email = $1',
    [EMAIL_A],
  );
  const idDoUsuario = achados[0]?.id ?? '';

  // O convite de B continua válido (o teste de reenvio não o consumiu).
  const linkValido = await (async () => {
    await abrirLista(admin, EMAIL_B);
    await admin.getByRole('button', { name: `Reenviar convite — ${NOME_B}` }).first().click();

    return linkDoConvite(EMAIL_B);
  })();

  // A rota pública limita 10 consultas por minuto por cliente: espaço as visitas e defino o
  // tema no contexto (sem reload, que dobraria as consultas). O limite em si é provado nos
  // testes da API.
  const INTERVALO_ENTRE_VISITAS_MS = 7_000;
  const origemPublica = new URL(linkValido).origin;

  for (const tema of TEMAS) {
    const publico = await navegador.newContext({
      storageState: {
        cookies: [],
        origins: [
          { origin: origemPublica, localStorage: [{ name: 'contaia-theme', value: tema }] },
        ],
      },
    });
    const paginaPublica = await publico.newPage();
    const visitarPublica = async (destino: string): Promise<void> => {
      await paginaPublica.waitForTimeout(INTERVALO_ENTRE_VISITAS_MS);
      await paginaPublica.goto(destino);
    };

    for (const largura of LARGURAS) {
      const capturar = async (page: Page, nome: string): Promise<void> => {
        expect(await semRolagemHorizontal(page), `${nome} ${tema} ${largura}px sem rolagem horizontal`).toBe(true);
        await page.screenshot({
          path: `test-results/${ESCOPO}/capturas/${tema}-${largura}-${nome}.png`,
          fullPage: true,
        });
      };

      await admin.setViewportSize({ width: largura, height: 900 });
      await paginaPublica.setViewportSize({ width: largura, height: 900 });

      // Lista e papéis
      await admin.goto('/configuracoes/usuarios');
      await definirTema(admin, tema);
      await admin.getByRole('heading', { level: 1, name: 'Usuários e permissões' }).waitFor();
      // Tabela (≥1024px) ou cartões: a contagem aparece nos dois e prova que a lista carregou.
      await admin.getByText(/usuários? neste escritório/).waitFor();
      await capturar(admin, 'lista');

      await admin.goto('/configuracoes/usuarios?aba=papeis');
      await admin.getByRole('heading', { level: 3, name: 'Auxiliar' }).waitFor();
      await capturar(admin, 'papeis');

      // Wizard: etapas 1 e 2
      await admin.goto('/configuracoes/usuarios/novo');
      await admin.getByLabel(/Nome completo/).fill('Maria da Conceição de Albuquerque Montenegro');
      await admin.getByLabel(/^E-mail/).fill('maria.visual@escritorio.local');
      await capturar(admin, 'wizard-dados');
      await admin.getByRole('button', { name: 'Continuar' }).click();
      await admin.getByRole('checkbox', { name: 'Contador' }).check();
      await capturar(admin, 'wizard-papeis');

      // Edição
      await admin.goto(`/configuracoes/usuarios/${idDoUsuario}`);
      await admin.getByRole('heading', { level: 1, name: NOME_A }).waitFor();
      await capturar(admin, 'edicao-dados');
      await admin.getByRole('tab', { name: 'Papéis' }).click();
      // O indicador da aba anima a cor (duração rápida): espero assentar para a captura
      // não pegar a transição.
      await admin.waitForTimeout(300);
      await capturar(admin, 'edicao-papeis');

      // Histórico
      await admin.goto('/historico?aba=USUARIOS_E_ACESSOS');
      await admin.getByRole('list', { name: 'Eventos de usuários e acessos' }).waitFor();
      await capturar(admin, 'historico-usuarios');

      // Aceite do convite (público) e convite inválido
      await visitarPublica(linkValido);
      await paginaPublica.getByRole('heading', { level: 1, name: 'Defina a sua senha' }).waitFor();
      await capturar(paginaPublica, 'aceite');

      await visitarPublica(`/convite/${'x'.repeat(43)}`);
      await paginaPublica.getByRole('alert').filter({ hasText: /\S/ }).waitFor();
      await capturar(paginaPublica, 'convite-invalido');

      // Estados que dependem de resposta do servidor, forçados no navegador.
      await admin.route('**/api/proxy/usuarios?*', (rota) =>
        rota.fulfill({ status: 200, contentType: 'application/json', body: '{"usuarios":[],"total":0}' }),
      );
      await admin.goto('/configuracoes/usuarios');
      await admin.getByText('Nenhum usuário cadastrado').waitFor();
      await capturar(admin, 'estado-vazio');
      await admin.unroute('**/api/proxy/usuarios?*');

      await admin.route('**/api/proxy/usuarios?*', (rota) =>
        rota.fulfill({
          status: 500,
          contentType: 'application/problem+json',
          body: '{"type":"x","title":"x","status":500,"code":"ERRO_INTERNO","correlationId":"corr-visual-0001"}',
        }),
      );
      await admin.goto('/configuracoes/usuarios');
      await admin.getByRole('alert').filter({ hasText: /\S/ }).waitFor();
      await capturar(admin, 'estado-erro');
      await admin.unroute('**/api/proxy/usuarios?*');
    }

    await publico.close();
  }

  await admin.setViewportSize({ width: 1280, height: 720 });
});
