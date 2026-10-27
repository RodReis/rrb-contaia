import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

import { canonicalizarJson } from '../../packages/shared/src/canonical-json';
import { cnpjValido, criarEmpresa, criarEscritorio, criarIdentidade, criarUsuario, entrarComo, limparEscritorios,
  removerIdentidadesComPrefixo, vincular, type Pessoa } from './fixtures/ambiente';
import { provarVisualmente, type AchadosVisuais } from './fixtures/plano-contas';

const PREFIXO = `e2e-f38-${randomUUID()}`;
const CONTADOR: Pessoa = { usuario: PREFIXO, senha: `${PREFIXO}-senha-123456`, nome: 'Contador F38' };
const CNPJ_ESCRITORIO = cnpjValido(randomUUID().replace(/\D/gu, '').slice(0, 12));
const CNPJ_EMPRESA = cnpjValido(randomUUID().replace(/\D/gu, '').slice(0, 12));
const CAMINHO = resolve('test-results', process.env['PROVA_ESCOPO'] ?? 'SPEC-038', 'e2e/provas/spec-038');
const pool = new Pool({ connectionString: process.env['DATABASE_URL'] ?? 'postgresql://contaia:contaia_local@127.0.0.1:15432/contaia' });
const BASE_URL = '/api/proxy/companies';
const sourcePdf = Buffer.from('%PDF-1.4\nF38 fixture sintética, sem valor normativo.\n%%EOF', 'ascii');
const sourceHash = createHash('sha256').update(sourcePdf).digest('hex');
const q1Dates = ['2026-04-30','2026-05-31','2026-06-30'];
const quarterDueDates: Record<string, readonly string[]> = {
  '2026-Q1': q1Dates, '2026-Q2': ['2026-07-31','2026-08-31','2026-09-30'],
  '2026-Q3': ['2026-10-31','2026-11-30','2026-12-31'], '2026-Q4': ['2027-01-31','2027-02-28','2027-03-31'],
};
const packageRules = {
  version: `${PREFIXO}-synthetic-rules`, validFrom: '2026-01-01', validThrough: '2026-12-31', consultedAt: '2026-10-27',
  officialBasis: 'Fixture estrutural sintética, sem valor ou validade tributária.', sourceUrl: 'https://www.gov.br/receitafederal/fixture-sem-validade',
  rules: [
    { id: 'F38-IRPJ-SALES', tax: 'IRPJ', activityCode: 'AUTO_PARTS_COMMERCE', revenueNatureCode: 'SALES', validFrom: '2026-01-01', validThrough: null,
      presumptionRateScaled: '0.08', taxRateScaled: '0.15', taxCode: 'IRPJ', sourceIds: ['fixture:irpj'] },
    { id: 'F38-CSLL-SALES', tax: 'CSLL', activityCode: 'AUTO_PARTS_COMMERCE', revenueNatureCode: 'SALES', validFrom: '2026-01-01', validThrough: null,
      presumptionRateScaled: '0.12', taxRateScaled: '0.09', taxCode: 'CSLL', sourceIds: ['fixture:csll'] },
  ], deductionRules: [], additionalIrpjRateScaled: '0.10', additionalIrpjThresholdCentsByMonth: 100_000,
  additionalIrpjRuleId: 'F38-IRPJ-ADDITIONAL', additionalIrpjSourceIds: ['fixture:irpj-additional'],
  installmentTerms: { minimumPrincipalCents: 1, maximumInstallments: 3, additionRateScaled: '0', dueDates:
    Object.entries(quarterDueDates).flatMap(([quarter, dates]) => (['IRPJ','CSLL'] as const).flatMap((tax) => dates.map((dueDate, index) => ({
      quarter, tax, installmentNumber: index + 1, dueDate, additionRateScaled: '0', sourceIds: [`fixture:due:${quarter}:${tax}:${index + 1}`],
    })))) }, rounding: 'HALF_UP' as const,
};
const correlation = `${PREFIXO}-f38`;
const upload = { name: 'f38-fixture.pdf', mimeType: 'application/pdf', buffer: sourcePdf };

let context: BrowserContext;
let page: Page;
let tenantId = '';
let userId = '';
let companyId = '';
let documentId = '';
let documentHash = '';
let assessmentId = '';
let approvedHash = '';
let achados: AchadosVisuais | null = null;

