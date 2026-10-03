/**
 * E2E SPEC-009: criar empresa → autoatribuir → compartilhar → provar acesso →
 * remover → provar negação → arquivar/reativar → exigir nova atribuição, mais os
 * contrafactuais (empresa fora da carteira, lote inválido, revisão concorrente,
 * usuário arquivado) e as provas visuais da interface.
 *
 * Roda contra a pilha real: Keycloak (identidade e sessões), PostgreSQL, API e
 * Web. Nada é dublado — o que se prova é o que o usuário vive.
 *
 * Isolamento: escritório, administrador e colaborador próprios (`e2e-f9-*`), sem
 * tocar o tenant do seed. Cada execução limpa o que a anterior deixou (banco e
 * Keycloak). A empresa "Alfa" nasce pela API, como na tela, para provar a
 * autoatribuição; as demais entram por SQL (ativar o cadastro inteiro pelo wizard
 * provaria de novo a SPEC-002).
 *
 * Depende do ambiente local: `pnpm docker:up && pnpm db:migrate`.
 */
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { Pool } from 'pg';

const KEYCLOAK = (process.env['KEYCLOAK_ISSUER_URL'] ?? 'http://127.0.0.1:18080/realms/contaia').replace(
  /\/realms\/.*$/,
  '',
);
const REALM = process.env['KEYCLOAK_REALM'] ?? 'contaia';
const ESCOPO = process.env['PROVA_ESCOPO'] ?? 'local';

const ADMIN_USUARIO = 'e2e-f9-admin';
const ADMIN_EMAIL = 'e2e-f9-admin@escritorio.local';
const ADMIN_SENHA = 'senha-do-admin-e2e-123456';
const COLAB_USUARIO = 'e2e-f9-colab';
const COLAB_EMAIL = 'e2e-f9-colab@escritorio.local';
const COLAB_NOME = 'Colaboradora E2E';
const COLAB_SENHA = 'senha-da-colab-e2e-123456';
const CNPJ_DO_ESCRITORIO = '11555666000130';

// CNPJs das empresas clientes (formato válido, exclusivos desta suíte).
const CNPJ_ALFA = '45242914000105';
const CNPJ_ALFA_FORMATADO = '45.242.914/0001-05';
const CNPJ_BETA = '33000167000101';
const CNPJ_GAMA = '19131243000197';
const CNPJ_DELTA = '34028316000103';
const CNPJ_DELTA_FORMATADO = '34.028.316/0001-03';

const NOME_ALFA = 'Alfa E2E Comércio';
const NOME_BETA = 'Beta E2E Serviços';
const NOME_GAMA = 'Gama E2E Arquivada';
const NOME_DELTA = 'Delta E2E Fora da Carteira';

const pool = new Pool({
  connectionString:
    process.env['DATABASE_URL'] ?? 'postgresql://contaia:contaia_local@127.0.0.1:15432/contaia',
});

test.describe.configure({ mode: 'serial' });

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

const removerIdentidadesDeExecucoesAnteriores = async (): Promise<void> => {
  const token = await tokenDeAdministracao();
  const cabecalhos = { authorization: `Bearer ${token}` };
  const resposta = await fetch(`${KEYCLOAK}/admin/realms/${REALM}/users?search=e2e-f9-&max=200`, {
    headers: cabecalhos,
  });

  for (const usuario of (await resposta.json()) as Array<{ id: string }>) {
    await fetch(`${KEYCLOAK}/admin/realms/${REALM}/users/${usuario.id}`, {
      method: 'DELETE',
      headers: cabecalhos,
    });
  }
};

/** Cria a identidade no Keycloak e devolve o `sub` que o token dela terá. */
const criarIdentidade = async (
  username: string,
  email: string,
  senha: string,
  nome: string,
): Promise<string> => {
  const token = await tokenDeAdministracao();
  const criacao = await fetch(`${KEYCLOAK}/admin/realms/${REALM}/users`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      username,
      email,
      firstName: nome,
      lastName: 'E2E',
      enabled: true,
      emailVerified: true,
      credentials: [{ type: 'password', value: senha, temporary: false }],
    }),
  });

  if (criacao.status !== 201) {
    throw new Error(`Keycloak recusou criar ${username} (${criacao.status})`);
  }

  return (criacao.headers.get('location') ?? '').split('/').pop() ?? '';
};

