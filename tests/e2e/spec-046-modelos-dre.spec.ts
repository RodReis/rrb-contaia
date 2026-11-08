import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

import {
  cnpjValido, criarEmpresa, criarEscritorio, criarIdentidade, criarUsuario, entrarComo,
  limparEscritorios, removerIdentidadesComPrefixo, vincular, type Pessoa,
} from './fixtures/ambiente';
import { provarVisualmente, type AchadosVisuais } from './fixtures/plano-contas';

const PREFIXO = `e2e-f46-${randomUUID()}`;
const CONTADOR: Pessoa = { usuario: PREFIXO, senha: `${PREFIXO}-senha-123456`, nome: 'Contador F46' };
const CNPJ_ESCRITORIO = cnpjValido(randomUUID().replace(/\D/gu, '').slice(0, 12));
const CNPJ_EMPRESA = cnpjValido(randomUUID().replace(/\D/gu, '').slice(0, 12));
const CAMINHO = `test-results/${process.env['PROVA_ESCOPO'] ?? 'SPEC-046'}/e2e/provas/spec-046`;
const pool = new Pool({ connectionString: process.env['DATABASE_URL'] ?? 'postgresql://contaia:contaia_local@127.0.0.1:15432/contaia' });

let context: BrowserContext;
let page: Page;
let tenantId = '';
let companyId = '';
let achados: AchadosVisuais | null = null;

test.describe.configure({ mode: 'serial' });
test.use({ trace: 'retain-on-failure', video: 'off', screenshot: 'only-on-failure' });

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  test.setTimeout(120_000);
  await limparEscritorios(pool, [CNPJ_ESCRITORIO]);
  await removerIdentidadesComPrefixo(PREFIXO);
  tenantId = await criarEscritorio(pool, CNPJ_ESCRITORIO, 'Escritório sintético E2E F46');
  const userId = await criarUsuario(pool, tenantId, await criarIdentidade(CONTADOR), CONTADOR, 'contador');
  companyId = await criarEmpresa(pool, tenantId, CNPJ_EMPRESA, 'Empresa sintética E2E F46');
  await vincular(pool, tenantId, userId, companyId);

  context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await context.newPage();
  await entrarComo(page, CONTADOR, '/contabil/modelos-dre');
});

test.afterAll(async () => {
  await context?.close();
  if (tenantId) await limparEscritorios(pool, [CNPJ_ESCRITORIO]);
  await removerIdentidadesComPrefixo(PREFIXO);
  await pool.end();
});

test('F46 cria, publica e aplica uma versão como rascunho independente', async () => {
  test.setTimeout(120_000);
  const nome = `Modelo E2E ${PREFIXO.slice(-8)}`;
  await expect(page.getByRole('heading', { name: 'Modelos de DRE' })).toBeVisible();
  await page.getByRole('button', { name: 'Novo modelo' }).click();
  const formulario = page.getByRole('region', { name: 'Novo modelo manual' });
  await formulario.getByRole('textbox', { name: 'Nome do modelo' }).fill(nome);
  await formulario.getByRole('textbox', { name: 'Descrição' }).fill('Estrutura para prova automatizada.');
  const criar = page.waitForResponse((response) => response.request().method() === 'POST' && /\/api\/proxy\/contabil\/modelos-dre$/u.test(response.url()));
  await formulario.getByRole('button', { name: 'Criar rascunho' }).click();
  const criado = await criar;
  expect(criado.ok(), `Criação recusada: ${criado.status()} ${await criado.text()}`).toBe(true);

  await expect(page.getByRole('heading', { name: nome })).toBeVisible();
  await page.getByRole('button', { name: 'Linha de detalhe' }).click();
  await page.getByRole('textbox', { name: 'Código da linha 1' }).fill('RECEITA');
  await page.getByRole('textbox', { name: 'Título', exact: true }).fill('Receita da prova');
  await page.getByRole('radio', { name: 'Definir Receita da prova como base da análise vertical' }).check();

  const salvar = page.waitForResponse((response) => response.request().method() === 'PUT' && response.url().includes('/linhas'));
  await page.getByRole('button', { name: 'Salvar rascunho' }).click();
  const salvo = await salvar;
  expect(salvo.ok(), `Salvamento recusado: ${salvo.status()} ${await salvo.text()}`).toBe(true);

  const publicar = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().includes('/publicar'));
  await page.getByRole('button', { name: 'Publicar versão' }).click();
  const publicada = await publicar;
  expect(publicada.ok(), `Publicação recusada: ${publicada.status()} ${await publicada.text()}`).toBe(true);
  await expect(page.getByRole('heading', { name: 'Aplicar a uma empresa' })).toBeVisible();

  achados = await provarVisualmente(page, CAMINHO, 'biblioteca-publicada', {
    pronto: (target) => target.getByRole('heading', { name: nome }),
    recarregar: false,
    semToasts: true,
  });

  await page.getByRole('combobox', { name: 'Empresa de destino' }).click();
  await page.getByRole('option', { name: 'Empresa sintética E2E F46' }).click();
  await page.getByRole('button', { name: 'Criar rascunho na empresa' }).click();
  await expect(page.getByRole('alertdialog')).toContainText('cópia independente');
  const aplicar = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().includes('/aplicar'));
  await page.getByRole('alertdialog').getByRole('button', { name: 'Criar rascunho' }).click();
  const aplicada = await aplicar;
  expect(aplicada.ok(), `Aplicação recusada: ${aplicada.status()} ${await aplicada.text()}`).toBe(true);
  const resultado = await aplicada.json() as { companyStatementDraftId: string; created: boolean };
  expect(resultado.created).toBe(true);
  await page.waitForURL((url) => url.pathname === '/contabil/dre' && url.searchParams.get('rascunhoId') === resultado.companyStatementDraftId);
  await expect(page.getByRole('textbox', { name: 'Título' })).toHaveValue('Receita da prova');
});

test('F46 mantém prova visual sem rolagem nem violações axe críticas', () => {
  expect(achados).not.toBeNull();
  expect(achados?.rolagens).toEqual([]);
  for (const [theme, violations] of Object.entries(achados?.violacoes ?? []))
    expect(violations.filter((item) => item.impacto === 'critical'), `${theme}: axe`).toEqual([]);
});