const createFiscalDocument = async () => {
  const cnpj = CNPJ_EMPRESA.replace(/\D/gu, '');
  const stateId = (await pool.query<{ id: string }>(`insert into app.dfe_capture_state(tenant_id,empresa_id,cnpj)
    values($1,$2,$3) returning id`, [tenantId, companyId, cnpj])).rows[0]?.id;
  if (!stateId) throw new Error('Estado de captura sintético F38 não foi criado.');
  const runId = (await pool.query<{ id: string }>(`insert into app.dfe_capture_run(tenant_id,empresa_id,estado_id,cnpj,origem,usuario_originador_id,
    chave_idempotente,correlation_id,ult_nsu_entrada,estado,finalizado_em)
    values($1,$2,$3,$4,'MANUAL',$5,$6,$6,'0','SUCCEEDED',now()) returning id`,
  [tenantId, companyId, stateId, cnpj, userId, `${PREFIXO}-capture`])).rows[0]?.id;
  if (!runId) throw new Error('Captura sintética F38 não foi criada.');
  const stagingId = (await pool.query<{ id: string }>(`insert into app.dfe_capture_staging(tenant_id,empresa_id,run_id,cnpj,nsu,especie,conteudo_bruto,
    capturado_em,correlation_id) values($1,$2,$3,$4,$5,'NFE_55',decode('3c78','hex'),now(),$6) returning id`,
  [tenantId, companyId, runId, cnpj, String(100 + Number(randomUUID().replace(/\D/gu, '').slice(0, 5))), correlation])).rows[0]?.id;
  if (!stagingId) throw new Error('Staging sintético F38 não foi criado.');
  documentHash = createHash('sha256').update(`${PREFIXO}-invoice`).digest('hex');
  const accessKey = `${randomUUID().replace(/\D/gu, '').padEnd(44, '7').slice(0, 44)}`;
  const parserVersion = `${PREFIXO}-parser`;
  documentId = (await pool.query<{ id: string }>(`insert into app.fiscal_document(tenant_id,empresa_id,primary_staging_id,especie,chave_acesso,hash_sha256,
    original_key,tamanho_bytes,media_type,modelo,versao_layout,protocolo,protocolo_recebido_em,emitido_em,emitente,destinatario,total,estado,parser_version)
    values($1,$2,$3,'NFE_55',$4,$5,$6,100,'application/xml','55','4.00',$7,now(),'2026-02-15',$8,'99999999000199',100000,'PROCESSADO',$9) returning id`,
  [tenantId, companyId, stagingId, accessKey, documentHash, `${tenantId}/${PREFIXO}.xml`, `${PREFIXO}-protocol`, cnpj, parserVersion])).rows[0]?.id ?? '';
  if (!documentId) throw new Error('Documento fiscal sintético F38 não foi persistido.');
  await pool.query(`insert into app.fiscal_document_party(tenant_id,empresa_id,document_id,parser_version,papel,identificador,nome)
    values($1,$2,$3,$4,'EMITENTE',$5,'Autopeças sintéticas F38')`, [tenantId, companyId, documentId, parserVersion, cnpj]);
  await pool.query(`insert into app.fiscal_document_item(tenant_id,empresa_id,document_id,parser_version,numero,tipo,codigo,descricao,ncm,cest,cfop,cst_csosn,
    unidade,quantidade,valor) values($1,$2,$3,$4,1,'ITEM','F38-ITEM','Autopeça sintética','87082999','1234567','5102','00','UN','1',100000)`,
  [tenantId, companyId, documentId, parserVersion]);
  await pool.query(`insert into app.fiscal_document_tax(tenant_id,empresa_id,document_id,parser_version,escopo,numero_item,codigo,base_calculo,aliquota,valor,situacao)
    values($1,$2,$3,$4,'ITEM',1,'ICMS',1000,18,180,'00')`, [tenantId, companyId, documentId, parserVersion]);
};

const postEvidenceDeclaration = async (evidence: readonly { kind: string; description: string; sourceReference: string; recognizedOn: string | null; amountCents: number | null }[],
  supersedesId: string | null = null) => {
  const declaration = {
    quarter: '2026-Q1', recognition: 'ACCRUAL', recognitionOptionValid: true, regimeVerified: true, activityVerified: true,
    revenueReconciled: true, revenue: [{ id: 'sales-1', activityCode: 'AUTO_PARTS_COMMERCE', revenueNatureCode: 'SALES', month: '2026-02',
      grossCents: 10_000_000, adjustmentCents: 0, directAdditionCents: 0, lineType: 'FISCAL_ITEM', adjustmentReason: null,
      ruleIds: ['F38-IRPJ-SALES','F38-CSLL-SALES'], sourceIds: [`${documentId}:${documentHash}:item:1`] }], deductions: [],
    evidence, justification: 'Conciliação sintética verificável para o E2E da F38.', supersedesId,
  };
  const form = new FormData();
  form.set('declaration', JSON.stringify(declaration));
  for (let index = 0; index < evidence.length; index += 1)
    form.append('evidence', new Blob([sourcePdf], { type: 'application/pdf' }), `f38-evidence-${index + 1}.pdf`);
  const response = await page.request.post(`${BASE_URL}/${companyId}/fiscal-documents/corporate-tax-assessments/declarations`, { multipart: form });
  expect(response.status(), await response.text()).toBe(201);
  return await response.json() as { id: string; revision: number; evidence: readonly { id: string }[] };
};

