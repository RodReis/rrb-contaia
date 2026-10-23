import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { cnpjValido, criarEmpresa, criarEscritorio, criarIdentidade, criarUsuario, entrarComo, limparEscritorios, removerIdentidadesComPrefixo, vincular, type Pessoa } from './fixtures/ambiente';
import { provarVisualmente, type AchadosVisuais } from './fixtures/plano-contas';
import { FIXTURES } from '../../packages/db/src/testes/fixtures-rls';

const PREFIXO=`e2e-f32-${randomUUID()}`;
const ADMIN:Pessoa={usuario:PREFIXO,senha:`${PREFIXO}-senha-123456`,nome:'Contador F32'};
const CNPJ_ESCRITORIO=cnpjValido('299293390001');
const CNPJ_EMPRESA=cnpjValido('299293390002');
const CAMINHO=resolve('test-results/SPEC-032/e2e/provas');
const pool=new Pool({connectionString:process.env['DATABASE_URL']??'postgresql://contaia:contaia_local@127.0.0.1:15432/contaia'});
const CHAVE_ORIGINAL='1'.repeat(44);
const CHAVE_DEVOLUCAO='2'.repeat(44);

test.describe.configure({mode:'serial'});
test.use({trace:'off',video:'off',screenshot:'off'});
let context:BrowserContext;
let page:Page;
let tenantId='';
let userId='';
let companyId='';
let snapshotId='';
let lineId='';
let achados:AchadosVisuais|null=null;

