import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

import { canonicalizarJson } from '../../packages/shared/src/canonical-json';
import { FIXTURES } from '../../packages/db/src/testes/fixtures-rls';
import { cnpjValido, criarEmpresa, criarEscritorio, criarIdentidade, criarUsuario, entrarComo, limparEscritorios,
  removerIdentidadesComPrefixo, vincular, type Pessoa } from './fixtures/ambiente';
import { provarVisualmente, type AchadosVisuais } from './fixtures/plano-contas';

const PREFIXO = `e2e-f36-${randomUUID()}`;
const CONTADOR: Pessoa = { usuario: PREFIXO, senha: `${PREFIXO}-senha-123456`, nome: 'Contador F36' };
const AUXILIAR: Pessoa = { usuario: `${PREFIXO}-aux`, senha: `${PREFIXO}-aux-123456`, nome: 'Auxiliar F36' };
const CNPJ_ESCRITORIO = cnpjValido('299293490004');
const CNPJ_SIMPLES = cnpjValido('299293490005');
const CNPJ_PRESUMIDO = cnpjValido('299293490006');
const CAMINHO = resolve('test-results', process.env['PROVA_ESCOPO'] ?? 'SPEC-036', 'e2e/provas/spec-036');
const pool = new Pool({ connectionString: process.env['DATABASE_URL'] ?? 'postgresql://contaia:contaia_local@127.0.0.1:15432/contaia' });
const BASE_URL = '/api/proxy/companies';
const fonteSintetica = Buffer.from('Fixture E2E sintética F36. Não é fonte normativa nem produz efeito fiscal.', 'utf8');
const hashFonteSintetica = createHash('sha256').update(fonteSintetica).digest('hex');
const dataCompetencia = '2026-09';
const correlation = `${PREFIXO}-f36`;

test.describe.configure({ mode: 'serial' });
test.use({ trace: 'off', video: 'off', screenshot: 'off' });

let context: BrowserContext;
let auxiliarContext: BrowserContext;
let page: Page;
let tenantId = '';
let userId = '';
let auxiliarId = '';
let simpleCompanyId = '';
let presumedCompanyId = '';
let simplePackageId = '';
let icmsPackageId = '';
let simpleDocumentId = '';
let simpleStagingId = '';
let simpleDocumentHash = '';
let achados: AchadosVisuais | null = null;

const intervalos = Array.from({ length: 6 }, (_, index) => ({ id: `faixa-${index + 1}`, minimumRbt12Cents: index * 100_000_000,
  maximumRbt12Cents: index === 5 ? null : (index + 1) * 100_000_000 - 1, nominalRateBasisPoints: 100,
  deductionCents: 0, distributionBasisPoints: { TRIBUTO_SINTETICO: 10_000 } }));

const pacoteSimples = { kind: 'SIMPLES_NACIONAL_DAS', version: `${PREFIXO}-simples`, validFrom: '2026-09-01', validThrough: null,
  consultedAt: '2026-10-25', officialBasis: 'Fixture sintética F36, sem validade tributária.', sourceUrl: 'https://example.invalid/f36/simples',
  brackets: intervalos, segregations: [{ code: 'ANEXO_I_COMERCIO', taxParticipationBasisPoints: { TRIBUTO_SINTETICO: 10_000 } }], rounding: 'HALF_UP' };
const pacoteIcms = { kind: 'LUCRO_PRESUMIDO_ICMS_DARE', version: `${PREFIXO}-icms`, validFrom: '2026-09-01', validThrough: null,
  consultedAt: '2026-10-25', officialBasis: 'Fixture sintética F36, sem validade tributária.', sourceUrl: 'https://example.invalid/f36/icms',
  operations: [{ id: 'CFOP-5102-CST-00', cfops: ['5102'], cstCsosn: ['00'], effect: 'DEBIT', amountSource: 'DECLARED_ICMS', rateBasisPoints: null }],
  rounding: 'HALF_UP', allowedAdjustments: [] };

