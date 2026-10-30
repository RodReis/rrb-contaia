import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

import { cnpjValido, criarEmpresa, criarEscritorio, criarIdentidade, criarUsuario, entrarComo, limparEscritorios,
  removerIdentidadesComPrefixo, vincular, type Pessoa } from './fixtures/ambiente';
import { provarVisualmente, type AchadosVisuais } from './fixtures/plano-contas';

const PREFIXO = `e2e-f45-${randomUUID()}`;
const CONTADOR: Pessoa = { usuario: PREFIXO, senha: `${PREFIXO}-senha-123456`, nome: 'Contador F45' };
const CNPJ_ESCRITORIO = cnpjValido(randomUUID().replace(/\D/gu, '').slice(0, 12));
const CNPJ_EMPRESA = cnpjValido(randomUUID().replace(/\D/gu, '').slice(0, 12));
const CAMINHO = `test-results/${process.env['PROVA_ESCOPO'] ?? 'SPEC-045'}/e2e/provas/spec-045`;
const pool = new Pool({ connectionString: process.env['DATABASE_URL'] ?? 'postgresql://contaia:contaia_local@127.0.0.1:15432/contaia' });
const correlationId = `${PREFIXO}-dre`;
const competence = '2097-04';
const line = (code: string, title: string, order: number, verticalBasis: boolean, accountIds: string[] = []) => ({
  code, title, type: 'DETAIL', order, level: 0, parentCode: null, presentationSign: 1, accountIds, components: [], verticalBasis,
});

let context: BrowserContext;
let page: Page;
let tenantId = '';
let userId = '';
let companyId = '';
let revenueAccountId = '';
let expenseAccountId = '';
let achados: AchadosVisuais | null = null;