test.describe.configure({ mode: 'serial' });
test.use({ trace: 'off', video: 'off', screenshot: 'off' });

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  test.setTimeout(240_000);
  await limparEscritorios(pool, [CNPJ_ESCRITORIO]);
  await removerIdentidadesComPrefixo(PREFIXO);
  tenantId = await criarEscritorio(pool, CNPJ_ESCRITORIO, 'Escritório sintético E2E F38');
  userId = await criarUsuario(pool, tenantId, await criarIdentidade(CONTADOR), CONTADOR, 'contador');
  companyId = await criarEmpresa(pool, tenantId, CNPJ_EMPRESA, 'Autopeças sintéticas Lucro Presumido F38');
  await vincular(pool, tenantId, userId, companyId);
  await pool.query(`update app.empresa set regime_tributario='LUCRO_PRESUMIDO',enquadramento_simples=null,cnae_principal='4530703' where id=$1`, [companyId]);
  await createFiscalDocument();
  context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await context.newPage();
  await entrarComo(page, CONTADOR, `/empresas/${companyId}`);
});

test.afterAll(async () => {
  await context?.close();
  await limparEscritorios(pool, [CNPJ_ESCRITORIO]);
  await removerIdentidadesComPrefixo(PREFIXO);
  await pool.end();
}, 120_000);