const criarDocumento = async (companyId: string, cnpj: string, date: string, cents: number, suffix: string, icmsCents?: number) => {
  const cnpjSemMascara = cnpj.replace(/\D/gu, '');
  const stateId = (await pool.query<{ id: string }>(`insert into app.dfe_capture_state(tenant_id,empresa_id,cnpj) values($1,$2,$3)
    on conflict (tenant_id,empresa_id,cnpj) do update set atualizado_em=app.dfe_capture_state.atualizado_em returning id`,
  [tenantId, companyId, cnpjSemMascara])).rows[0]?.id;
  if (!stateId) throw new Error('Estado sintético de captura F36 não foi criado.');
  const runId = (await pool.query<{ id: string }>(`insert into app.dfe_capture_run(tenant_id,empresa_id,estado_id,cnpj,origem,usuario_originador_id,
    chave_idempotente,correlation_id,ult_nsu_entrada,estado,finalizado_em) values($1,$2,$3,$4,'MANUAL',$5,$6,$6,'0','SUCCEEDED',now()) returning id`,
  [tenantId, companyId, stateId, cnpjSemMascara, userId, `${PREFIXO}-${suffix}`])).rows[0]?.id;
  if (!runId) throw new Error('Execução sintética de captura F36 não foi criada.');
  const stagingId = (await pool.query<{ id: string }>(`insert into app.dfe_capture_staging(tenant_id,empresa_id,run_id,cnpj,nsu,especie,conteudo_bruto,
    capturado_em,correlation_id) values($1,$2,$3,$4,$5,'NFE_55',decode('3c78','hex'),now(),$6) returning id`,
  [tenantId, companyId, runId, cnpjSemMascara, String(1 + Number(suffix.replace(/\D/gu, ''))), `${PREFIXO}-${suffix}`])).rows[0]?.id;
  if (!stagingId) throw new Error('Staging sintético F36 não foi criado.');
  const documentHash = createHash('sha256').update(`${PREFIXO}-${suffix}`).digest('hex');
  const key = `${String(Number(suffix.replace(/\D/gu, '')) + 1).padStart(2, '0')}${'7'.repeat(42)}`;
  const inserted = await pool.query<{ id: string }>(`insert into app.fiscal_document(tenant_id,empresa_id,primary_staging_id,especie,chave_acesso,hash_sha256,
    original_key,tamanho_bytes,media_type,modelo,versao_layout,protocolo,protocolo_recebido_em,emitido_em,emitente,destinatario,total,estado,parser_version)
    values($1,$2,$3,'NFE_55',$4,$5,$6,100,'application/xml','55','4.00',$7,now(),$8,$9,'99999999000199',$10/10000.0,'PROCESSADO',$11) returning id`,
  [tenantId, companyId, stagingId, key, documentHash, `${tenantId}/${suffix}.xml`, `PROTO-${suffix}`, `${date}-15`, cnpj, cents, `${PREFIXO}-${suffix}`]);
  const documentId = inserted.rows[0]?.id;
  if (!documentId) throw new Error('Documento sintético F36 não foi criado.');
  await pool.query(`insert into app.fiscal_document_party(tenant_id,empresa_id,document_id,parser_version,papel,identificador,nome)
    values($1,$2,$3,$4,'EMITENTE',$5,'Empresa sintética F36')`, [tenantId, companyId, documentId, `${PREFIXO}-${suffix}`, cnpj]);
  await pool.query(`insert into app.fiscal_document_item(tenant_id,empresa_id,document_id,parser_version,numero,tipo,codigo,descricao,ncm,cest,cfop,cst_csosn,
    unidade,quantidade,valor) values($1,$2,$3,$4,1,'ITEM',$5,'Autopeça sintética','87082999','1234567','5102','00','UN','1',$6/10000.0)`,
  [tenantId, companyId, documentId, `${PREFIXO}-${suffix}`, `${PREFIXO}-${suffix}`, cents]);
  if (icmsCents !== undefined) await pool.query(`insert into app.fiscal_document_tax(tenant_id,empresa_id,document_id,parser_version,escopo,numero_item,codigo,
    base_calculo,aliquota,valor,situacao) values($1,$2,$3,$4,'ITEM',1,'ICMS',$5/10000.0,18,$6/10000.0,'00')`,
  [tenantId, companyId, documentId, `${PREFIXO}-${suffix}`, cents, icmsCents]);
  return { id: documentId, stagingId, hash: documentHash };
};

const importarPacote = async (companyId: string, pack: object) => {
  const response = await page.request.post(`${BASE_URL}/${companyId}/fiscal-documents/monthly-assessments/rule-packages`, { multipart: {
    package: JSON.stringify(pack), source: { name: 'fixture-f36.pdf', mimeType: 'application/pdf', buffer: fonteSintetica },
  } });
  expect(response.status(), await response.text()).toBe(201);
  return await response.json() as { id: string };
};

