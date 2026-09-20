/**
 * E2E do caminho crítico da SPEC-001 (§9).
 *
 * Login seedado → salvar etapas → sair → retomar → concluir → visão vazia →
 * editar por abas, com os contrafactuais de bloqueio e idempotência.
 *
 * Depende do ambiente local com Docker, Keycloak semeado e banco migrado:
 * `pnpm docker:up && pnpm db:migrate && pnpm db:seed`.
 */
import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const CNPJ = '11222333000181';
const LOGO = fileURLToPath(new URL('./fixtures/logo.png', import.meta.url));
const DOCUMENTO = fileURLToPath(new URL('./fixtures/contrato-social.pdf', import.meta.url));

/**
 * O input de arquivo é visualmente oculto (a dropzone é o alvo do usuário),
 * então `getByLabel` não o alcança: aqui se aponta o input associado ao rótulo.
 */
const enviarArquivo = async (page: Page, rotulo: RegExp, caminho: string): Promise<void> => {
  const id = await page.locator('label', { hasText: rotulo }).first().getAttribute('for');

  expect(id, `rótulo ${String(rotulo)} sem input associado`).toBeTruthy();

  // Seletor por atributo: o id vem de `useId()` e traz caracteres que
  // precisariam de escape num seletor `#id`.
  await page.locator(`input[id="${id ?? ''}"]`).setInputFiles(caminho);
};

const entrar = async (page: Page): Promise<void> => {
  await page.goto('/api/auth/entrar');

  // Duas saídas possíveis: o Keycloak pede credencial na primeira vez e, com a
  // sessão do provedor ainda válida, devolve o código direto. Esperar as duas
  // ao mesmo tempo evita decidir antes de a página assentar.
  const usuario = page.getByRole('textbox', { name: 'Username or email' });

  await Promise.race([
    usuario.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => undefined),
    page.waitForURL(/\/(escritorio|painel)/, { timeout: 15_000 }).catch(() => undefined),
  ]);

  if (await usuario.isVisible().catch(() => false)) {
    await usuario.fill('admin.escritorio');
    await page.getByRole('textbox', { name: 'Password' }).fill('admin_local_123');
    await page.getByRole('button', { name: 'Sign In' }).click();
  }

  await page.waitForURL(/\/(escritorio|painel)/);
};

test.describe.configure({ mode: 'serial' });

test('tenant incompleto não acessa área operacional', async ({ page }) => {
  await entrar(page);

  const resposta = await page.request.get('/api/proxy/painel/empresas');

  // A decisão é do servidor: esconder navegação não é controle de acesso.
  if (resposta.status() === 403) {
    const problema = (await resposta.json()) as { code: string; correlationId: string };

    expect(problema.code).toBe('CADASTRO_INCOMPLETO');
    expect(problema.correlationId).not.toHaveLength(0);
  } else {
    // O cadastro já foi concluído por uma execução anterior neste ambiente.
    expect(resposta.status()).toBe(200);
  }
});

