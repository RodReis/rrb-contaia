import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

import { cnpjValido, criarEmpresa, criarEscritorio, criarIdentidade, criarUsuario, entrarComo, limparEscritorios,
  removerIdentidadesComPrefixo, vincular, type Pessoa } from './fixtures/ambiente';
import { provarVisualmente, type AchadosVisuais } from './fixtures/plano-contas';

const PREFIXO = `e2e-f41-${randomUUID()}`;
const CONTADOR: Pessoa = { usuario: PREFIXO, senha: `${PREFIXO}-senha-123456`, nome: 'Contador F41' };
const CNPJ_ESCRITORIO = cnpjValido(randomUUID().replace(/\D/gu, '').slice(0, 12));
const CNPJ_EMPRESA = cnpjValido(randomUUID().replace(/\D/gu, '').slice(0, 12));
const CAMINHO = resolve('test-results', process.env['PROVA_ESCOPO'] ?? 'SPEC-041', 'e2e/provas/spec-041');
const pool = new Pool({ connectionString: process.env['DATABASE_URL'] ?? 'postgresql://contaia:contaia_local@127.0.0.1:15432/contaia' });
const BASE_URL = '/api/proxy/companies';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

let context: BrowserContext;
let page: Page;
let tenantId = '';
let userId = '';
let companyId = '';
let matchingDocumentId = '';
let pendingDocumentId = '';
let debitAccountId = '';
let creditAccountId = '';
let achados: AchadosVisuais | null = null;

const createFiscalDocument = async (model: '55' | '65', suffix: string): Promise<string> => {
  const cnpj = CNPJ_EMPRESA.replace(/\D/gu, '');
  const stateId = (await pool.query<{ id: string }>(`insert into app.dfe_capture_state(tenant_id,empresa_id,cnpj)
    values($1,$2,$3) on conflict(tenant_id,empresa_id,cnpj) do update set atualizado_em=app.dfe_capture_state.atualizado_em returning id`,
  [tenantId, companyId, cnpj])).rows[0]?.id;
  if (!stateId) throw new Error('Estado de captura sintético F41 não foi criado.');
  const correlation = `${PREFIXO}-${suffix}`;
  const runId = (await pool.query<{ id: string }>(`insert into app.dfe_capture_run(tenant_id,empresa_id,estado_id,cnpj,origem,usuario_originador_id,
    chave_idempotente,correlation_id,ult_nsu_entrada,estado,finalizado_em)
    values($1,$2,$3,$4,'MANUAL',$5,$6,$6,'0','SUCCEEDED',now()) returning id`,
  [tenantId, companyId, stateId, cnpj, userId, correlation])).rows[0]?.id;
  if (!runId) throw new Error('Captura sintética F41 não foi criada.');
  const stagingId = (await pool.query<{ id: string }>(`insert into app.dfe_capture_staging(tenant_id,empresa_id,run_id,cnpj,nsu,especie,conteudo_bruto,
    capturado_em,correlation_id) values($1,$2,$3,$4,$5,'NFE_55',decode('3c78','hex'),now(),$6) returning id`,
  [tenantId, companyId, runId, cnpj, String(100 + Number(randomUUID().replace(/\D/gu, '').slice(0, 5))), correlation])).rows[0]?.id;
  if (!stagingId) throw new Error('Staging sintético F41 não foi criado.');
  const accessKey = randomUUID().replace(/\D/gu, '').padEnd(44, '7').slice(0, 44);
  const parserVersion = `${PREFIXO}-parser-${suffix}`;
  const documentId = (await pool.query<{ id: string }>(`insert into app.fiscal_document(tenant_id,empresa_id,primary_staging_id,especie,chave_acesso,hash_sha256,
    original_key,tamanho_bytes,media_type,modelo,versao_layout,protocolo,protocolo_recebido_em,emitido_em,emitente,destinatario,total,estado,parser_version)
    values($1,$2,$3,'NFE_55',$4,$5,$6,100,'application/xml',$7,'4.00',$8,now(),'2026-02-15',$9,'99999999000199',1250,'PROCESSADO',$10) returning id`,
  [tenantId, companyId, stagingId, accessKey, hash(`${PREFIXO}-${suffix}`), `${tenantId}/${PREFIXO}-${suffix}.xml`, model,
    `${PREFIXO}-protocol-${suffix}`, model === '55' ? cnpj : '99999999000199', parserVersion])).rows[0]?.id;
  if (!documentId) throw new Error('Documento fiscal sintético F41 não foi persistido.');
  await pool.query(`insert into app.fiscal_document_party(tenant_id,empresa_id,document_id,parser_version,papel,identificador,nome)
    values($1,$2,$3,$4,'EMITENTE',$5,'Fornecedor sintético F41'),($1,$2,$3,$4,'DESTINATARIO',$6,'Empresa sintética F41')`,
  [tenantId, companyId, documentId, parserVersion, model === '55' ? cnpj : '99999999000199', model === '55' ? '99999999000199' : cnpj]);
  await pool.query(`insert into app.fiscal_acknowledgement(tenant_id,empresa_id,staging_id,chave_acesso,estado,protocolo,correlation_id)
    values($1,$2,$3,$4,'PARSEADO',$5,$6)`, [tenantId, companyId, stagingId, accessKey, `${PREFIXO}-ack-${suffix}`, correlation]);
  return documentId;
};