const aprovarPacote = async (companyId: string, packageId: string) => {
  const response = await page.request.post(`${BASE_URL}/${companyId}/fiscal-documents/monthly-assessments/rule-packages/${packageId}/review`,
    { data: { action: 'APPROVED', reason: 'Aprovação de fixture sintética sem efeito tributário.' } });
  expect(response.status(), await response.text()).toBe(201);
};

const declarar = async (companyId: string, data: object) => {
  const response = await page.request.post(`${BASE_URL}/${companyId}/fiscal-documents/monthly-assessments/declarations`, { multipart: {
    declaration: JSON.stringify({ competence: dataCompetencia, kind: companyId === simpleCompanyId ? 'SIMPLES_NACIONAL_DAS' : 'LUCRO_PRESUMIDO_ICMS_DARE',
      justification: 'Declaração sintética rastreável para teste E2E da F36.', declaration: data,
      evidence: [{ kind: 'DOCUMENTO_CONTABIL', description: 'Comprovante sintético sem valor fiscal.' }] }),
    evidence: { name: 'evidencia-f36.pdf', mimeType: 'application/pdf', buffer: Buffer.from('evidência sintética F36') },
  } });
  expect(response.status(), await response.text()).toBe(201);
  return await response.json() as { id: string; revision: number; hash: string };
};

const preparar = async (companyId: string, kind: 'SIMPLES_NACIONAL_DAS' | 'LUCRO_PRESUMIDO_ICMS_DARE', rulePackageId: string) => {
  const response = await page.request.post(`${BASE_URL}/${companyId}/fiscal-documents/monthly-assessments`, { data: { competence: dataCompetencia, kind, rulePackageId } });
  expect(response.status(), await response.text()).toBe(201);
  return await response.json() as { assessmentId: string; status: string; totalCents: number | null; canonicalJsonHash: string };
};

const aprovarApuracao = async (companyId: string, assessment: Awaited<ReturnType<typeof preparar>>) => {
  const response = await page.request.post(`${BASE_URL}/${companyId}/fiscal-documents/monthly-assessments/${assessment.assessmentId}/review`,
    { data: { action: 'APPROVED', reason: 'Conferência manual da memória sintética; rascunho local.', expectedHash: assessment.canonicalJsonHash } });
  expect(response.status(), await response.text()).toBe(201);
  return await response.json() as { assessmentId: string; status: string; totalCents: number | null; canonicalJsonHash: string };
};

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  test.setTimeout(240_000);
  await limparEscritorios(pool, [CNPJ_ESCRITORIO]);
  await removerIdentidadesComPrefixo(PREFIXO);
  tenantId = await criarEscritorio(pool, CNPJ_ESCRITORIO, 'Escritório sintético E2E F36');
  userId = await criarUsuario(pool, tenantId, await criarIdentidade(CONTADOR), CONTADOR, 'contador');
  auxiliarId = await criarUsuario(pool, tenantId, await criarIdentidade(AUXILIAR), AUXILIAR, 'auxiliar');
  simpleCompanyId = await criarEmpresa(pool, tenantId, CNPJ_SIMPLES, 'Autopeças sintéticas Simples F36');
  presumedCompanyId = await criarEmpresa(pool, tenantId, CNPJ_PRESUMIDO, 'Autopeças sintéticas Presumido F36');
  await vincular(pool, tenantId, userId, simpleCompanyId);
  await vincular(pool, tenantId, userId, presumedCompanyId);
  await vincular(pool, tenantId, auxiliarId, simpleCompanyId);
  await pool.query(`update app.empresa set inscricao_estadual_numero='109999999',cnae_principal='4530703' where id=any($1::uuid[])`, [[simpleCompanyId, presumedCompanyId]]);
  await pool.query(`update app.empresa set regime_tributario='LUCRO_PRESUMIDO',enquadramento_simples=null where id=$1`, [presumedCompanyId]);
  await criarDocumento(simpleCompanyId, CNPJ_SIMPLES, '2026-08', 50_000, 'doc-1');
  const current = await criarDocumento(simpleCompanyId, CNPJ_SIMPLES, dataCompetencia, 100_000, 'doc-2');
  simpleDocumentId = current.id; simpleStagingId = current.stagingId; simpleDocumentHash = current.hash;
  await criarDocumento(presumedCompanyId, CNPJ_PRESUMIDO, dataCompetencia, 100_000, 'doc-3', 18_000);
  context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await context.newPage();
  await entrarComo(page, CONTADOR, `/empresas/${simpleCompanyId}`);
});