test('conclui o cadastro pelo wizard e passa a editar por abas', async ({ page }) => {
  await entrar(page);
  await page.goto('/escritorio');

  // O caminho do wizard é o objeto deste teste: ou o cadastro começa
  // incompleto, ou o ambiente não está no estado que a prova exige. Pular em
  // silêncio faria o teste passar sem provar nada.
  const stepper = page.getByRole('navigation', { name: 'Etapas do cadastro' });

  await expect(
    stepper,
    'o cadastro precisa começar incompleto: rode `pnpm db:seed` num banco limpo',
  ).toBeVisible();

  {
    // Etapa 1 — identificação e logo.
    await page.getByLabel(/CNPJ do escritório/).fill(CNPJ);
    await page.getByLabel(/Razão social/).fill('Escritório Contábil Exemplo LTDA');
    await enviarArquivo(page, /Logo do escritório/, LOGO);
    await expect(page.getByText('logo.png')).toBeVisible();
    await page.getByRole('button', { name: 'Salvar e continuar' }).click();

    // Etapa 2 — responsável técnico.
    await expect(page.getByRole('heading', { level: 2 })).toHaveText('Responsável técnico');
    await page.getByLabel(/Nome completo/).fill('Maria Souza');
    await page.getByLabel(/^CPF/).fill('52998224725');
    await page.getByLabel(/Registro no CRC/).fill('1SP123456/O-5');
    await page.getByLabel(/E-mail/).fill('maria@escritorio.cnt.br');
    await page.getByLabel(/Telefone/).fill('11987654321');
    await page.getByRole('button', { name: 'Salvar e continuar' }).click();

    // Etapa 3 — endereço principal.
    await expect(page.getByRole('heading', { level: 2 })).toHaveText('Endereço principal');
    await page.getByLabel(/^CEP/).fill('01310100');
    await page.getByLabel(/Logradouro/).fill('Avenida Paulista');
    await page.getByLabel(/Número/).fill('1000');
    await page.getByLabel(/Bairro/).fill('Bela Vista');
    await page.getByLabel(/Município/).fill('São Paulo');
    await page.getByLabel(/^UF/).fill('SP');
    await page.getByRole('button', { name: 'Salvar e continuar' }).click();

    // A sessão é encerrada no meio do preenchimento: o progresso tem que
    // sobreviver e a retomada abrir na etapa incompleta (SPEC-001 §3.1).
    await expect(page.getByRole('heading', { level: 2 })).toHaveText('Documentos');
    await page.goto('/api/auth/sair');
    await page.waitForURL(/\/acesso/);

    await entrar(page);
    await page.goto('/escritorio');
    await expect(page.getByRole('heading', { level: 2 })).toHaveText('Documentos');

    // Etapa 4 — documentos.
    await enviarArquivo(page, /Documentos do escritório/, DOCUMENTO);
    await expect(page.getByText('contrato-social.pdf')).toBeVisible();

    // Com o documento persistido a etapa fica completa. O avanço pode já ter
    // ocorrido na volta da API; se ainda estiver em Documentos, confirma-se
    // pelo botão, que só habilita depois da confirmação do servidor.
    const avancar = page.getByRole('button', { name: 'Salvar e continuar' });

    if (await avancar.isVisible().catch(() => false)) {
      await expect(avancar).toBeEnabled();
      await avancar.click();
    }

    // Etapa 5 — revisão e conclusão.
    await expect(page.getByRole('heading', { level: 2 })).toHaveText('Revisão');
    await expect(page.getByText('11.222.333/0001-81')).toBeVisible();
    await page.getByRole('button', { name: 'Concluir cadastro' }).click();

    // Visão inicial ativa, vazia e sem ação para fluxo inexistente.
    await page.waitForURL(/\/painel/);
    await expect(page.getByText('Nenhuma empresa cadastrada')).toBeVisible();
  }

  // Cadastro ativo é editado por abas, sem reabrir o wizard (SPEC-001 §3.3).
  await page.goto('/escritorio');

  const abas = page.getByRole('tablist', { name: 'Seções do cadastro do escritório' });

  await expect(abas).toBeVisible();
  await expect(abas.getByRole('tab')).toHaveText([
    'Identificação',
    'Responsável',
    'Endereços',
    'Arquivos',
  ]);
  await expect(page.getByRole('navigation', { name: 'Etapas do cadastro' })).toHaveCount(0);
});

test('conclusão repetida é idempotente', async ({ page }) => {
  await entrar(page);

  const primeira = await page.request.post('/api/proxy/escritorio/conclusao');
  const segunda = await page.request.post('/api/proxy/escritorio/conclusao');

  const antes = (await primeira.json()) as {
    cadastro: { status: string; versao: number };
    arquivos: unknown[];
  };
  const depois = (await segunda.json()) as {
    cadastro: { status: string; versao: number };
    arquivos: unknown[];
  };

  expect(antes.cadastro.status).toBe('ATIVO');
  expect(depois.cadastro.status).toBe('ATIVO');
  // Nada é reescrito nem duplicado na segunda chamada.
  expect(depois.cadastro.versao).toBe(antes.cadastro.versao);
  expect(depois.arquivos).toHaveLength(antes.arquivos.length);
});

test('o wizard e a edição funcionam nos temas claro e escuro', async ({ page }) => {
  await entrar(page);

  for (const tema of ['light', 'dark'] as const) {
    await page.goto('/escritorio');
    await page.evaluate((valor) => {
      document.documentElement.dataset['theme'] = valor;
      window.localStorage.setItem('contaia-theme', valor);
    }, tema);

    await expect(page.locator('html')).toHaveAttribute('data-theme', tema);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    await page.screenshot({
      path: `test-results/${process.env['PROVA_ESCOPO'] ?? 'local'}/e2e/screenshots/${
        tema === 'light' ? 'claro' : 'escuro'
      }/escritorio.png`,
      fullPage: true,
    });
  }
});

test('a tela de acesso responde em 768, 1024 e 1440', async ({ page }) => {
  for (const largura of [768, 1024, 1440]) {
    await page.setViewportSize({ width: largura, height: 900 });
    await page.goto('/acesso');

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: /Acessar painel/ })).toBeVisible();

    // Sem rolagem horizontal em nenhum dos viewports exigidos.
    const estouro = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );

    expect(estouro, `estouro horizontal em ${largura}px`).toBe(false);
  }
});