test('F38 reconcilia, aprova, exporta e invalida a revisão trimestral', async () => {
  test.setTimeout(240_000);
  mkdirSync(CAMINHO, { recursive: true });

  const packageResponse = await page.request.post(`${BASE_URL}/${companyId}/fiscal-documents/corporate-tax-assessments/rule-packages`, {
    multipart: { package: JSON.stringify(packageRules), source: upload },
  });
  expect(packageResponse.status(), await packageResponse.text()).toBe(201);
  const rulePackage = await packageResponse.json() as { id: string };
  const reviewPackage = await page.request.post(`${BASE_URL}/${companyId}/fiscal-documents/corporate-tax-assessments/rule-packages/${rulePackage.id}/review`,
    { data: { action: 'APPROVED', reason: 'Revisão de fixture sintética, sem conteúdo normativo ou efeito tributário.' } });
  expect(reviewPackage.status(), await reviewPackage.text()).toBe(201);

  const evidence = [
    { kind: 'OPCAO_ANUAL_RECONHECIMENTO', description: 'Opção sintética por competência.', sourceReference: 'fixture:recognition', recognizedOn: null, amountCents: null },
    { kind: 'ENQUADRAMENTO_LUCRO_PRESUMIDO', description: 'Enquadramento sintético.', sourceReference: 'fixture:regime', recognizedOn: null, amountCents: null },
    { kind: 'ATIVIDADE_COMERCIO_AUTOPECAS', description: 'Atividade sintética.', sourceReference: 'fixture:activity', recognizedOn: null, amountCents: null },
    { kind: 'RECONCILIACAO_RECEITAS', description: 'Conciliação sintética do trimestre.', sourceReference: 'fixture:reconciliation', recognizedOn: null, amountCents: null },
    { kind: 'EVENTOS_CANCELAMENTOS_DEVOLUCOES_RECONCILIADOS', description: 'Corte sintético sem eventos pós-venda pendentes.', sourceReference: 'fixture:events', recognizedOn: null, amountCents: null },
  ];
  const declaration = await postEvidenceDeclaration(evidence);
  const prepareResponse = await page.request.post(`${BASE_URL}/${companyId}/fiscal-documents/corporate-tax-assessments`, { data: {
    quarter: '2026-Q1', recognition: 'ACCRUAL', packageId: rulePackage.id, revenueDeclarationId: declaration.id,
    deductionEvidenceIds: [], installmentCount: 3, idempotencyKey: randomUUID(),
  } });
  expect(prepareResponse.status(), await prepareResponse.text()).toBe(201);
  const prepared = await prepareResponse.json() as { assessmentId: string; status: string; canonicalJsonHash: string;
    irpjPayableCents: number | null; csllPayableCents: number | null; installments: readonly { tax: string; installmentNumber: number }[]; draftArtifactIds: readonly string[] };
  assessmentId = prepared.assessmentId;
  expect(prepared.status).toBe('READY_FOR_REVIEW');
  expect(prepared.irpjPayableCents).toBe(170_000);
  expect(prepared.csllPayableCents).toBe(108_000);
  expect(prepared.installments).toHaveLength(6);
  expect(new Set(prepared.draftArtifactIds).size).toBe(2);

  const beforeApproval = await page.request.get(`${BASE_URL}/${companyId}/fiscal-documents/corporate-tax-assessments/${assessmentId}`);
  expect(beforeApproval.ok()).toBeTruthy();
  const view = await beforeApproval.json() as { preparationJsonHash: string; draftArtifactIds: string[] };
  const savedDraft = await page.request.get(`${BASE_URL}/${companyId}/fiscal-documents/corporate-tax-assessments/${assessmentId}/artifacts/${view.draftArtifactIds[0]}`);
  expect(savedDraft.ok(), await savedDraft.text()).toBeTruthy();
  expect(savedDraft.headers()['x-canonical-json-sha256']).toBe(view.preparationJsonHash);
  expect((await savedDraft.body()).toString('latin1')).toContain('NAO OFICIAL');

  const approve = await page.request.post(`${BASE_URL}/${companyId}/fiscal-documents/corporate-tax-assessments/${assessmentId}/review`, { data: {
    action: 'APPROVED', justification: 'Conferência humana das fontes e da memória sintética.', declarationsConfirmed: true,
    localDraftsAcknowledged: true, installmentCount: 3, expectedHash: prepared.canonicalJsonHash,
  } });
  expect(approve.status(), await approve.text()).toBe(201);
  const approvedResponse = await page.request.get(`${BASE_URL}/${companyId}/fiscal-documents/corporate-tax-assessments/${assessmentId}`);
  const approved = await approvedResponse.json() as { status: string; canonicalJsonHash: string };
  expect(approved.status).toBe('APPROVED');
  approvedHash = approved.canonicalJsonHash;
  for (const format of ['PDF','CSV','JSON'] as const) {
    const exported = await page.request.get(`${BASE_URL}/${companyId}/fiscal-documents/corporate-tax-assessments/${assessmentId}/export?format=${format}`);
    expect(exported.ok(), `${format}: ${exported.status()} ${await exported.text()}`).toBeTruthy();
    const bytes = await exported.body();
    expect(exported.headers()['x-canonical-json-sha256']).toBe(approvedHash);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(exported.headers()['x-content-sha256']);
    if (format === 'JSON') expect(createHash('sha256').update(canonicalizarJson(JSON.parse(bytes.toString('utf8')))).digest('hex')).toBe(approvedHash);
  }

  await postEvidenceDeclaration(evidence.map((item) => ({ ...item, sourceReference: `${item.sourceReference}:superseding` })), declaration.id);
  const outdatedResponse = await page.request.get(`${BASE_URL}/${companyId}/fiscal-documents/corporate-tax-assessments/${assessmentId}`);
  expect((await outdatedResponse.json() as { status: string }).status).toBe('POSSIBLY_OUTDATED');
  const source = await page.request.get(`${BASE_URL}/${companyId}/fiscal-documents/corporate-tax-assessments/rule-packages/${rulePackage.id}/source`);
  expect(createHash('sha256').update(await source.body()).digest('hex')).toBe(sourceHash);

  await page.goto(`/empresas/${companyId}?aba=apuracao-fiscal`);
  await expect(page.getByRole('region', { name: 'Apuração trimestral de IRPJ e CSLL' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'IRPJ e CSLL · Lucro Presumido' })).toBeVisible();
  await page.getByRole('button', { name: 'Abrir' }).first().click();
  await expect(page.getByText('Possivelmente desatualizada')).toBeVisible();
  achados = await provarVisualmente(page, CAMINHO, 'f38-apuracao-trimestral', {
    pronto: (target) => target.getByRole('region', { name: 'Apuração trimestral de IRPJ e CSLL' }),
    recorte: (target) => target.getByRole('region', { name: 'Apuração trimestral de IRPJ e CSLL' }), semToasts: true,
  });
});

test('F38 mantém responsividade e acessibilidade crítica em CLARO/ESCURO × 768/1024/1440', () => {
  expect(achados).not.toBeNull();
  expect(achados?.rolagens).toEqual([]);
  for (const [theme, violations] of Object.entries(achados?.violacoes ?? {}))
    expect(violations.filter((item) => item.impacto === 'critical'), `${theme}: axe`).toEqual([]);
});