const criarRegra = async (name: string, model: string) => {
  const response = await page.request.post(`${BASE_URL}/${companyId}/automatizacao-contabil/regras`, { data: {
    name, source: 'DFE', validFrom: '2026-01-01', validUntil: null,
    criteria: [{ field: 'model', operator: 'EQ', value: model }],
    lines: [
      { side: 'DEBIT', accountId: debitAccountId, amountExpression: 'amountCents', position: 0, allocation: [] },
      { side: 'CREDIT', accountId: creditAccountId, amountExpression: 'amountCents', position: 1, allocation: [] },
    ],
  } });
  expect(response.status(), await response.text()).toBe(201);
  const draft = await response.json() as { ruleId: string; versionId: string; version: number; status: string };
  expect(draft.status).toBe('DRAFT');
  const published = await page.request.post(`${BASE_URL}/${companyId}/automatizacao-contabil/regras/${draft.ruleId}/versoes/${draft.versionId}/publicar`);
  expect(published.status(), await published.text()).toBe(201);
  expect((await published.json() as { status: string }).status).toBe('PUBLISHED');
  return draft;
};

test.describe.configure({ mode: 'serial' });
test.use({ trace: 'off', video: 'off', screenshot: 'off' });

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  test.setTimeout(240_000);
  await limparEscritorios(pool, [CNPJ_ESCRITORIO]);
  await removerIdentidadesComPrefixo(PREFIXO);
  tenantId = await criarEscritorio(pool, CNPJ_ESCRITORIO, 'Escritório sintético E2E F41');
  userId = await criarUsuario(pool, tenantId, await criarIdentidade(CONTADOR), CONTADOR, 'contador');
  companyId = await criarEmpresa(pool, tenantId, CNPJ_EMPRESA, 'Empresa sintética F41');
  await vincular(pool, tenantId, userId, companyId);
  const accounts = await pool.query<{ id: string; codigo: string }>(`insert into app.conta_contabil(tenant_id,empresa_id,codigo,nome,tipo,natureza,classe_contabil,politica_centro_custo)
    values($1,$2,$3,'Conta analítica de despesa F41','analitica','devedora','EXPENSE','OPTIONAL'),
      ($1,$2,$4,'Conta analítica de receita F41','analitica','credora','REVENUE','OPTIONAL') returning id,codigo`,
  [tenantId, companyId, `${PREFIXO}-despesa`, `${PREFIXO}-receita`]);
  debitAccountId = accounts.rows.find((account) => account.codigo.endsWith('-despesa'))?.id ?? '';
  creditAccountId = accounts.rows.find((account) => account.codigo.endsWith('-receita'))?.id ?? '';
  if (!debitAccountId || !creditAccountId) throw new Error('Contas analíticas sintéticas F41 não foram criadas.');
  matchingDocumentId = await createFiscalDocument('55', 'match');
  pendingDocumentId = await createFiscalDocument('65', 'pending');
  context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await context.newPage();
  await entrarComo(page, CONTADOR, `/empresas/${companyId}?aba=automatizacao-contabil`);
});

test.afterAll(async () => {
  await context?.close();
  await limparEscritorios(pool, [CNPJ_ESCRITORIO]);
  await removerIdentidadesComPrefixo(PREFIXO);
  await pool.end();
});