const reabilitarIdentidade = async (username: string): Promise<void> => {
  const token = await tokenDeAdministracao();
  const cabecalhos = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const achados = (await (
    await fetch(`${KEYCLOAK}/admin/realms/${REALM}/users?username=${username}&exact=true`, {
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

// -- Banco -----------------------------------------------------------------------------------------

let tenantId = '';
let adminId = '';
let colabId = '';
let alfaId = '';
let betaId = '';
let gamaId = '';
let deltaId = '';

/**
 * Limpa o escritório da suíte e tudo que pendura nele. `session_replication_role = replica`
 * vale só nesta conexão e desliga FKs e triggers (inclusive as append-only, que recusam DELETE
 * até para o dono): limpar fixture é a única exceção legítima a elas.
 */
const limparEscritorioDaSpec = async (): Promise<void> => {
  const { rows } = await pool.query<{ id: string }>('select id from app.tenant where cnpj = $1', [
    CNPJ_DO_ESCRITORIO,
  ]);
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

const criarUsuarioNoBanco = async (
  sub: string,
  email: string,
  nome: string,
  papel: 'admin_escritorio' | 'contador',
): Promise<string> => {
  const criado = await pool.query<{ id: string }>(
    `insert into app.usuario (tenant_id, sub_oidc, email, nome, estado)
     values ($1, $2, $3, $4, 'ATIVO')
     returning id`,
    [tenantId, sub, email, nome],
  );
  const id = criado.rows[0]?.id ?? '';

  await pool.query(
    `insert into app.usuario_papel (tenant_id, usuario_id, papel) values ($1, $2, $3)`,
    [tenantId, id, papel],
  );

  return id;
};

const criarEmpresaAtivaPorSql = async (cnpj: string, nome: string): Promise<string> => {
  const criada = await pool.query<{ id: string }>(
    `insert into app.empresa
       (tenant_id, status, cnpj, razao_social, nome_fantasia, regime_tributario,
        enquadramento_simples, cnae_principal, inscricao_estadual_situacao,
        inscricao_municipal_situacao, situacao_cadastral_externa, validado_por_fonte_externa)
     values ($1, 'ATIVA', $2, $3, $3, 'SIMPLES_NACIONAL', 'NAO_MEI', '4712100', 'POSSUI',
             'NAO_SE_APLICA', 'Ativa', true)
     returning id`,
    [tenantId, cnpj, nome],
  );
  const id = criada.rows[0]?.id ?? '';

  await pool.query(
    `insert into app.empresa_endereco
       (tenant_id, empresa_id, finalidade, principal, cep, logradouro, numero, bairro, municipio, uf)
     values ($1, $2, 'FISCAL', true, '74000000', 'Rua Um', '10', 'Centro', 'Goiania', 'GO')`,
    [tenantId, id],
  );

  return id;
};

const vinculosAtivos = async (usuarioId: string): Promise<string[]> =>
  (
    await pool.query<{ empresa_id: string }>(
      `select empresa_id from app.carteira_vinculo
        where usuario_id = $1 and encerrado_em is null order by empresa_id`,
      [usuarioId],
    )
  ).rows.map((linha) => linha.empresa_id);

const revisaoDaCarteira = async (usuarioId: string): Promise<number> =>
  Number(
    (
      await pool.query<{ revisao_carteira: string }>(
        'select revisao_carteira::text from app.usuario where id = $1',
        [usuarioId],
      )
    ).rows[0]?.revisao_carteira ?? '0',
  );

// -- Navegação -------------------------------------------------------------------------------------

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

  await page.waitForURL(/\/empresas/);
};

const itensDoMenu = async (page: Page): Promise<string[]> =>
  page
    .getByRole('navigation', { name: 'Navegação principal' })
    .getByRole('link')
    .allTextContents();

let admin: Page;
let contextoDoAdmin: BrowserContext;
let colab: Page;
let contextoDaColab: BrowserContext;
let navegador: Browser;

const arquivar = async (empresaId: string): Promise<void> => {
  const resposta = await admin.request.post(`/api/proxy/empresas/${empresaId}/manutencao/arquivar`, {
    data: { justificativa: 'Encerrou as atividades.' },
  });

  expect(resposta.status()).toBe(200);
};

test.beforeAll(async ({ browser }) => {
  navegador = browser;

  await limparEscritorioDaSpec();
  await removerIdentidadesDeExecucoesAnteriores();

  const tenant = await pool.query<{ id: string }>(
    `insert into app.tenant (cnpj, razao_social, status)
     values ($1, 'Escritório E2E da F9', 'ATIVO')
     on conflict (cnpj) do update set status = 'ATIVO'
     returning id`,
    [CNPJ_DO_ESCRITORIO],
  );
  tenantId = tenant.rows[0]?.id ?? '';

  adminId = await criarUsuarioNoBanco(
    await criarIdentidade(ADMIN_USUARIO, ADMIN_EMAIL, ADMIN_SENHA, 'Administrador'),
    ADMIN_EMAIL,
    'Administrador E2E',
    'admin_escritorio',
  );
  colabId = await criarUsuarioNoBanco(
    await criarIdentidade(COLAB_USUARIO, COLAB_EMAIL, COLAB_SENHA, 'Colaboradora'),
    COLAB_EMAIL,
    COLAB_NOME,
    'contador',
  );

  contextoDoAdmin = await browser.newContext();
  admin = await contextoDoAdmin.newPage();
  await entrarComo(admin, ADMIN_USUARIO, ADMIN_SENHA);

  contextoDaColab = await browser.newContext();
  colab = await contextoDaColab.newPage();
  await entrarComo(colab, COLAB_USUARIO, COLAB_SENHA);
});

test.afterAll(async () => {
  await contextoDoAdmin.close();
  await contextoDaColab.close();
  await pool.end();
});

// -- Caminho crítico -------------------------------------------------------------------------------

test('criar empresa autoatribui o admin criador, e só ele, na mesma operação', async () => {
  // Antes de qualquer empresa: usuário ativo sem carteira vê zero e a orientação de ausência de alçada.
  await colab.goto('/empresas');
  await expect(colab.getByText('Você ainda não tem empresas na sua carteira')).toBeVisible();

  const criacao = await admin.request.post('/api/proxy/empresas', { data: { cnpj: CNPJ_ALFA } });

  expect(criacao.status()).toBe(201);
  alfaId = ((await criacao.json()) as { id: string }).id;

  // A empresa criada já está na carteira do admin criador (e só na dele).
  expect(await vinculosAtivos(adminId)).toEqual([alfaId]);
  expect(await vinculosAtivos(colabId)).toEqual([]);

  // O vínculo nasceu com tenant e empresa, e a revisão do admin subiu.
  expect(await revisaoDaCarteira(adminId)).toBe(1);

  // A "Minha carteira" do admin mostra a empresa criada.
  await admin.goto('/carteira');
  await expect(admin.getByRole('heading', { level: 1, name: 'Minha carteira' })).toBeVisible();
  await expect(admin.getByText(`CNPJ ${CNPJ_ALFA_FORMATADO}`)).toBeVisible();

  // Ativa a empresa por SQL (o cadastro completo é prova da SPEC-002) e dá nome a ela.
  await pool.query(
    `update app.empresa set status = 'ATIVA', razao_social = $2, nome_fantasia = $2,
            regime_tributario = 'SIMPLES_NACIONAL', enquadramento_simples = 'NAO_MEI',
            cnae_principal = '4712100', inscricao_estadual_situacao = 'POSSUI',
            inscricao_municipal_situacao = 'NAO_SE_APLICA', situacao_cadastral_externa = 'Ativa',
            validado_por_fonte_externa = true
      where id = $1`,
    [alfaId, NOME_ALFA],
  );
  betaId = await criarEmpresaAtivaPorSql(CNPJ_BETA, NOME_BETA);
  // A Gama nasce arquivada: empresa arquivada nunca é opção de atribuição e derruba o lote.
  gamaId = await criarEmpresaAtivaPorSql(CNPJ_GAMA, NOME_GAMA);
  await pool.query(`update app.empresa set situacao = 'arquivado' where id = $1`, [gamaId]);
  // A Delta é ativa e fica fora de qualquer carteira: é a empresa do 403.
  deltaId = await criarEmpresaAtivaPorSql(CNPJ_DELTA, NOME_DELTA);

  // A autoatribuição está no histórico global, com a origem dita por extenso.
  await admin.goto('/historico?aba=CARTEIRAS');
  await expect(
    admin.getByRole('list', { name: 'Eventos de carteira' }).getByText('Autoatribuição na criação da empresa'),
  ).toBeVisible();
});

test('admin atribui em lote pela Central; o colaborador passa a acessar e recebe um aviso consolidado', async () => {
  await admin.goto('/configuracoes/usuarios?aba=carteiras');
  await admin.getByRole('table').waitFor();

  await admin.getByRole('checkbox', { name: `Selecionar ${COLAB_NOME}` }).check();
  await admin.getByRole('button', { name: /Adicionar empresas/ }).click();

  const dialogo = admin.getByRole('dialog');
  await dialogo.getByRole('checkbox', { name: NOME_ALFA }).check();
  await dialogo.getByRole('checkbox', { name: NOME_BETA }).check();
  // Empresa arquivada nunca aparece como opção.
  await expect(dialogo.getByRole('checkbox', { name: NOME_GAMA })).toHaveCount(0);
  await dialogo.getByRole('button', { name: 'Revisar' }).click();

  // Revisão antes de salvar: colaboradores, empresas e efeito.
  await expect(dialogo).toContainText(COLAB_NOME);
  await expect(dialogo).toContainText(NOME_ALFA);
  await expect(dialogo).toContainText('passam a acessar');
  await dialogo.getByRole('button', { name: 'Adicionar e salvar' }).click();

  await expect(admin.getByText('Carteira atualizada.').first()).toBeVisible();
  expect((await vinculosAtivos(colabId)).sort()).toEqual([alfaId, betaId].sort());

  // Próxima requisição: a colaboradora abre a Alfa sem recarregar a sessão.
  await colab.goto(`/empresas/${alfaId}`);
  await expect(colab.getByRole('tab', { name: 'Identificação' })).toBeVisible();

  // Um aviso consolidado no sino, e não um por vínculo.
  await colab.getByRole('button', { name: 'Notificações' }).click();
  const painel = colab.getByRole('dialog');
  await expect(painel.getByText('Sua carteira foi atualizada')).toBeVisible();
  await expect(painel.getByText(/2 empresas adicionadas/)).toBeVisible();
  await expect(painel.getByRole('listitem')).toHaveCount(1);
  await colab.keyboard.press('Escape');

  // Uma empresa compartilhada entre colaboradores: a Alfa segue na carteira do admin também.
  expect(await vinculosAtivos(adminId)).toContain(alfaId);
});

test('empresa do mesmo escritório fora da carteira responde 403 com nome e CNPJ, e nada além', async () => {
  const resposta = await colab.request.get(`/api/proxy/empresas/${deltaId}`);

  expect(resposta.status()).toBe(403);
  const corpo = (await resposta.json()) as {
    code: string;
    detalhes?: { empresa?: { nome?: string; cnpj?: string } };
  };
  expect(corpo.code).toBe('EMPRESA_FORA_DA_CARTEIRA');
  expect(corpo.detalhes?.empresa?.nome).toBe(NOME_DELTA);
  expect(corpo.detalhes?.empresa?.cnpj).toBe(CNPJ_DELTA_FORMATADO);

  // Nenhuma ação da empresa está liberada, nem leitura de dados ou escrita.
  for (const caminho of ['documentos', 'documentos/historico', 'manutencao/enderecos']) {
    expect((await colab.request.get(`/api/proxy/empresas/${deltaId}/${caminho}`)).status()).toBe(403);
  }
  expect(
    (
      await colab.request.put(`/api/proxy/empresas/${deltaId}/identificacao`, {
        data: { razaoSocial: 'Invasora' },
      })
    ).status(),
  ).toBe(403);

  await colab.goto(`/empresas/${deltaId}`);
  await expect(colab.getByText('Esta empresa não está na sua carteira')).toBeVisible();
  await expect(colab.getByText(`${NOME_DELTA} (CNPJ ${CNPJ_DELTA_FORMATADO})`)).toBeVisible();
  await expect(colab.getByRole('tab')).toHaveCount(0);

  // O admin também está limitado à própria carteira nos dados da empresa.
  expect((await admin.request.get(`/api/proxy/empresas/${deltaId}`)).status()).toBe(403);
});

test('a lista de empresas da colaboradora traz só as da carteira, nunca a base inteira', async () => {
  await colab.goto('/empresas');
  await expect(colab.getByText(NOME_ALFA).first()).toBeVisible();
  await expect(colab.getByText(NOME_DELTA)).toHaveCount(0);

  const lista = (await (await colab.request.get('/api/proxy/empresas?limite=100')).json()) as {
    empresas: Array<{ id: string }>;
  };
  expect(lista.empresas.map((empresa) => empresa.id).sort()).toEqual([alfaId, betaId].sort());
});

test('só o admin administra carteiras: a colaboradora recebe 403 e nenhum vínculo muda', async () => {
  const antes = await vinculosAtivos(colabId);
  const tentativa = await colab.request.post('/api/proxy/carteiras/alteracoes', {
    data: {
      origem: 'LOTE',
      usuarios: [{ id: colabId, revisao: await revisaoDaCarteira(colabId) }],
      adicionar: [gamaId],
      remover: [],
    },
  });

  expect(tentativa.status()).toBe(403);
  expect(await vinculosAtivos(colabId)).toEqual(antes);
  expect((await colab.request.get('/api/proxy/carteiras/colaboradores')).status()).toBe(403);
  // Quem não administra não vê a Central nem a aba.
  await colab.goto('/configuracoes/usuarios?aba=carteiras');
  await expect(colab.getByRole('tab', { name: 'Central de Carteiras' })).toHaveCount(0);
});

test('lote inválido é atômico e a revisão desatualizada responde 409', async () => {
  const antes = await vinculosAtivos(colabId);
  const revisao = await revisaoDaCarteira(colabId);

  // Uma empresa válida e uma arquivada: o lote inteiro cai, sem aplicação parcial.
  const invalido = await admin.request.post('/api/proxy/carteiras/alteracoes', {
    data: {
      origem: 'LOTE',
      usuarios: [{ id: colabId, revisao }],
      adicionar: [alfaId, gamaId],
      remover: [],
    },
  });
  expect(invalido.status()).toBe(422);
  expect(JSON.stringify(await invalido.json())).toContain(`empresas.${gamaId}`);
  expect(await vinculosAtivos(colabId)).toEqual(antes);
  expect(await revisaoDaCarteira(colabId)).toBe(revisao);

  // Empresa de outro escritório é indistinguível de inexistente.
  const alheia = await admin.request.post('/api/proxy/carteiras/alteracoes', {
    data: {
      origem: 'LOTE',
      usuarios: [{ id: colabId, revisao }],
      adicionar: ['00000000-0000-7000-8000-00000000f9f9'],
      remover: [],
    },
  });
  expect(alheia.status()).toBe(422);

  // Revisão que a tela não viu: 409 e nada muda.
  const velha = await admin.request.post('/api/proxy/carteiras/alteracoes', {
    data: {
      origem: 'INDIVIDUAL',
      usuarios: [{ id: colabId, revisao: revisao + 5 }],
      adicionar: [],
      remover: [betaId],
    },
  });
  expect(velha.status()).toBe(409);
  expect(((await velha.json()) as { code: string }).code).toBe('CARTEIRA_DESATUALIZADA');
  expect(await vinculosAtivos(colabId)).toEqual(antes);

  // Repetir a mesma adição não duplica evento nem muda a revisão.
  const eventosAntes = Number(
    (await pool.query<{ total: string }>('select count(*)::text as total from app.carteira_evento where tenant_id = $1', [tenantId]))
      .rows[0]?.total,
  );
  const repetida = await admin.request.post('/api/proxy/carteiras/alteracoes', {
    data: { origem: 'INDIVIDUAL', usuarios: [{ id: colabId, revisao }], adicionar: [alfaId], remover: [] },
  });
  expect(repetida.status()).toBe(201);
  expect(((await repetida.json()) as { aplicado: boolean }).aplicado).toBe(false);
  expect(
    Number(
      (await pool.query<{ total: string }>('select count(*)::text as total from app.carteira_evento where tenant_id = $1', [tenantId]))
        .rows[0]?.total,
    ),
  ).toBe(eventosAntes);
  expect(await revisaoDaCarteira(colabId)).toBe(revisao);
});

test('remover pede confirmação com o impacto; vale na próxima requisição e o acesso some', async () => {
  await admin.goto(`/configuracoes/usuarios/carteiras/${colabId}`);
  await expect(admin.getByRole('heading', { level: 2, name: COLAB_NOME })).toBeVisible();

  await admin.getByRole('checkbox', { name: NOME_BETA }).uncheck();
  const resumo = admin.getByRole('region', { name: 'Resumo antes de salvar' });
  await expect(resumo).toContainText(NOME_BETA);
  await resumo.getByRole('button', { name: 'Salvar carteira' }).click();

  // Confirmação nomeia o colaborador e a empresa, e diz que o acesso só volta com nova atribuição.
  const confirmacao = admin.getByRole('alertdialog');
  await expect(confirmacao).toContainText(COLAB_NOME);
  await expect(confirmacao).toContainText(NOME_BETA);
  await expect(confirmacao).toContainText(/nova atribuição/i);
  expect(await vinculosAtivos(colabId)).toContain(betaId);

  await confirmacao.getByRole('button', { name: 'Remover e salvar' }).click();
  await expect(admin.getByText('Carteira atualizada.').first()).toBeVisible();
  expect(await vinculosAtivos(colabId)).toEqual([alfaId]);

  // A mesma sessão, sem novo login: a Beta agora responde 403, a Alfa continua aberta.
  expect((await colab.request.get(`/api/proxy/empresas/${betaId}`)).status()).toBe(403);
  expect((await colab.request.get(`/api/proxy/empresas/${alfaId}`)).status()).toBe(200);

  // O vínculo removido virou histórico (sem DELETE) e a remoção está no Histórico de Informações.
  const encerrado = await pool.query<{ encerrado_motivo: string }>(
    `select encerrado_motivo from app.carteira_vinculo
      where usuario_id = $1 and empresa_id = $2 and encerrado_em is not null`,
    [colabId, betaId],
  );
  expect(encerrado.rows[0]?.encerrado_motivo).toBe('REMOCAO');

  await admin.goto('/historico?aba=CARTEIRAS');
  const evento = admin.getByRole('list', { name: 'Eventos de carteira' }).getByRole('listitem').first();
  await expect(evento).toContainText('Atribuição individual');
  await expect(evento).toContainText(NOME_BETA);
  await expect(evento).toContainText('Removidas (1)');
});

test('arquivar a empresa encerra os vínculos; reativar não restaura e exige nova atribuição', async () => {
  expect(await vinculosAtivos(colabId)).toEqual([alfaId]);

  await arquivar(alfaId);

  // Todos os vínculos ativos da empresa foram encerrados, com o motivo registrado.
  expect(await vinculosAtivos(colabId)).toEqual([]);
  expect(await vinculosAtivos(adminId)).toEqual([]);
  const motivos = await pool.query<{ encerrado_motivo: string }>(
    `select distinct encerrado_motivo from app.carteira_vinculo
      where empresa_id = $1 and encerrado_motivo = 'ARQUIVAMENTO_EMPRESA'`,
    [alfaId],
  );
  expect(motivos.rows).toHaveLength(1);

  // Decisão do PI: o admin alcança empresa ARQUIVADA sem vínculo para poder reativá-la.
  expect((await admin.request.get(`/api/proxy/empresas/${alfaId}`)).status()).toBe(200);
  // A colaboradora não tem esse caminho, e uma empresa ATIVA fora da carteira continua negada ao admin.
  expect((await colab.request.get(`/api/proxy/empresas/${alfaId}`)).status()).toBe(403);
  expect((await admin.request.get(`/api/proxy/empresas/${betaId}`)).status()).toBe(403);

  // O aviso do arquivamento chegou ao colaborador, mesmo sem nenhuma empresa na carteira dele.
  await colab.goto('/carteira');
  await colab.getByRole('button', { name: 'Notificações' }).click();
  await expect(colab.getByRole('dialog').getByText('Sua carteira foi atualizada').first()).toBeVisible();
  await colab.keyboard.press('Escape');
  await expect(colab.getByText('Você ainda não tem empresas na sua carteira')).toBeVisible();

  // Reativar não restaura nada.
  const reativacao = await admin.request.post(`/api/proxy/empresas/${alfaId}/manutencao/reativar`, {
    data: { justificativa: 'Retomou as atividades.' },
  });
  expect(reativacao.status()).toBe(200);
  expect(await vinculosAtivos(colabId)).toEqual([]);
  expect(await vinculosAtivos(adminId)).toEqual([]);
  expect((await colab.request.get(`/api/proxy/empresas/${alfaId}`)).status()).toBe(403);

  // Nova atribuição pela aba "Colaboradores" da empresa: ela exige o vínculo do admin, que foi encerrado,
  // então o admin se atribui pela Central e depois adiciona a colaboradora pela aba da empresa.
  await admin.goto(`/configuracoes/usuarios/carteiras/${adminId}`);
  await admin.getByRole('checkbox', { name: NOME_ALFA }).check();
  await admin.getByRole('region', { name: 'Resumo antes de salvar' }).getByRole('button', { name: 'Salvar carteira' }).click();
  await expect(admin.getByText('Carteira atualizada.').first()).toBeVisible();

  await admin.goto(`/empresas/${alfaId}`);
  await admin.getByRole('tab', { name: 'Colaboradores' }).click();
  await admin.getByRole('button', { name: /Adicionar colaboradores/ }).click();
  await admin.getByRole('checkbox', { name: COLAB_NOME }).check();
  await admin.getByRole('button', { name: 'Adicionar e salvar' }).click();
  await expect(admin.getByText('Carteira atualizada.').first()).toBeVisible();

  expect(await vinculosAtivos(colabId)).toEqual([alfaId]);
  expect((await colab.request.get(`/api/proxy/empresas/${alfaId}`)).status()).toBe(200);
});

test('remover pela aba Colaboradores da empresa exige confirmação e encerra o vínculo', async () => {
  await admin.goto(`/empresas/${alfaId}`);
  await admin.getByRole('tab', { name: 'Colaboradores' }).click();
  await expect(admin.getByText(COLAB_NOME)).toBeVisible();

  await admin.getByRole('button', { name: `Remover ${COLAB_NOME} desta empresa` }).click();
  await expect(admin.getByRole('alertdialog')).toContainText(/nova atribuição/i);
  await admin.getByRole('button', { name: 'Remover acesso' }).click();
  await expect(admin.getByText('Carteira atualizada.').first()).toBeVisible();

  expect(await vinculosAtivos(colabId)).toEqual([]);
  // O admin segue sozinho nesta empresa: a lista mostra só ele.
  await expect(admin.getByText(COLAB_NOME)).toHaveCount(0);

  // Devolve a Alfa à colaboradora para o próximo contrafactual.
  const revisao = await revisaoDaCarteira(colabId);
  const devolucao = await admin.request.post('/api/proxy/carteiras/alteracoes', {
    data: { origem: 'INDIVIDUAL', usuarios: [{ id: colabId, revisao }], adicionar: [alfaId], remover: [] },
  });
  expect(devolucao.status()).toBe(201);
});

test('arquivar o usuário encerra os vínculos sem notificá-lo; o retorno exige nova atribuição', async () => {
  expect(await vinculosAtivos(colabId)).toEqual([alfaId]);
  const notificacoesAntes = Number(
    (await pool.query<{ total: string }>('select count(*)::text as total from app.carteira_notificacao where usuario_id = $1', [colabId]))
      .rows[0]?.total,
  );

  // Suspender preserva os vínculos (o usuário só não acessa nada enquanto suspenso).
  expect((await admin.request.post(`/api/proxy/usuarios/${colabId}/suspender`)).status()).toBe(200);
  expect(await vinculosAtivos(colabId)).toEqual([alfaId]);
  expect((await admin.request.post(`/api/proxy/usuarios/${colabId}/reativar`)).status()).toBe(200);
  expect(await vinculosAtivos(colabId)).toEqual([alfaId]);

  expect((await admin.request.post(`/api/proxy/usuarios/${colabId}/arquivar`)).status()).toBe(200);
  expect(await vinculosAtivos(colabId)).toEqual([]);

  const encerrado = await pool.query<{ encerrado_motivo: string }>(
    `select encerrado_motivo from app.carteira_vinculo
      where usuario_id = $1 and empresa_id = $2 and encerrado_em is not null
      order by encerrado_em desc limit 1`,
    [colabId, alfaId],
  );
  expect(encerrado.rows[0]?.encerrado_motivo).toBe('ARQUIVAMENTO_USUARIO');
  expect(
    Number(
      (await pool.query<{ total: string }>('select count(*)::text as total from app.carteira_notificacao where usuario_id = $1', [colabId]))
        .rows[0]?.total,
    ),
  ).toBe(notificacoesAntes);

  // Usuário arquivado não recebe carteira: o lote é recusado por inteiro.
  const tentativa = await admin.request.post('/api/proxy/carteiras/alteracoes', {
    data: {
      origem: 'INDIVIDUAL',
      usuarios: [{ id: colabId, revisao: await revisaoDaCarteira(colabId) }],
      adicionar: [alfaId],
      remover: [],
    },
  });
  expect(tentativa.status()).toBe(422);
  expect(await vinculosAtivos(colabId)).toEqual([]);

  await admin.goto('/historico?aba=CARTEIRAS&origem=ARQUIVAMENTO_USUARIO');
  await expect(
    admin.getByRole('list', { name: 'Eventos de carteira' }).getByText('Arquivamento do usuário'),
  ).toBeVisible();
});

test('menu: Minha carteira está no menu e a Central de Carteiras é a aba do administrador', async () => {
  await admin.goto('/empresas');
  await expect.poll(() => itensDoMenu(admin)).toContain('Minha carteira');

  await admin.goto('/configuracoes/usuarios?aba=carteiras');
  await expect(admin.getByRole('tab', { name: 'Central de Carteiras' })).toHaveAttribute(
    'data-state',
    'active',
  );
});

// -- Provas visuais (FRONTEND.md §20.1): dois temas, 768 / 1024 / 1440 -------------------------------

const LARGURAS = [768, 1024, 1440] as const;
const TEMAS = ['light', 'dark'] as const;

const definirTema = async (page: Page, tema: (typeof TEMAS)[number]): Promise<void> => {
  await page.evaluate((valor) => localStorage.setItem('contaia-theme', valor), tema);
  await page.reload();
};

const semRolagemHorizontal = async (page: Page): Promise<boolean> =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test('provas visuais nos dois temas e nas três larguras', async () => {
  test.setTimeout(540_000);
  mkdirSync(`test-results/${ESCOPO}/capturas-f9`, { recursive: true });

  // A colaboradora foi arquivada (identidade desabilitada, sessões encerradas): para as capturas ela
  // volta ao estado ativo, a identidade é reabilitada e ela entra de novo.
  await pool.query(`update app.usuario set estado = 'ATIVO' where id = $1`, [colabId]);
  await reabilitarIdentidade(COLAB_USUARIO);
  await contextoDaColab.close();
  contextoDaColab = await navegador.newContext();
  colab = await contextoDaColab.newPage();
  await entrarComo(colab, COLAB_USUARIO, COLAB_SENHA);

  // Estado de partida legível: a colaboradora volta a ter a Alfa e a Beta na carteira.
  const revisao = await revisaoDaCarteira(colabId);
  await admin.request.post('/api/proxy/carteiras/alteracoes', {
    data: { origem: 'LOTE', usuarios: [{ id: colabId, revisao }], adicionar: [alfaId, betaId], remover: [] },
  });

  for (const tema of TEMAS) {
    for (const largura of LARGURAS) {
      const capturar = async (page: Page, nome: string): Promise<void> => {
        expect(await semRolagemHorizontal(page), `${nome} ${tema} ${largura}px sem rolagem horizontal`).toBe(true);
        await page.screenshot({
          path: `test-results/${ESCOPO}/capturas-f9/${tema}-${largura}-${nome}.png`,
          fullPage: true,
        });
      };

      await admin.setViewportSize({ width: largura, height: 900 });

      // Central de Carteiras
      await admin.goto('/configuracoes/usuarios?aba=carteiras');
      await definirTema(admin, tema);
      await admin.getByText(/colaboradores? encontrados?\./).waitFor();
      await capturar(admin, 'central');

      // Seleção em lote com o diálogo aberto
      // Tabela e cartões coexistem no DOM; o CSS esconde um deles, e a consulta por papel só vê o visível.
      await admin.getByRole('checkbox', { name: 'Selecionar Administrador E2E' }).check();
      await admin.getByRole('button', { name: /Adicionar empresas/ }).click();
      await admin.getByRole('dialog').getByRole('checkbox', { name: NOME_ALFA }).waitFor();
      await capturar(admin, 'dialogo-de-lote');
      await admin.keyboard.press('Escape');

      // Gestão individual com alteração pendente
      await admin.goto(`/configuracoes/usuarios/carteiras/${colabId}`);
      await admin.getByRole('checkbox', { name: NOME_ALFA }).waitFor();
      await admin.getByRole('checkbox', { name: NOME_ALFA }).uncheck();
      await capturar(admin, 'gestao-individual');

      // Aba Colaboradores da empresa
      await admin.goto(`/empresas/${alfaId}`);
      await admin.getByRole('tab', { name: 'Colaboradores' }).click();
      await admin.getByText(/atuam? nesta empresa\.|Nenhum colaborador tem esta empresa/).waitFor();
      await capturar(admin, 'aba-colaboradores');

      // Histórico de Informações → Carteiras
      await admin.goto('/historico?aba=CARTEIRAS');
      await admin.getByRole('list', { name: 'Eventos de carteira' }).waitFor();
      await capturar(admin, 'historico-de-carteiras');

      // Minha carteira e sino da colaboradora
      await colab.setViewportSize({ width: largura, height: 900 });
      await colab.goto('/carteira');
      await definirTema(colab, tema);
      await colab.getByRole('heading', { level: 1, name: 'Minha carteira' }).waitFor();
      await capturar(colab, 'minha-carteira');

      // Empresa fora da carteira
      await colab.goto(`/empresas/${deltaId}`);
      await colab.getByText('Esta empresa não está na sua carteira').waitFor();
      await capturar(colab, 'fora-da-carteira');
    }
  }
});
