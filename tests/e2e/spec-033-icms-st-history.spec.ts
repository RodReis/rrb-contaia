import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { canonicalizarJson } from '../../packages/shared/src/canonical-json';
import { cnpjValido, criarEmpresa, criarEscritorio, criarIdentidade, criarUsuario, entrarComo, limparEscritorios, removerIdentidadesComPrefixo, vincular, type Pessoa } from './fixtures/ambiente';
import { provarVisualmente, type AchadosVisuais } from './fixtures/plano-contas';
import { FIXTURES } from '../../packages/db/src/testes/fixtures-rls';

const PREFIXO=`e2e-f33-${randomUUID()}`;
const ADMIN:Pessoa={usuario:PREFIXO,senha:`${PREFIXO}-senha-123456`,nome:'Contador F33'};
const CNPJ_ESCRITORIO=cnpjValido('299293490001');
const CNPJ_EMPRESA=cnpjValido('299293490002');
const CAMINHO=resolve('test-results',process.env['PROVA_ESCOPO']??'SPEC-024','e2e/provas/spec-033');
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
let f34PackageId='';
let f34SnapshotId='';
let f34LineId='';
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

  // Fonte controlada para provar F34 sem apresentar premissa fiscal sintética como dado legal real.
  const snapshotF34=await pool.query<{id:string}>(`insert into app.tax_st_settlement_snapshot(tenant_id,empresa_id,competence,regime,revision,idempotency_key,input_sha256,status,
    gross_restitution_cents,gross_complement_cents,net_amount_cents,line_count,blocked_line_count,facts,actor_id,correlation_id,processed_at)
    values($1,$2,'2017-02-01','SIMPLES_NACIONAL',1,$3,repeat('f',64),'PENDING_REVIEW',5000,1200,3800,1,0,'{}'::jsonb,$4,$3,now()) returning id`,[tenantId,companyId,`${PREFIXO}-f34-snapshot`,userId]);
  f34SnapshotId=snapshotF34.rows[0]?.id??'';
  const lineF34=await pool.query<{id:string}>(`insert into app.tax_st_settlement_line(tenant_id,empresa_id,snapshot_id,output_document_id,output_item_id,difference_kind,restitution_cents,
    complement_cents,facts,calculation,recovery_memory,source_ids) values($1,$2,$3,(select id from app.fiscal_document where tenant_id=$1 and empresa_id=$2 order by criado_em desc limit 1),'1',
    'RESTITUTION',5000,1200,$4::jsonb,'{}'::jsonb,'{}'::jsonb,array['entrada-f34-e2e']) returning id`,
    [tenantId,companyId,f34SnapshotId,JSON.stringify({productCode:'SKU-F33',factDate:'2017-02-15'})]);
  f34LineId=lineF34.rows[0]?.id??'';
  await pool.query(`insert into app.tax_st_settlement_review_event(tenant_id,empresa_id,snapshot_id,action,actor_id,occurred_at,correlation_id)
    values($1,$2,$3,'SUBMITTED',$4,now()-interval '1 second',$5),($1,$2,$3,'APPROVED',$4,now(),$5)`,[tenantId,companyId,f34SnapshotId,userId,`${PREFIXO}-f34-review`]);
  const sourceLine={sourceKind:'APPROVED_SETTLEMENT',sourceRevisionId:f34SnapshotId,sourceLineId:f34LineId,competence:'2017-02',eventDate:null,
    regime:'SIMPLES_NACIONAL',documentId:null,itemId:null,documentModel:null,accessKey:null,productCode:'SKU-F33',sourceIds:['entrada-f34-e2e'],
    sourceMemory:{fixture:'synthetic F33 E2E'},documentSha256:null,restitutionPrincipalCents:5000,complementPrincipalCents:1200,efdRecordCode:null};
  const canonical={companyId,regime:'SIMPLES_NACIONAL',periodStart:'2017-02',periodEnd:'2017-02',sourceRevisionIds:[f34SnapshotId],excludedCompetences:[],periodComplete:true,
    status:'BLOQUEADO_POR_ACRESCIMOS_LEGAIS',blockingReasonCodes:['F34_LEGAL_ACCRUALS_REQUIRED'],unresolvedEvidence:[],lines:[sourceLine],grossRestitutionCents:5000,
    grossComplementCents:1200,reversedRestitutionCents:0,reversedComplementCents:0,netRestitutionPrincipalCents:5000,netComplementPrincipalCents:1200,
    netPrincipalBalanceCents:3800,regimeOutput:{kind:'SIMPLES_NACIONAL',carriedBalanceCents:null,possibleDestinations:[]}};
  const payload={contractVersion:1,generatedAt:'2026-10-23T00:00:00.000Z',generatedBy:userId,tenantId,empresaId:companyId,selectionSha256:'d'.repeat(64),...canonical,
    packageId:randomUUID()};
  f34PackageId=payload.packageId;
  const sourceHash=createHash('sha256').update(canonicalizarJson({...payload,packageId:f34PackageId})).digest('hex');
  const storedPayload={...payload,contentSha256:sourceHash};
  const f34Package=await pool.query<{id:string}>(`insert into app.tax_st_history_package(id,tenant_id,empresa_id,regime,period_start,period_end,contract_version,selection_sha256,
    content_sha256,status,source_revision_ids,excluded_competences,canonical_json,requested_by,generated_at,correlation_id)
    values($1,$2,$3,'SIMPLES_NACIONAL','2017-02-01','2017-02-01',1,repeat('a',64),$4,'BLOQUEADO_POR_ACRESCIMOS_LEGAIS',array[$5::uuid],'[]'::jsonb,$6::jsonb,$7,now(),$8) returning id`,
    [f34PackageId,tenantId,companyId,sourceHash,f34SnapshotId,canonicalizarJson(storedPayload),userId,`${PREFIXO}-f34-source`]);
  expect(f34Package.rows[0]?.id).toBe(f34PackageId);
  await pool.query(`insert into app.tax_st_history_package_line(tenant_id,empresa_id,package_id,source_kind,source_revision_id,source_line_id,competence,source_ids,rule_id,formula_version,
    memory_sha256,restitution_principal_cents,complement_principal_cents,facts)
    values($1,$2,$3,'APPROVED_SETTLEMENT',$4,$5,'2017-02-01',array['entrada-f34-e2e'],'fixture-f34','fixture-v1',repeat('c',64),5000,1200,$6::jsonb)`,
    [tenantId,companyId,f34PackageId,f34SnapshotId,f34LineId,JSON.stringify(sourceLine)]);
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

