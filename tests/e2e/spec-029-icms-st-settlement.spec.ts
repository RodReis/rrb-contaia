import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import {
  cnpjValido,
  criarEmpresa,
  criarEscritorio,
  criarIdentidade,
  criarUsuario,
  entrarComo,
  limparEscritorios,
  removerIdentidadesComPrefixo,
  vincular,
  type Pessoa,
} from './fixtures/ambiente';
import { provarVisualmente, type AchadosVisuais } from './fixtures/plano-contas';
import { ResultadoApuracaoIcmsStSchema } from '../../apps/web/src/features/fiscal-documents/api';

const PREFIXO = `e2e-f29-${randomUUID()}`;
const ADMIN: Pessoa = { usuario: PREFIXO, senha: `${PREFIXO}-senha-123456`, nome: 'Contadora F29' };
const CNPJ_ESCRITORIO = cnpjValido('299293290001');
const CNPJ_EMPRESA = cnpjValido('299293290002');
const CAMINHO = resolve('test-results/SPEC-029/e2e/provas');
const pool = new Pool({ connectionString: process.env['DATABASE_URL'] ?? 'postgresql://contaia:contaia_local@127.0.0.1:15432/contaia' });

test.describe.configure({ mode: 'serial' });
test.use({ trace: 'off', video: 'off', screenshot: 'off' });

let context: BrowserContext;
let page: Page;
let companyId = '';
let achados: AchadosVisuais | null = null;

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  test.setTimeout(240_000);
  await limparEscritorios(pool, [CNPJ_ESCRITORIO]);
  await removerIdentidadesComPrefixo(PREFIXO);
  const tenantId = await criarEscritorio(pool, CNPJ_ESCRITORIO, 'Escritório sintético E2E F29');
  const userId = await criarUsuario(pool, tenantId, await criarIdentidade(ADMIN), ADMIN, 'contador');
  companyId = await criarEmpresa(pool, tenantId, CNPJ_EMPRESA, 'Autopeças sintéticas E2E F29');
  await vincular(pool, tenantId, userId, companyId);
  context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await context.newPage();
  await entrarComo(page, ADMIN, `/empresas/${companyId}`);
  await page.goto(`/empresas/${companyId}?aba=captura-dfe`);
  await expect(page.getByRole('tab', { name: 'Captura DF-e' })).toBeVisible();
});

test.afterAll(async () => {
  await context?.close();
  await limparEscritorios(pool, [CNPJ_ESCRITORIO]);
  await removerIdentidadesComPrefixo(PREFIXO);
  await pool.end();
});

test('F29 mantém apuração e revisão bloqueadas sem pacote/documentos; prova temas e larguras', async () => {
  test.setTimeout(120_000);
  mkdirSync(CAMINHO, { recursive: true });
  await expect(page.getByRole('tab', { name: 'Captura DF-e' })).toHaveAttribute('data-state', 'active');
  await expect(page.getByRole('heading', { name: 'Complemento ou restituição de ICMS-ST' })).toBeVisible();
  await expect(page.getByText(/permanecem bloqueados, sem total estimado/u)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Apurar competência' })).toBeEnabled();
  const processamento = page.waitForResponse((resposta) => resposta.url().includes('/fiscal-documents/icms-st-settlements') && resposta.request().method() === 'POST');
  await page.getByRole('button', { name: 'Apurar competência' }).click();
  const respostaProcessamento = await processamento;
  expect(respostaProcessamento.ok(), `API F29 recusou processamento: ${respostaProcessamento.status()}`).toBeTruthy();
  const corpoProcessamento: unknown = await respostaProcessamento.json();
  const resultadoProcessamento = ResultadoApuracaoIcmsStSchema.safeParse(corpoProcessamento);
  expect(resultadoProcessamento.success,
    `Resposta da API F29 não corresponde ao contrato: ${JSON.stringify({ corpo: corpoProcessamento,
      issues: resultadoProcessamento.success ? [] : resultadoProcessamento.error.issues })}`,
  ).toBeTruthy();
  const aviso = page.locator('[data-sonner-toast]');
  await expect(aviso).toBeVisible({ timeout: 5_000 });
  await expect(aviso).toContainText('Apuração bloqueada');
  await expect(page.getByRole('heading', { name: /Resultado · revisão/u })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Bloqueada', { exact: true })).toBeVisible();
  await expect(page.getByText(/Sem regra oficial publicada aplicável/u)).toBeVisible();
  await expect(page.getByRole('button', { name: /Submissão indisponível|Aprovar|Rejeitar/u })).toHaveCount(0);

  achados = await provarVisualmente(page, CAMINHO, 'f29-bloqueio-sem-cobertura', {
    pronto: (alvo) => alvo.getByRole('heading', { name: 'Complemento ou restituição de ICMS-ST' }),
    semToasts: true,
    recorte: (alvo) => alvo.locator('section[aria-labelledby="apuracao-icms-st-title"]'),
  });
});

test('F29 não apresenta violações críticas nem rolagem horizontal nas provas visuais', () => {
  expect(achados).not.toBeNull();
  expect(achados?.rolagens).toEqual([]);
  for (const [tema, violacoes] of Object.entries(achados?.violacoes ?? {})) {
    expect(violacoes.filter((violacao) => violacao.impacto === 'critical'), `${tema}: axe`).toEqual([]);
  }
});
