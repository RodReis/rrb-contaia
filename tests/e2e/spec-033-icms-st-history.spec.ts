import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { cnpjValido, criarEmpresa, criarEscritorio, criarIdentidade, criarUsuario, entrarComo, limparEscritorios, removerIdentidadesComPrefixo, vincular, type Pessoa } from './fixtures/ambiente';
import { provarVisualmente, type AchadosVisuais } from './fixtures/plano-contas';
import { FIXTURES } from '../../packages/db/src/testes/fixtures-rls';

const PREFIXO=`e2e-f33-${randomUUID()}`;
const ADMIN:Pessoa={usuario:PREFIXO,senha:`${PREFIXO}-senha-123456`,nome:'Contador F33'};
const CNPJ_ESCRITORIO=cnpjValido('299293490001');
const CNPJ_EMPRESA=cnpjValido('299293490002');
const CAMINHO=resolve('test-results/SPEC-033/e2e/provas');
const pool=new Pool({connectionString:process.env['DATABASE_URL']??'postgresql://contaia:contaia_local@127.0.0.1:15432/contaia'});
const DOCUMENT_KEY='3'.repeat(44);

test.describe.configure({mode:'serial'});
test.use({trace:'off',video:'off',screenshot:'off'});
let context:BrowserContext;
let page:Page;
let tenantId='';
let userId='';
let companyId='';
let snapshotId='';
let lineId='';
let packageId='';
let achados:AchadosVisuais|null=null;