test.describe.configure({ mode: 'serial' });
test.use({ trace: 'off', video: 'off', screenshot: 'off' });

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  test.setTimeout(120_000);
  await limparEscritorios(pool, [CNPJ_ESCRITORIO]);
  await removerIdentidadesComPrefixo(PREFIXO);
  tenantId = await criarEscritorio(pool, CNPJ_ESCRITORIO, 'Escritório sintético E2E F45');
  userId = await criarUsuario(pool, tenantId, await criarIdentidade(CONTADOR), CONTADOR, 'contador');
  companyId = await criarEmpresa(pool, tenantId, CNPJ_EMPRESA, 'Empresa sintética DRE F45');
  await vincular(pool, tenantId, userId, companyId);

  const setup = await pool.connect();
  try {
    await setup.query('begin');
    await setup.query(`select set_config('app.tenant_id',$1,true),set_config('app.usuario_id',$2,true),set_config('app.correlation_id',$3,true)`, [tenantId, userId, correlationId]);
    const accounts = await setup.query<{ id: string; class: string }>(
      `insert into app.conta_contabil(tenant_id,empresa_id,codigo,nome,tipo,natureza,classe_contabil,politica_centro_custo)
       values($1,$2,$3,'Receita sintética da demonstração','analitica','credora','REVENUE','OPTIONAL'),
         ($1,$2,$4,'Despesa sintética da demonstração','analitica','devedora','EXPENSE','OPTIONAL') returning id,classe_contabil as class`,
      [tenantId, companyId, `${PREFIXO}-receita`, `${PREFIXO}-despesa`],
    );
    revenueAccountId = accounts.rows.find((item) => item.class === 'REVENUE')?.id ?? '';
    expenseAccountId = accounts.rows.find((item) => item.class === 'EXPENSE')?.id ?? '';

    const projectionVersion = (await setup.query<{ id: string }>(
      `insert into app.projecao_razao_versao(tenant_id,empresa_id,numero,estado,criado_por,correlation_id,ativado_em)
       values($1,$2,1,'ACTIVE',$3,$4,now()) returning id`, [tenantId, companyId, userId, correlationId],
    )).rows[0]?.id;
    if (!projectionVersion || !revenueAccountId || !expenseAccountId) throw new Error('Fixtures contábeis F45 incompletas.');
    await setup.query(`insert into app.projecao_razao(tenant_id,empresa_id,versao_ativa_id,numero_versao,integridade)
      values($1,$2,$3,1,'CONSISTENT')`, [tenantId, companyId, projectionVersion]);
    for (const [accountId, code, name, side, cents, counterpartId, counterpartSide, counterpartCents] of [
      [revenueAccountId, `${PREFIXO}-receita`, 'Receita sintética da demonstração', 'CREDIT', 12500, expenseAccountId, 'DEBIT', 12500],
      [expenseAccountId, `${PREFIXO}-despesa`, 'Despesa sintética da demonstração', 'DEBIT', 4300, revenueAccountId, 'CREDIT', 4300],
    ] as const) {
      const entry = (await setup.query<{ id: string }>(
        `insert into app.lancamento_contabil(tenant_id,empresa_id,exercicio,data_contabil,competencia,historico,criado_por)
         values($1,$2,2097,'2097-04-15',$3,'Movimento sintético da prova visual F45',$4) returning id`,
        [tenantId, companyId, competence, userId],
      )).rows[0]?.id;
      if (!entry) throw new Error(`Lançamento sintético da conta ${code} não foi criado.`);
      const postings = (await setup.query<{ id: string }>(
        `insert into app.lancamento_contabil_partida(tenant_id,empresa_id,lancamento_id,conta_id,lado,valor_centavos,posicao)
         values($1,$2,$3,$4,$5,$6,0),($1,$2,$3,$7,$8,$9,1) returning id`,
        [tenantId, companyId, entry, accountId, side, cents, counterpartId, counterpartSide, counterpartCents],
      )).rows;
      const event = (await setup.query<{ id: string }>(
        `insert into app.lancamento_contabil_evento(tenant_id,empresa_id,lancamento_id,acao,estado_anterior,estado_novo,numero,usuario_id,correlation_id)
         values($1,$2,$3,'EFETIVADO','DRAFT','POSTED',$4,$5,$6) returning id`,
        [tenantId, companyId, entry, side === 'CREDIT' ? 1 : 2, userId, correlationId],
      )).rows[0]?.id;
      if (postings.length !== 2 || !event) throw new Error(`Movimento sintético da conta ${code} não foi criado.`);
      await setup.query(`select set_config('app.lancamento_contabil_transicao','true',true)`);
      await setup.query(`update app.lancamento_contabil set estado='POSTED',numero=$1,efetivado_por=$2 where id=$3`,
        [side === 'CREDIT' ? 1 : 2, userId, entry]);
      for (const [position, posting] of postings.entries()) await setup.query(
        `insert into app.movimento_razao(tenant_id,empresa_id,versao_id,lancamento_id,partida_id,evento_origem_id,competencia,data_contabil,conta_id,codigo_conta,nome_conta,historico,numero_lancamento,posicao,lado,valor_centavos,tipo)
         values($1,$2,$3,$4,$5,$6,$7,'2097-04-15',$8,$9,$10,'Movimento sintético da prova visual F45',$11,$12,$13,$14,'POSTING')`,
        [tenantId, companyId, projectionVersion, entry, posting.id, event, competence,
          position === 0 ? accountId : counterpartId, position === 0 ? code : `${PREFIXO}-${side.toLowerCase()}-contrapartida`,
          position === 0 ? name : 'Contrapartida sintética', side === 'CREDIT' ? 1 : 2, position,
          position === 0 ? side : counterpartSide, position === 0 ? cents : counterpartCents],
      );
    }
    await setup.query(`insert into app.saldo_mensal_razao(tenant_id,empresa_id,versao_id,competencia,conta_id,debitos_centavos,creditos_centavos,movimentos)
      values($1,$2,$3,$4,$5,0,12500,1),($1,$2,$3,$4,$6,4300,0,1)`,
    [tenantId, companyId, projectionVersion, competence, revenueAccountId, expenseAccountId]);
    await setup.query('commit');
  } catch (cause) {
    await setup.query('rollback');
    throw cause;
  } finally {
    setup.release();
  }

  context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await context.newPage();
  await entrarComo(page, CONTADOR, `/empresas/${companyId}?aba=dre-gerencial`);
  await page.goto(`/empresas/${companyId}?aba=dre-gerencial&competence=${competence}`);
});