test.beforeAll(async({browser}:{browser:Browser})=>{
  test.setTimeout(240_000);
  await limparEscritorios(pool,[CNPJ_ESCRITORIO]);
  await removerIdentidadesComPrefixo(PREFIXO);
  tenantId=await criarEscritorio(pool,CNPJ_ESCRITORIO,'Escritório sintético E2E F32');
  userId=await criarUsuario(pool,tenantId,await criarIdentidade(ADMIN),ADMIN,'contador');
  companyId=await criarEmpresa(pool,tenantId,CNPJ_EMPRESA,'Autopeças sintéticas E2E F32');
  await vincular(pool,tenantId,userId,companyId);
  const fiscalFixture=FIXTURES['app.fiscal_document'];
  if(!fiscalFixture?.preparar)throw new Error('fixture fiscal F32 indisponível');
  const scope={tenantId,empresaId:companyId,autorId:userId,sufixo:PREFIXO};
  const staging=await fiscalFixture.preparar(pool,scope);
  const documentId=randomUUID();
  await pool.query(`insert into app.fiscal_document(id,tenant_id,empresa_id,primary_staging_id,especie,chave_acesso,hash_sha256,original_key,tamanho_bytes,modelo,versao_layout,
    numero_documento,serie_documento,emitido_em,estado,parser_version)
    values($1,$2,$3,$4,'NFE_55',$5,repeat('a',64),$6,100,'55','4.00','123','1','2017-01-15','PROCESSADO','f32-e2e')`,
    [documentId,tenantId,companyId,staging['stagingId'],CHAVE_ORIGINAL,`${tenantId}/f32-e2e-original.xml`]);
  await pool.query(`insert into app.fiscal_document_origin(tenant_id,empresa_id,document_id,staging_id,cnpj,nsu,correlation_id,capturado_em)
    values($1,$2,$3,$4,$5,'1',$6,now())`,[tenantId,companyId,documentId,staging['stagingId'],staging['cnpj'],`${PREFIXO}-origin`]);
  await pool.query(`insert into app.fiscal_document_party(tenant_id,empresa_id,document_id,parser_version,papel,identificador,nome,uf)
    values($1,$2,$3,'fixture','EMITENTE',$4,'Autopeças sintéticas','GO')`,[tenantId,companyId,documentId,CNPJ_EMPRESA]);
  await pool.query(`insert into app.fiscal_document_item(tenant_id,empresa_id,document_id,parser_version,numero,tipo,codigo,descricao,ncm,cest,cfop,unidade,quantidade,valor)
    values($1,$2,$3,'fixture',1,'ITEM','SKU-F32','Autopeça sintética','87082999','1234567','5102','UN','3','30')`,[tenantId,companyId,documentId]);
  const snapshot=await pool.query<{id:string}>(`insert into app.tax_st_settlement_snapshot(tenant_id,empresa_id,competence,regime,revision,idempotency_key,input_sha256,status,
    gross_restitution_cents,gross_complement_cents,net_amount_cents,line_count,blocked_line_count,facts,actor_id,correlation_id,processed_at)
    values($1,$2,'2017-01-01','SIMPLES_NACIONAL',1,$3,repeat('b',64),'PENDING_REVIEW',1000,0,1000,1,0,'{}'::jsonb,$4,$3,now()) returning id`,
    [tenantId,companyId,`${PREFIXO}-snapshot`,userId]);
  snapshotId=snapshot.rows[0]?.id??'';
  if(!snapshotId)throw new Error('snapshot sintético F32 não criado');
  const line=await pool.query<{id:string}>(`insert into app.tax_st_settlement_line(tenant_id,empresa_id,snapshot_id,output_document_id,output_item_id,difference_kind,restitution_cents,
    complement_cents,facts,calculation,recovery_memory,source_ids)
    values($1,$2,$3,$4,'1','RESTITUTION',1000,0,$5::jsonb,$6::jsonb,'{}'::jsonb,array['fixture-original']) returning id`,
    [tenantId,companyId,snapshotId,documentId,JSON.stringify({unit:'UN',factDate:'2017-01-15',quantityScaled:'30000000000',quantityScale:10,productCode:'SKU-F32',ncm:'87082999',cest:'1234567',accessKey:CHAVE_ORIGINAL,documentModel:'55'}),JSON.stringify({formulaVersion:'F29-FIXTURE',recoveryOrigin:'PACKAGE',restitutionCents:1000})]);
  lineId=line.rows[0]?.id??'';
  if(!lineId)throw new Error('linha sintética F32 não criada');
  await pool.query(`insert into app.tax_st_settlement_review_event(tenant_id,empresa_id,snapshot_id,action,actor_id,occurred_at,correlation_id)
    values($1,$2,$3,'SUBMITTED',$4,now()-interval '1 second',$5),($1,$2,$3,'APPROVED',$4,now(),$5)`,[tenantId,companyId,snapshotId,userId,`${PREFIXO}-review`]);
  context=await browser.newContext({viewport:{width:1440,height:900}});
  page=await context.newPage();
  await entrarComo(page,ADMIN,`/empresas/${companyId}`);
  await page.goto(`/empresas/${companyId}?aba=captura-dfe`);
  await expect(page.getByRole('tab',{name:'Captura DF-e'})).toHaveAttribute('data-state','active');
  await page.reload();
  await expect(page.getByRole('tab',{name:'Captura DF-e'})).toHaveAttribute('data-state','active');
});

test.afterAll(async()=>{
  await context?.close();
  await limparEscritorios(pool,[CNPJ_ESCRITORIO]);
  await removerIdentidadesComPrefixo(PREFIXO);
  await pool.end();
});