test('F34 aprova fonte e pacote de demonstração, calcula, revisa e exporta sem atribuir validade legal ao fixture',async()=>{
  test.setTimeout(180_000);
  mkdirSync(CAMINHO,{recursive:true});
  await page.reload();
  await expect(page.getByRole('tab',{name:'Captura DF-e'})).toHaveAttribute('data-state','active');
  const panel=page.getByRole('region',{name:'Acréscimos legais do ICMS-ST histórico'});
  await expect(panel.getByRole('heading',{name:'Acréscimos legais do ICMS-ST histórico'})).toBeVisible();
  await panel.getByLabel('Pacote F33').selectOption(f34PackageId);
  await expect(panel.getByText('Aprovação humana da fonte F33 necessária')).toBeVisible();
  const approval=page.waitForResponse(response=>response.url().includes('/legal-approval')&&response.request().method()==='POST');
  await panel.getByRole('button',{name:'Aprovar fonte F33'}).click();
  const approvalResponse=await approval;
  expect(approvalResponse.ok(),await approvalResponse.text()).toBeTruthy();
  await expect(panel.getByText('Aprovação humana da fonte F33 necessária')).toHaveCount(0);
  await panel.getByText('Importar pacote normativo oficial',{exact:true}).click();

  const evidence=Buffer.from('E2E synthetic fixture; not an official legal source.','utf8');
  const sourceSha=createHash('sha256').update(evidence).digest('hex');
  const manifest={version:`E2E-${PREFIXO}`,coverageThrough:'2017-02-28',requiredComponents:{RESTITUTION:['MONETARY_UPDATE'],COMPLEMENT:['MONETARY_UPDATE']},
    rules:[{id:'synthetic-update',version:'1',component:'MONETARY_UPDATE',tracks:['RESTITUTION','COMPLEMENT'],validFrom:'2017-02-01',validThrough:'2017-02-28',
      formula:'FIXED_PERCENT_PPM',ratePpm:0,annualizationDays:365,termStartBasis:'COMPETENCE_START',termStartOffsetDays:0,rounding:'HALF_UP',
      officialBasis:'E2E synthetic fixture; not an official legal rule',sourceSha256:sourceSha}],
    sources:[{name:'synthetic-e2e.txt',sha256:sourceSha,officialBasis:'E2E synthetic fixture; not an official legal source',consultedAt:'2026-10-23'}]};
  const manifestFile=resolve(CAMINHO,'f34-manifest.json');
  writeFileSync(manifestFile,JSON.stringify(manifest));
  await panel.getByLabel('Manifesto JSON').setInputFiles(manifestFile);
  await panel.getByLabel('Fontes oficiais').setInputFiles({name:'synthetic-e2e.txt',mimeType:'text/plain',buffer:evidence});
  const imported=page.waitForResponse(response=>response.url().includes('/icms-st-legal-rule-packages')&&response.request().method()==='POST');
  await panel.getByRole('button',{name:'Importar e conferir hashes'}).click();
  expect((await imported).ok()).toBeTruthy();
  await expect(panel.getByText(new RegExp(`E2E-${PREFIXO}.*IMPORTED`,'u'))).toBeVisible();
  const reviewedPackage=page.waitForResponse(response=>response.url().includes('/icms-st-legal-rule-packages/')&&response.url().endsWith('/review')&&response.request().method()==='POST');
  await panel.getByRole('button',{name:'Aprovar pacote'}).click();
  const packageReviewResponse=await reviewedPackage;
  expect(packageReviewResponse.ok(),await packageReviewResponse.text()).toBeTruthy();
  await expect(panel.getByText(new RegExp(`E2E-${PREFIXO}.*APPROVED`,'u'))).toBeVisible();
  await panel.getByLabel('Data de referência').fill('2017-02-28');
  await panel.getByRole('combobox',{name:'Pacote normativo aprovado'}).click();
  await page.getByRole('option',{name:new RegExp(`E2E-${PREFIXO}`,'u')}).click();

  const calculate=async()=>{
    const response=page.waitForResponse(value=>value.url().includes('/icms-st-legal-accruals')&&!value.url().includes('/review')&&value.request().method()==='POST');
    await panel.getByRole('button',{name:'Calcular acréscimos'}).click();
    return response;
  };
  const calculated=await calculate();expect(calculated.ok(),await calculated.text()).toBeTruthy();
  const first=await calculated.json() as {id:string;hash:string;reused:boolean;result:{status:string;complement:{principalCents:number;monetaryUpdateCents:number;totalCents:number};memory:unknown[];gaps:unknown[]}};
  expect(first.result).toMatchObject({status:'READY_FOR_INTERNAL_REVIEW',complement:{principalCents:1200,monetaryUpdateCents:0,totalCents:1200},gaps:[]});
  expect(first.result.memory).toHaveLength(2);
  await expect(panel.locator('header').getByText('READY_FOR_INTERNAL_REVIEW',{exact:true})).toBeVisible();
  await panel.getByRole('button',{name:'Registrar revisão'}).click();

  for(const format of ['PDF','CSV','JSON'] as const){
    const response=page.waitForResponse(value=>value.url().includes(`/icms-st-legal-accruals/${first.id}?format=${format}`));
    const download=page.waitForEvent('download');
    await panel.getByRole('button',{name:format,exact:true}).click();
    const file=await response;expect(file.ok(),`${format}: ${file.status()}`).toBeTruthy();
    const artifactHash=file.headers()['x-content-sha256'];expect(artifactHash).toMatch(/^[0-9a-f]{64}$/u);
    const saved=await download;expect(await saved.failure()).toBeNull();
    const path=resolve(CAMINHO,`f34-${format.toLowerCase()}.${format.toLowerCase()}`);await saved.saveAs(path);
    const bytes=readFileSync(path);expect(createHash('sha256').update(bytes).digest('hex')).toBe(artifactHash);
    if(format==='PDF')expect(bytes.subarray(0,8).toString('ascii')).toBe('%PDF-1.4');
    if(format==='CSV')expect(bytes.toString('utf8')).toContain('principal_centavos');
    if(format==='JSON')expect(JSON.parse(bytes.toString('utf8'))).toMatchObject({resultId:first.id,status:'READY_FOR_INTERNAL_REVIEW'});
  }
  const same=await calculate();const reproduced=await same.json() as {id:string;hash:string;reused:boolean};
  expect(reproduced).toMatchObject({id:first.id,hash:first.hash,reused:true});
  await expect(panel.getByText('Histórico de resultados')).toBeVisible();
  await expect(panel.getByText(new RegExp(`E2E-${PREFIXO}`,'u')).last()).toBeVisible();
  achados=await provarVisualmente(page,CAMINHO,'f34-resultado-e-exports',{pronto:alvo=>alvo.getByRole('region',{name:'Acréscimos legais do ICMS-ST histórico'}),semToasts:true,
    recorte:alvo=>alvo.getByRole('region',{name:'Acréscimos legais do ICMS-ST histórico'})});
});