test.afterAll(async () => {
  await context?.close();
  if (tenantId) await limparEscritorios(pool, [CNPJ_ESCRITORIO]);
  await removerIdentidadesComPrefixo(PREFIXO);
  await pool.end();
});

test('F45 consulta e configura a DRE pela tela autenticada com conciliação e conta analítica', async () => {
  test.setTimeout(120_000);
  await expect(page.getByRole('tab', { name: 'DRE gerencial' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'DRE gerencial' })).toBeVisible();
  await page.getByRole('button', { name: 'Configurar estrutura' }).click();
  await expect(page.getByRole('heading', { name: 'Rascunho da estrutura' })).toBeVisible();
  await page.getByLabel('Código', { exact: true }).nth(0).fill('REC');
  await page.getByLabel('Título', { exact: true }).nth(0).fill('Receita operacional');
  await page.getByLabel('Contas analíticas').nth(0).selectOption(revenueAccountId);
  await page.getByLabel('Base da análise vertical').check();
  await page.getByRole('button', { name: 'Adicionar linha' }).click();
  await page.getByLabel('Código', { exact: true }).nth(1).fill('DESP');
  await page.getByLabel('Título', { exact: true }).nth(1).fill('Despesas operacionais');
  await page.getByLabel('Contas analíticas').nth(1).selectOption(expenseAccountId);
  await page.getByRole('button', { name: 'Salvar rascunho' }).click();
  await expect(page.getByText('Estrutura salva.')).toBeVisible();
  await page.getByLabel('Vigência inicial').fill(competence);
  await page.getByRole('button', { name: 'Validar e publicar' }).click();
  await expect(page.getByText('R$ 125,00')).toBeVisible();
  await expect(page.getByText('R$ 43,00')).toBeVisible();

  await page.getByLabel('Visão').selectOption('ANALYTIC');
  await expect(page.getByText('Receita operacional').first()).toBeVisible();
  await page.getByText(/Ver 1 contas/u).first().click();
  await expect(page.getByText('Despesa sintética da demonstração')).toBeVisible();
  await page.getByRole('button', { name: 'CSV analítico' }).click();
  await expect(page.getByText('Exportação concluída.')).toBeVisible();
  await page.waitForTimeout(5_000);
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0, { timeout: 15_000 });

  await page.setViewportSize({ width: 768, height: 900 });
  const mobile = page.locator('[aria-label="DRE em cards empilhados"]');
  await expect(mobile).toBeVisible();
  await expect(mobile.getByText('Atual')).toBeVisible();
  await expect(mobile.getByText('Anterior')).toBeVisible();
  await expect(mobile.getByText('AV', { exact: true })).toBeVisible();
  await expect(mobile.getByText('AH (R$)')).toBeVisible();
  await expect(mobile.getByText('AH (%)')).toBeVisible();

  achados = await provarVisualmente(page, CAMINHO, 'f45-dre-completa-analitica', {
    pronto: (target) => target.locator('[aria-label="DRE em cards empilhados"], table').first(),
    recarregar: false,
    recorte: (target) => target.locator('[aria-label="DRE em cards empilhados"], table').first(),
    semToasts: true,
  });
});

test('F45 captura os seis viewports sem overflow e sem violações axe críticas', () => {
  expect(achados).not.toBeNull();
  expect(achados?.rolagens).toEqual([]);
  for (const [theme, violations] of Object.entries(achados?.violacoes ?? {}))
    expect(violations.filter((item) => item.impacto === 'critical'), `${theme}: axe`).toEqual([]);
});