test('F32 registra devolução, exige decisão humana e compõe revisão C002; prova temas e larguras',async()=>{
  test.setTimeout(180_000);
  mkdirSync(CAMINHO,{recursive:true});
  await expect(page.getByRole('heading',{name:'Complemento ou restituição de ICMS-ST'})).toBeVisible({timeout:30_000});
  await page.getByRole('region',{name:'Complemento ou restituição de ICMS-ST'}).getByRole('button',{name:'Abrir'}).click();
  await expect(page.getByRole('heading',{name:'Resultado · revisão 1'})).toBeVisible();
  await expect(page.getByText('Aprovada',{exact:true})).toBeVisible();
  await expect(page.getByText('Restituição',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Registrar devolução'})).toBeVisible();
  await page.getByRole('button',{name:'Registrar devolução'}).click();
  await expect(page.getByRole('form',{name:'Registrar devolução'})).toBeVisible();
  achados=await provarVisualmente(page,CAMINHO,'f32-devolucao-formulario',{
    pronto:(alvo)=>alvo.getByRole('form',{name:'Registrar devolução'}),semToasts:true,
    recorte:(alvo)=>alvo.getByRole('form',{name:'Registrar devolução'}),
  });
  const form=page.getByRole('form',{name:'Registrar devolução'});
  await form.getByRole('combobox',{name:'Origem da evidência'}).click();
  await page.getByRole('option',{name:'Arquivo EFD'}).click();
  await form.getByLabel('Data da devolução (AAAA-MM-DD)').fill('2019-02-03');
  await form.getByLabel('Chave de acesso da devolução').fill(CHAVE_DEVOLUCAO);
  await form.getByLabel('Número do documento').fill('789');
  await form.getByLabel('Série').fill('1');
  await form.getByLabel('CFOP').fill('1202');
  await form.getByLabel('Item devolvido').fill('1');
  await form.getByLabel('Quantidade devolvida (UN)').fill('1');
  await form.getByLabel('NCM (8 dígitos, se comprovado)').fill('12345678');
  await form.getByLabel('Código do produto').fill('SKU-F32');
  await form.getByLabel('Descrição do produto').fill('Autopeça sintética');
  const efd=[
    '|0190|UN|Unidade|',
    '|0200|SKU-F32|Autopeça sintética||SKU-F32|UN|00|12345678|||||1234567|',
    `|C100|0|0|PART|55|00|1|789|${CHAVE_DEVOLUCAO}|03022019||10,00|`,
    `|C113|0|1|PART|55|1||456|15012017|${CHAVE_ORIGINAL}|00|`,
    '|C170|1|SKU-F32|Autopeça sintética|1,00000|UN|10,00|0|0|00|1202|NAT|0|0|0|0|0|0|0|',
    '|C990|5|',
  ].join('\r\n');
  await form.locator('input[type="file"]').setInputFiles({name:'devolucao.txt',mimeType:'text/plain',buffer:Buffer.from(efd)});
  const submission=page.waitForResponse(response=>response.url().includes('/fiscal-documents/icms-st-returns')&&response.request().method()==='POST');
  await form.getByRole('button',{name:'Submeter devolução'}).click();
  const submissionResponse=await submission;
  expect(submissionResponse.ok(),await submissionResponse.text()).toBeTruthy();
  await expect(page.getByText(/Estado: SUBMITTED/u)).toBeVisible();
  const approval=page.waitForResponse(response=>response.url().includes('/icms-st-returns/')&&response.url().endsWith('/review')&&response.request().method()==='POST');
  await page.getByRole('button',{name:'Aprovar devolução'}).click();
  expect((await approval).ok()).toBeTruthy();
  const settlementRegion=page.getByRole('region',{name:'Complemento ou restituição de ICMS-ST'});
  await expect(settlementRegion.getByRole('button',{name:'Abrir'})).toHaveCount(2);
  await settlementRegion.getByRole('button',{name:'Abrir'}).first().click();
  await expect(page.getByRole('heading',{name:'Prévia de linha C002'})).toBeVisible();
  await expect(page.locator('pre')).toContainText('|C002|');
  await page.getByRole('button',{name:'Submeter revisão do C002'}).click();
  await expect(page.getByRole('button',{name:'Aprovar rascunho C002'})).toBeVisible();
  await page.getByRole('button',{name:'Aprovar rascunho C002'}).click();
  await expect(page.getByText('Aprovada',{exact:true})).toBeVisible();
  const stored=await pool.query<{count:string}>(`select count(*)::text count from app.tax_st_return_reversal where tenant_id=$1 and empresa_id=$2 and original_line_id=$3`,[tenantId,companyId,lineId]);
  expect(stored.rows[0]?.count).toBe('1');
  expect(snapshotId).not.toBe('');
});

test('F32 não apresenta violações críticas nem rolagem horizontal nas provas visuais',()=>{
  expect(achados).not.toBeNull();
  expect(achados?.rolagens).toEqual([]);
  for(const [theme,violations] of Object.entries(achados?.violacoes??{}))expect(violations.filter(item=>item.impacto==='critical'),`${theme}: axe`).toEqual([]);
});