test('F34 não apresenta violações críticas nem rolagem horizontal nas provas visuais',()=>{
  expect(achados).not.toBeNull();expect(achados?.rolagens).toEqual([]);
  for(const [theme,violations] of Object.entries(achados?.violacoes??{}))expect(violations.filter(item=>item.impacto==='critical'),`${theme}: axe`).toEqual([]);
});

test('F35 cria dossiê interno reproduzível a partir das fontes F33/F34 e prova a tela',async()=>{
  test.setTimeout(180_000);
  mkdirSync(CAMINHO,{recursive:true});
  await page.reload();
  const panel=page.getByRole('region',{name:'Dossiê de decisão do ICMS-ST histórico'});
  await expect(panel.getByRole('heading',{name:'Dossiê de decisão do ICMS-ST histórico'})).toBeVisible();
  await panel.getByRole('combobox',{name:'Fonte F33 aprovada'}).click();
  await page.getByRole('option',{name:/Simples Nacional.*2017-02/u}).click();
  await panel.getByRole('combobox',{name:'Resultado F34'}).click();
  await page.getByRole('option',{name:/2017-02-28.*Pronto para revisão interna/u}).click();
  const created=page.waitForResponse(response=>response.url().includes('/icms-st-dossiers')&&!response.url().includes('/destination-rules')&&response.request().method()==='POST');
  await panel.getByRole('button',{name:'Criar / reproduzir dossiê'}).click();
  const response=await created;expect(response.ok(),await response.text()).toBeTruthy();
  const dossier=await response.json() as {id:string;hash:string;reused:boolean;dossier:{status:string;restitution:{status:string};complement:{status:string}}};
  expect(dossier.hash).toMatch(/^[0-9a-f]{64}$/u);
  expect(dossier.dossier).toMatchObject({restitution:{status:'PENDING'},complement:{status:'PENDING'}});
  const abrirDossie=panel.getByRole('button',{name:'Abrir'}).first();
  await expect(abrirDossie).toBeVisible();
  await abrirDossie.click();
  await expect(panel.getByRole('region',{name:'Evidências anexadas'})).toBeVisible();
  await expect(panel.getByText('\\n',{exact:true})).toHaveCount(0);
  await expect(panel.getByText(/PENDING|DRAFT|SIMPLES_NACIONAL|READY_FOR_INTERNAL_REVIEW|Choose File/u)).toHaveCount(0);
  const seletorArquivo=panel.locator('label').filter({hasText:'Selecionar arquivo'}).last();
  await expect(seletorArquivo).toBeVisible();
  await expect(panel.getByText('Aprovação registra intenção interna; nenhum efeito fiscal ou financeiro é executado.')).toBeVisible();
  achados=await provarVisualmente(page,CAMINHO,'f35-dossie-interno',{pronto:alvo=>alvo.getByRole('region',{name:'Dossiê de decisão do ICMS-ST histórico'}),semToasts:true,
    recorte:alvo=>alvo.getByRole('region',{name:'Dossiê de decisão do ICMS-ST histórico'})});
});

test('F35 não apresenta violações críticas nem rolagem horizontal nas provas visuais',()=>{
  expect(achados).not.toBeNull();expect(achados?.rolagens).toEqual([]);
  for(const [theme,violations] of Object.entries(achados?.violacoes??{}))expect(violations.filter(item=>item.impacto==='critical'),`${theme}: axe`).toEqual([]);
});