test.beforeAll(async({browser}:{browser:Browser})=>{
  test.setTimeout(240_000);
  await limparEscritorios(pool,[CNPJ_ESCRITORIO]);
  await removerIdentidadesComPrefixo(PREFIXO);
  tenantId=await criarEscritorio(pool,CNPJ_ESCRITORIO,'Escritório sintético E2E F33');
  userId=await criarUsuario(pool,tenantId,await criarIdentidade(ADMIN),ADMIN,'contador');
  companyId=await criarEmpresa(pool,tenantId,CNPJ_EMPRESA,'Autopeças sintéticas E2E F33');
  await vincular(pool,tenantId,userId,companyId);
  await pool.query(`insert into app.empresa_evento_de_historico(tenant_id,empresa_id,aba,acao,campo,valor_novo,vigencia,usuario_id)
    values($1,$2,'DADOS_FISCAIS','ALTERACAO','regimeTributario','SIMPLES_NACIONAL','2016-10-01',$3)`,[tenantId,companyId,userId]);
  const fiscalFixture=FIXTURES['app.fiscal_document'];
  if(!fiscalFixture?.preparar)throw new Error('fixture fiscal F33 indisponível');
  const staging=await fiscalFixture.preparar(pool,{tenantId,empresaId:companyId,autorId:userId,sufixo:PREFIXO});
  const stagingId=String(staging['stagingId']??'');
  if(!stagingId)throw new Error('staging sintético F33 não criado');
  const document=await pool.query<{id:string}>(`insert into app.fiscal_document(tenant_id,empresa_id,primary_staging_id,especie,chave_acesso,hash_sha256,original_key,tamanho_bytes,modelo,versao_layout,
    numero_documento,serie_documento,emitido_em,estado,parser_version)
    values($1,$2,$3,'NFE_55',$4,repeat('b',64),$5,100,'55','4.00','123','1','2017-01-15','PROCESSADO','f33-e2e') returning id`,
    [tenantId,companyId,stagingId,DOCUMENT_KEY,`${tenantId}/f33-e2e-original.xml`]);
  const documentId=document.rows[0]?.id;
  if(!documentId)throw new Error('documento fiscal sintético F33 não criado');
  await pool.query(`insert into app.fiscal_document_item(tenant_id,empresa_id,document_id,parser_version,numero,tipo,codigo,descricao,ncm,cest,cfop,unidade,quantidade,valor)
    values($1,$2,$3,'f33-e2e',1,'ITEM','SKU-F33','Autopeça sintética','87082999','1234567','5102','UN','1','50')`,[tenantId,companyId,documentId]);
  const snapshot=await pool.query<{id:string}>(`insert into app.tax_st_settlement_snapshot(tenant_id,empresa_id,competence,regime,revision,idempotency_key,input_sha256,status,
    gross_restitution_cents,gross_complement_cents,net_amount_cents,line_count,blocked_line_count,facts,actor_id,correlation_id,processed_at)
    values($1,$2,'2017-01-01','SIMPLES_NACIONAL',1,$3,repeat('c',64),'PENDING_REVIEW',5000,1200,3800,1,0,'{}'::jsonb,$4,$3,now()) returning id`,
    [tenantId,companyId,`${PREFIXO}-snapshot`,userId]);
  snapshotId=snapshot.rows[0]?.id??'';
  if(!snapshotId)throw new Error('revisão sintética F33 não criada');
  const line=await pool.query<{id:string}>(`insert into app.tax_st_settlement_line(tenant_id,empresa_id,snapshot_id,output_document_id,output_item_id,difference_kind,restitution_cents,
    complement_cents,facts,calculation,recovery_memory,source_ids)
    values($1,$2,$3,$4,'1','RESTITUTION',5000,1200,$5::jsonb,$6::jsonb,'{}'::jsonb,array['entrada-f33-1']) returning id`,
    [tenantId,companyId,snapshotId,documentId,JSON.stringify({productCode:'SKU-F33',factDate:'2017-01-15'}),JSON.stringify({ruleId:'GO-ICMS-ST-FIXTURE',formulaVersion:'F29-FIXTURE',restitutionCents:5000,complementCents:1200})]);
  lineId=line.rows[0]?.id??'';
  if(!lineId)throw new Error('linha sintética F33 não criada');
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

test('F33 reconstrói principal aprovado, exporta artefatos privados e prova temas e larguras',async()=>{
  test.setTimeout(180_000);
  mkdirSync(CAMINHO,{recursive:true});
  const panel=page.getByRole('region',{name:'Reconstrução histórica do ICMS-ST'});
  await expect(panel.getByRole('heading',{name:'Reconstrução histórica do ICMS-ST'})).toBeVisible();
  const generated=page.waitForResponse(response=>response.url().includes('/icms-st-history-packages')&&response.request().method()==='POST');
  await panel.getByRole('button',{name:'Gerar dossiê interno'}).click();
  const response=await generated;
  expect(response.ok(),await response.text()).toBeTruthy();
  const body=await response.json() as {id:string;hash:string;package:{grossRestitutionCents:number;grossComplementCents:number;netPrincipalBalanceCents:number}};
  packageId=body.id;
  expect(body.package).toMatchObject({grossRestitutionCents:5000,grossComplementCents:1200,netPrincipalBalanceCents:3800});
  await expect(panel.getByText('Hash SHA-256')).toContainText(body.hash);
  await expect(panel.getByText(/R\$\s*50,00/u).first()).toBeVisible();
  await expect(panel.getByRole('heading',{name:'Competências excluídas ou com evidência pendente'})).toBeVisible();
  for(const format of ['PDF','CSV','JSON'] as const){
    const download=page.waitForResponse(response=>response.url().includes(`/icms-st-history-packages/${packageId}?format=${format}`));
    const saved=page.waitForEvent('download');
    await panel.getByRole('button',{name:format,exact:true}).click();
    const file=await download;
    expect(file.ok(),`${format}: ${file.status()} ${await file.text()}`).toBeTruthy();
    const artifactHash=file.headers()['x-content-sha256'];
    expect(artifactHash).toMatch(/^[0-9a-f]{64}$/u);
    const browserDownload=await saved;
    expect(await browserDownload.failure()).toBeNull();
    const artifactPath=resolve(CAMINHO,`f33-${format.toLowerCase()}.${format.toLowerCase()}`);
    await browserDownload.saveAs(artifactPath);
    const bytes=readFileSync(artifactPath);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(artifactHash);
    expect(format==='PDF'?bytes.subarray(0,8).toString('ascii'):'').toBe(format==='PDF'?'%PDF-1.4':'');
    if(format==='CSV')expect(bytes.toString('utf8')).toContain('restituicao_centavos');
    if(format==='JSON')expect(JSON.parse(bytes.toString('utf8'))).toMatchObject({packageId,contentSha256:body.hash});
  }
  const reproduced=page.waitForResponse(res=>res.url().includes('/icms-st-history-packages')&&res.request().method()==='POST');
  await panel.getByRole('button',{name:'Gerar dossiê interno'}).click();
  const reproducedBody=await (await reproduced).json() as {id:string;hash:string;reused:boolean};
  expect(reproducedBody).toMatchObject({id:packageId,hash:body.hash,reused:true});
  const nextSnapshot=await pool.query<{id:string}>(`insert into app.tax_st_settlement_snapshot(tenant_id,empresa_id,competence,regime,revision,idempotency_key,input_sha256,status,
    gross_restitution_cents,gross_complement_cents,net_amount_cents,line_count,blocked_line_count,facts,actor_id,correlation_id,processed_at)
    values($1,$2,'2017-01-01','SIMPLES_NACIONAL',2,$3,repeat('e',64),'PENDING_REVIEW',6000,1200,4800,1,0,'{}'::jsonb,$4,$3,now()) returning id`,[tenantId,companyId,`${PREFIXO}-snapshot-v2`,userId]);
  const nextSnapshotId=nextSnapshot.rows[0]?.id;
  if(!nextSnapshotId)throw new Error('segunda revisão sintética F33 não criada');
  await pool.query(`insert into app.tax_st_settlement_line(tenant_id,empresa_id,snapshot_id,output_document_id,output_item_id,difference_kind,restitution_cents,
    complement_cents,facts,calculation,recovery_memory,source_ids)
    select tenant_id,empresa_id,$3,output_document_id,output_item_id,difference_kind,6000,1200,facts,calculation,recovery_memory,source_ids
    from app.tax_st_settlement_line where tenant_id=$1 and empresa_id=$2 and id=$4`,[tenantId,companyId,nextSnapshotId,lineId]);
  await pool.query(`insert into app.tax_st_settlement_review_event(tenant_id,empresa_id,snapshot_id,action,actor_id,occurred_at,correlation_id)
    values($1,$2,$3,'SUBMITTED',$4,now()-interval '1 second',$5),($1,$2,$3,'APPROVED',$4,now(),$5)`,[tenantId,companyId,nextSnapshotId,userId,`${PREFIXO}-review-v2`]);
  const superseding=page.waitForResponse(res=>res.url().includes('/icms-st-history-packages')&&res.request().method()==='POST');
  await panel.getByRole('button',{name:'Gerar dossiê interno'}).click();
  const supersededBody=await (await superseding).json() as {id:string;hash:string;reused:boolean;package:{grossRestitutionCents:number}};
  expect(supersededBody.id).not.toBe(packageId);
  expect(supersededBody.package.grossRestitutionCents).toBe(6000);
  const supersededEvent=await pool.query<{count:string}>(`select count(*)::text count from app.tax_st_history_package_event where package_id=$1 and action='SUPERSEDED' and details->>'supersededBy'=$2`,[packageId,supersededBody.id]);
  expect(supersededEvent.rows[0]?.count).toBe('1');
  const priorEvents=await pool.query<{actions:string[]}>(`select array_agg(action order by occurred_at,id) actions from app.tax_st_history_package_event where tenant_id=$1 and empresa_id=$2 and package_id=$3`,[tenantId,companyId,packageId]);
  expect(priorEvents.rows[0]?.actions?.sort()).toEqual(['SELECTED','GENERATED','DOWNLOADED','DOWNLOADED','DOWNLOADED','REPRODUCED','SUPERSEDED'].sort());
  packageId=supersededBody.id;
  const events=await pool.query<{actions:string[]}>(`select array_agg(action order by occurred_at,id) actions from app.tax_st_history_package_event where tenant_id=$1 and empresa_id=$2 and package_id=$3`,[tenantId,companyId,packageId]);
  expect(events.rows[0]?.actions?.sort()).toEqual(['SELECTED','GENERATED'].sort());
  expect(snapshotId).not.toBe('');
  expect(lineId).not.toBe('');
  achados=await provarVisualmente(page,CAMINHO,'f33-pacote-gerado',{pronto:alvo=>alvo.getByRole('region',{name:'Reconstrução histórica do ICMS-ST'}),semToasts:true,
    recorte:alvo=>alvo.getByRole('region',{name:'Reconstrução histórica do ICMS-ST'})});
});

test('F33 não apresenta violações críticas nem rolagem horizontal nas provas visuais',()=>{
  expect(achados).not.toBeNull();
  expect(achados?.rolagens).toEqual([]);
  for(const [theme,violations] of Object.entries(achados?.violacoes??{}))expect(violations.filter(item=>item.impacto==='critical'),`${theme}: axe`).toEqual([]);
});