test.afterAll(async () => {
  await context?.close();
  await auxiliarContext?.close();
  await limparEscritorios(pool, [CNPJ_ESCRITORIO]);
  await removerIdentidadesComPrefixo(PREFIXO);
  await pool.end();
});

test('F36 calcula e aprova as duas trilhas, exporta por hash, invalida após novos eventos e prova a tela', async () => {
  test.setTimeout(240_000);
  mkdirSync(CAMINHO, { recursive: true });

  const simplePackage = await importarPacote(simpleCompanyId, pacoteSimples);
  simplePackageId = simplePackage.id;
  await aprovarPacote(simpleCompanyId, simplePackageId);
  const icmsPackage = await importarPacote(presumedCompanyId, pacoteIcms);
  icmsPackageId = icmsPackage.id;
  await aprovarPacote(presumedCompanyId, icmsPackageId);

  const mesesRbt12 = Array.from({ length: 12 }, (_, index) => {
    const date = new Date(Date.UTC(2026, 8 - 12 + index, 1));
    const month = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
    return { month, cents: month === '2026-08' ? 500 : 0 };
  });
  await declarar(simpleCompanyId, { optionValid: true, revenueReconciled: true, activityVerified: true, historyComplete: true,
    rbt12ByMonth: mesesRbt12, revenue: [{ code: 'ANEXO_I_COMERCIO', cents: 1_000, sourceIds: [`${simpleDocumentId}:${simpleDocumentHash}`] }] });
  const simpleAssessment = await preparar(simpleCompanyId, 'SIMPLES_NACIONAL_DAS', simplePackageId);
  expect(simpleAssessment, JSON.stringify(simpleAssessment)).toMatchObject({ status: 'READY_FOR_REVIEW', totalCents: 10 });
  const approvedSimple = await aprovarApuracao(simpleCompanyId, simpleAssessment);
  expect(approvedSimple).toMatchObject({ status: 'APPROVED', totalCents: 10 });
  auxiliarContext = await page.context().browser()!.newContext({ viewport: { width: 1280, height: 800 } });
  const auxiliarPage = await auxiliarContext.newPage();
  await entrarComo(auxiliarPage, AUXILIAR, `/empresas/${simpleCompanyId}`);
  const deniedApproval = await auxiliarPage.request.post(`${BASE_URL}/${simpleCompanyId}/fiscal-documents/monthly-assessments/${approvedSimple.assessmentId}/review`,
    { data: { action: 'APPROVED', reason: 'Tentativa de aprovação pelo papel auxiliar.', expectedHash: approvedSimple.canonicalJsonHash } });
  expect(deniedApproval.status(), await deniedApproval.text()).toBe(403);
  const deniedAudit = await pool.query<{ count: string }>(`select count(*)::text count from app.tax_monthly_assessment_event where assessment_id=$1 and action='FAILED' and actor_id=$2`,
    [approvedSimple.assessmentId, auxiliarId]);
  expect(deniedAudit.rows[0]?.count).toBe('1');
  const deniedPackageReview = await auxiliarPage.request.post(`${BASE_URL}/${simpleCompanyId}/fiscal-documents/monthly-assessments/rule-packages/${simplePackageId}/review`,
    { data: { action: 'REJECTED', reason: 'Tentativa de revisão pelo papel auxiliar.' } });
  expect(deniedPackageReview.status(), await deniedPackageReview.text()).toBe(403);
  const deniedPackageAudit = await pool.query<{ count: string }>(`select count(*)::text count from app.tax_monthly_rule_package_event where package_id=$1 and action='FAILED' and actor_id=$2`,
    [simplePackageId, auxiliarId]);
  expect(deniedPackageAudit.rows[0]?.count).toBe('1');
  const reproduced = await preparar(simpleCompanyId, 'SIMPLES_NACIONAL_DAS', simplePackageId);
  expect(reproduced).toMatchObject({ assessmentId: approvedSimple.assessmentId, status: 'APPROVED', canonicalJsonHash: approvedSimple.canonicalJsonHash });

  const sourceHashCheck = await page.request.get(`${BASE_URL}/${simpleCompanyId}/fiscal-documents/monthly-assessments/rule-packages/${simplePackageId}/source`);
  expect(sourceHashCheck.ok()).toBeTruthy();
  expect(createHash('sha256').update(await sourceHashCheck.body()).digest('hex')).toBe(hashFonteSintetica);
  for (const format of ['PDF', 'CSV', 'JSON'] as const) {
    const exported = await page.request.get(`${BASE_URL}/${simpleCompanyId}/fiscal-documents/monthly-assessments/${approvedSimple.assessmentId}/export?format=${format}`);
    expect(exported.ok(), `${format}: ${exported.status()}`).toBeTruthy();
    const bytes = await exported.body();
    expect(exported.headers()['x-canonical-json-sha256']).toBe(approvedSimple.canonicalJsonHash);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(exported.headers()['x-content-sha256']);
    if (format === 'PDF') expect(bytes.subarray(0, 8).toString('ascii')).toBe('%PDF-1.4');
    if (format === 'CSV') expect(bytes.toString('utf8')).toContain('TRIBUTO_SINTETICO');
    if (format === 'JSON') {
      const payload = JSON.parse(bytes.toString('utf8')) as { assessment: Record<string, unknown>; canonicalJsonHash: string };
      expect(payload).toMatchObject({ assessment: { assessmentId: approvedSimple.assessmentId, status: 'APPROVED' }, canonicalJsonHash: approvedSimple.canonicalJsonHash });
      expect(createHash('sha256').update(canonicalizarJson(payload.assessment)).digest('hex')).toBe(payload.canonicalJsonHash);
    }
  }

  await declarar(presumedCompanyId, { adjustments: [], priorCreditCents: 0, priorCreditProven: true, priorCreditAssessmentId: null,
    allOperationsCovered: true, activityVerified: true, returnCancellationReconciled: true, excludedOperationsHandled: true });
  const icmsAssessment = await preparar(presumedCompanyId, 'LUCRO_PRESUMIDO_ICMS_DARE', icmsPackageId);
  expect(icmsAssessment).toMatchObject({ status: 'READY_FOR_REVIEW', totalCents: 18_000 });
  const approvedIcms = await aprovarApuracao(presumedCompanyId, icmsAssessment);
  expect(approvedIcms).toMatchObject({ status: 'APPROVED', totalCents: 18_000 });

  await pool.query(`insert into app.fiscal_document_event(tenant_id,empresa_id,document_id,staging_id,tipo,codigo,parser_version,hash_sha256,correlation_id)
    values($1,$2,$3,$4,'REPROCESSADO','F36_INPUT_CHANGED',$5,repeat('d',64),$6)`,
  [tenantId, simpleCompanyId, simpleDocumentId, simpleStagingId, 'f36-e2e-event', correlation]);
  const changed = await preparar(simpleCompanyId, 'SIMPLES_NACIONAL_DAS', simplePackageId);
  expect(changed.status).toBe('READY_FOR_REVIEW');
  const oldAssessment = await page.request.get(`${BASE_URL}/${simpleCompanyId}/fiscal-documents/monthly-assessments/${approvedSimple.assessmentId}`);
  expect((await oldAssessment.json() as { status: string }).status).toBe('POSSIBLY_OUTDATED');

  await page.goto(`/empresas/${simpleCompanyId}?aba=apuracao-fiscal`);
  await expect(page.getByRole('region', { name: 'Apuração fiscal mensal' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Apuração fiscal mensal' })).toBeVisible();
  const competence = page.getByRole('combobox', { name: 'Competência' });
  await competence.click();
  await page.getByRole('option', { name: /setembro de 2026/iu }).click();
  await expect(page.getByText('Possivelmente desatualizada')).toBeVisible();
  await expect(page.getByText(/o arquivo não pode ser pago/iu)).toBeVisible();
  achados = await provarVisualmente(page, CAMINHO, 'f36-apuracao-mensal', {
    pronto: (target) => target.getByRole('region', { name: 'Apuração fiscal mensal' }),
    recorte: (target) => target.getByRole('region', { name: 'Apuração fiscal mensal' }), semToasts: true,
  });
});

test('F36 mantém responsividade, acessibilidade crítica e os dois temas nas três larguras', () => {
  expect(achados).not.toBeNull();
  expect(achados?.rolagens).toEqual([]);
  for (const [theme, violations] of Object.entries(achados?.violacoes ?? {}))
    expect(violations.filter((item) => item.impacto === 'critical'), `${theme}: axe`).toEqual([]);
});