test('F41 publica regra, gera rascunho F40, abre pendência e reprocessa após nova regra', async () => {
  test.setTimeout(240_000);
  mkdirSync(CAMINHO, { recursive: true });
  await expect(page.getByRole('heading', { name: 'Empresa sintética F41' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Automatização contábil' })).toBeVisible();

  const firstRule = await criarRegra('Regra sintética F41 para modelo 55', '55');
  const generated = await page.request.post(`${BASE_URL}/${companyId}/automatizacao-contabil/geracoes`,
    { data: { sourceType: 'DFE', sourceId: matchingDocumentId } });
  expect(generated.status(), await generated.text()).toBe(201);
  const firstGeneration = await generated.json() as { result: string; draftEntryId: string };
  expect(firstGeneration.result).toBe('DRAFT_GENERATED');
  expect(firstGeneration.draftEntryId).toBeTruthy();
  const idempotent = await page.request.post(`${BASE_URL}/${companyId}/automatizacao-contabil/geracoes`,
    { data: { sourceType: 'DFE', sourceId: matchingDocumentId } });
  expect(idempotent.status(), await idempotent.text()).toBe(201);
  const duplicate = await idempotent.json() as { result: string; draftEntryId: string };
  expect(duplicate.result).toBe('ALREADY_GENERATED');
  expect(duplicate.draftEntryId).toBe(firstGeneration.draftEntryId);

  const noMatch = await page.request.post(`${BASE_URL}/${companyId}/automatizacao-contabil/geracoes`,
    { data: { sourceType: 'DFE', sourceId: pendingDocumentId } });
  expect(noMatch.status(), await noMatch.text()).toBe(201);
  const pendingGeneration = await noMatch.json() as { result: string; pendingId: string };
  expect(pendingGeneration.result).toBe('NO_MATCH');
  expect(pendingGeneration.pendingId).toBeTruthy();

  await criarRegra('Regra sintética F41 para modelo 65', '65');
  const reprocessed = await page.request.post(`${BASE_URL}/${companyId}/automatizacao-contabil/pendencias/${pendingGeneration.pendingId}/reprocessar`);
  expect(reprocessed.status(), await reprocessed.text()).toBe(201);
  const reprocessedResult = await reprocessed.json() as { result: string; draftEntryId: string };
  expect(reprocessedResult.result).toBe('DRAFT_GENERATED');

  const entries = await pool.query<{ id: string; estado: string; debit: string; credit: string }>(`select e.id,e.estado,
    coalesce(sum(p.valor_centavos) filter(where p.lado='DEBIT'),0)::text debit,
    coalesce(sum(p.valor_centavos) filter(where p.lado='CREDIT'),0)::text credit
    from app.lancamento_contabil e join app.lancamento_contabil_partida p on p.lancamento_id=e.id and p.ativa
    where e.empresa_id=$1 and e.id in($2,$3) group by e.id`, [companyId, firstGeneration.draftEntryId, reprocessedResult.draftEntryId]);
  expect(entries.rows).toHaveLength(2);
  expect(entries.rows.every((entry) => entry.estado === 'DRAFT' && entry.debit === '1250' && entry.credit === '1250')).toBe(true);

  const pendingList = await page.request.get(`${BASE_URL}/${companyId}/automatizacao-contabil/pendencias`);
  expect(pendingList.ok(), await pendingList.text()).toBeTruthy();
  const pendingItems = (await pendingList.json() as { items: { pendingId: string; status: string }[] }).items;
  expect(pendingItems.find((item) => item.pendingId === pendingGeneration.pendingId)?.status).toBe('RESOLVED');

  await page.getByRole('tab', { name: 'Lançamentos contábeis' }).click();
  await expect(page.getByRole('heading', { name: 'Lançamentos' })).toBeVisible();
  const draftRow = page.getByRole('button', { name: new RegExp(`Geração automática F41.*${matchingDocumentId}`, 'u') });
  await expect(draftRow).toBeVisible();
  await expect(draftRow).toContainText('D R$ 12,50 · C R$ 12,50');
  await draftRow.click();
  await expect(page.getByLabel('Histórico')).toHaveValue(new RegExp(`Geração automática F41.*${matchingDocumentId}`, 'u'));
  await expect(page.getByRole('heading', { name: 'Detalhe do lançamento' })).toBeVisible();

  await page.getByRole('tab', { name: 'Regras contábeis' }).click();
  await expect(page.getByRole('heading', { name: 'Automatização contábil' })).toBeVisible();
  await page.getByRole('tab', { name: 'Gerações' }).click();
  await expect(page.getByText('Documento fiscal DF-e').first()).toBeVisible();
  achados = await provarVisualmente(page, CAMINHO, 'f41-geracoes', {
    pronto: (target) => target.getByRole('heading', { name: 'Gerações registradas' }),
    recarregar: false, recorte: (target) => target.getByRole('tabpanel', { name: 'Gerações' }), semToasts: true,
  });
  await expect(page.getByText('Regras sintéticas F41 para modelo 55')).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(firstRule.version).toBe(1);
});

test('F41 mantém responsividade e acessibilidade crítica em CLARO/ESCURO × 768/1024/1440', async () => {
  expect(achados).not.toBeNull();
  expect(achados?.rolagens).toEqual([]);
  const evidence = achados!;
  for (const [theme, violations] of Object.entries(evidence.violacoes))
    expect(violations.filter((item) => item.impacto === 'critical'), `${theme}: axe`).toEqual([]);
});
