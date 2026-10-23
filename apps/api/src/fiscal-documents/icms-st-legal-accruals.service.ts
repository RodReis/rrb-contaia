import { createHash, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { calculateIcmsStLegalAccruals, type IcmsStLegalAccrualRule, type IcmsStLegalAccrualSource } from '@contaia/domain';
import { comContextoHumano } from '@contaia/db';
import { CODIGOS_DE_ERRO, ErroDeDominio } from '@contaia/domain';
import { PoolDoBanco } from '../banco/pool.provider';
import { StorageService } from '../comum/storage.service';
import { renderIcmsStLegalAccrualsPdf } from './icms-st-legal-accruals-pdf';

type LegalPackage=Readonly<{version:string;coverageThrough:string;requiredComponents:Readonly<Record<'RESTITUTION'|'COMPLEMENT',readonly IcmsStLegalAccrualRule['component'][]>>;
  rules:readonly IcmsStLegalAccrualRule[];sources:readonly Readonly<{name:string;sha256:string;officialBasis:string;consultedAt:string;storageKey:string}>[]}>;
type StoredResult=Readonly<{id:string;canonical_json:unknown;content_sha256:string;source_package_id:string;rule_package_id:string|null;status:string}>;
type UploadedFile=Readonly<{originalname:string;mimetype:string;buffer:Buffer}>;
const sha=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const json=(value:unknown)=>JSON.stringify(value);
const object=(value:unknown):Record<string,unknown>=>typeof value==='object'&&value!==null&&!Array.isArray(value)?value as Record<string,unknown>:{};
const currency=(value:unknown):number|null=>{const amount=Number(value);return Number.isSafeInteger(amount)&&amount>=0?amount:null;};

@Injectable()
export class IcmsStLegalAccrualsService {
  constructor(private readonly pool:PoolDoBanco,private readonly storage:StorageService){}

  async listarFontes(tenantId:string,userId:string,companyId:string,correlationId:string){
    return comContextoHumano(this.pool.instancia,{tenantId,usuarioId:userId,correlationId},async(client)=>{
      const rows=await client.query<Record<string,unknown>>(`select p.id,p.regime,p.period_start::text,p.period_end::text,p.status,p.content_sha256,
        p.canonical_json->>'periodComplete' period_complete,
        exists(select 1 from app.tax_st_history_package_event e where e.package_id=p.id and e.action='APPROVED') approved,
        exists(select 1 from app.tax_st_history_package_event e where e.package_id=p.id and e.action='SUPERSEDED') superseded
        from app.tax_st_history_package p where p.tenant_id=$1 and p.empresa_id=$2 and app.empresa_autorizada(p.empresa_id)
        order by p.generated_at desc,p.id`,[tenantId,companyId]);
      return {itens:rows.rows.map(row=>({id:String(row['id']),regime:String(row['regime']),periodStart:String(row['period_start']).slice(0,7),
        periodEnd:String(row['period_end']).slice(0,7),status:String(row['status']),hash:String(row['content_sha256']),
        periodComplete:row['period_complete']==='true',approved:Boolean(row['approved']),superseded:Boolean(row['superseded'])}))};
    });
  }

  async listarPacotesNormativos(tenantId:string,userId:string,companyId:string,correlationId:string){
    return comContextoHumano(this.pool.instancia,{tenantId,usuarioId:userId,correlationId},async(client)=>{
      const rows=await client.query<Record<string,unknown>>(`select p.id,p.version,p.coverage_through::text,p.content_sha256,
        (select e.action from app.tax_st_legal_rule_package_event e where e.package_id=p.id order by e.occurred_at desc,e.id desc limit 1) review_action
        from app.tax_st_legal_rule_package p where p.tenant_id=$1 and p.empresa_id=$2 and app.empresa_autorizada(p.empresa_id) order by p.created_at desc,p.id`,[tenantId,companyId]);
      return {itens:rows.rows.map(row=>({id:String(row['id']),version:String(row['version']),coverageThrough:String(row['coverage_through']),hash:String(row['content_sha256']),status:String(row['review_action'])}))};
    });
  }

  async listarAtosFormais(tenantId:string,userId:string,companyId:string,sourcePackageId:string,correlationId:string){
    return comContextoHumano(this.pool.instancia,{tenantId,usuarioId:userId,correlationId},async(client)=>{
      const rows=await client.query<Record<string,unknown>>(`select a.id,a.issuer,a.act_number,a.act_type,a.act_date::text,a.period_start::text,a.period_end::text,a.content_sha256,a.canonical_facts,
        (select e.action from app.tax_st_legal_formal_act_event e where e.act_id=a.id order by e.occurred_at desc,e.id desc limit 1) review_action
        from app.tax_st_legal_formal_act a where a.tenant_id=$1 and a.empresa_id=$2 and a.source_package_id=$3 and app.empresa_autorizada(a.empresa_id) order by a.act_date desc,a.id`,[tenantId,companyId,sourcePackageId]);
      return {itens:rows.rows.map(row=>({id:String(row['id']),issuer:String(row['issuer']),actNumber:String(row['act_number']),actType:String(row['act_type']),
        actDate:String(row['act_date']),periodStart:String(row['period_start']),periodEnd:String(row['period_end']),hash:String(row['content_sha256']),status:String(row['review_action']),
        components:Array.isArray(object(row['canonical_facts'])['components'])?(object(row['canonical_facts'])['components'] as unknown[]).map(String):[]}))};
    });
  }

  async listarResultados(tenantId:string,userId:string,companyId:string,sourcePackageId:string,correlationId:string){
    return comContextoHumano(this.pool.instancia,{tenantId,usuarioId:userId,correlationId},async(client)=>{
      const rows=await client.query<Record<string,unknown>>(`select r.id,r.reference_date::text,r.status,r.content_sha256,r.generated_at,
        exists(select 1 from app.tax_st_legal_accrual_event e where e.result_id=r.id and e.action='SUPERSEDED') superseded from app.tax_st_legal_accrual_result r
        where r.tenant_id=$1 and r.empresa_id=$2 and r.source_package_id=$3 and app.empresa_autorizada(r.empresa_id) order by r.generated_at desc,r.id`,[tenantId,companyId,sourcePackageId]);
      return {itens:rows.rows.map(row=>({id:String(row['id']),referenceDate:String(row['reference_date']),status:row['superseded']?'SUPERSEDED':String(row['status']),hash:String(row['content_sha256']),generatedAt:String(row['generated_at'])}))};
    });
  }

  async aprovarFonte(tenantId:string,userId:string,companyId:string,packageId:string,correlationId:string){
    return comContextoHumano(this.pool.instancia,{tenantId,usuarioId:userId,correlationId},async(client)=>{
      await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`f34/source/${tenantId}/${companyId}/${packageId}`]);
      const source=await client.query<{id:string;status:string;content_sha256:string;canonical_json:unknown;source_revision_ids:string[];regime:string;period_start:string;period_end:string;contract_version:number}>(
        'select id,status,content_sha256,canonical_json,source_revision_ids,regime,period_start::text,period_end::text,contract_version from app.tax_st_history_package where id=$1 and tenant_id=$2 and empresa_id=$3 and app.empresa_autorizada(empresa_id)',
        [packageId,tenantId,companyId]);
      let row=source.rows[0];if(!row)throw this.naoEncontrado('Pacote F33 não encontrado.');
      await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[
        `${tenantId}/${companyId}/${row.regime}/${row.period_start.slice(0,7)}/${row.period_end.slice(0,7)}/${row.contract_version}`]);
      const current=await client.query<typeof row>(
        'select id,status,content_sha256,canonical_json,source_revision_ids,regime,period_start::text,period_end::text,contract_version from app.tax_st_history_package where id=$1 and tenant_id=$2 and empresa_id=$3 and app.empresa_autorizada(empresa_id)',
        [packageId,tenantId,companyId]);
      row=current.rows[0];if(!row)throw this.naoEncontrado('Pacote F33 não encontrado.');
      const payload=object(row.canonical_json);
      const hashMaterial={...payload};delete hashMaterial['contentSha256'];
      if(!['READY_FOR_INTERNAL_REVIEW','BLOQUEADO_POR_ACRESCIMOS_LEGAIS'].includes(row.status)||payload['periodComplete']!==true||
        sha(json({...hashMaterial,packageId}))!==row.content_sha256||payload['contentSha256']!==row.content_sha256)
        throw this.indeterminado('Pacote F33 incompleto, inválido ou inelegível.');
      const lines=Array.isArray(payload['lines'])?payload['lines']:[];
      const packageLines=await client.query<{count:string;line_ids:string[];revision_ids:string[]}>(`select count(*)::text count,coalesce(array_agg(source_line_id::text order by source_line_id::text),'{}') line_ids,
        coalesce(array_agg(distinct source_revision_id::text order by source_revision_id::text),'{}') revision_ids
        from app.tax_st_history_package_line where package_id=$1 and tenant_id=$2 and empresa_id=$3`,[packageId,tenantId,companyId]);
      const savedLineIds=new Set(packageLines.rows[0]?.line_ids??[]);
      const savedRevisionIds=[...(packageLines.rows[0]?.revision_ids??[])].sort();
      if(lines.length===0||Number(packageLines.rows[0]?.count??0)!==lines.length||lines.some(line=>!savedLineIds.has(String(object(line)['sourceLineId']??'')))||
        JSON.stringify(savedRevisionIds)!==JSON.stringify([...row.source_revision_ids].sort())||row.source_revision_ids.length===0)
        throw this.indeterminado('Linhas e revisões do pacote F33 não correspondem à persistência íntegra.');
      const revisions=await client.query<{count:string}>(`select count(*)::text count from unnest($1::uuid[]) revision_id
        join app.tax_st_settlement_snapshot s on s.id=revision_id and s.tenant_id=$2 and s.empresa_id=$3
        join lateral(select action from app.tax_st_settlement_review_event r where r.snapshot_id=s.id order by r.occurred_at desc,r.id desc limit 1) review on review.action='APPROVED'
        where not exists(select 1 from app.tax_st_settlement_event e where e.snapshot_id=s.id and e.action='DOCUMENT_SET_CHANGED')
          and not exists(select 1 from app.tax_st_settlement_snapshot newer where newer.tenant_id=s.tenant_id and newer.empresa_id=s.empresa_id and newer.competence=s.competence and newer.regime=s.regime and newer.revision>s.revision
            and exists(select 1 from app.tax_st_settlement_review_event approved where approved.snapshot_id=newer.id and approved.action='APPROVED'))`,[row.source_revision_ids,tenantId,companyId]);
      if(Number(revisions.rows[0]?.count??0)!==row.source_revision_ids.length)
        throw this.indeterminado('Pacote F33 contém revisão pendente, superada ou desatualizada.');
      const existing=await client.query('select 1 from app.tax_st_history_package_event where package_id=$1 and action in (\'APPROVED\',\'SUPERSEDED\') limit 1',[packageId]);
      if(existing.rowCount!==0)throw new ErroDeDominio(CODIGOS_DE_ERRO.ICMS_ST_ACCRUAL_SOURCE_PACKAGE_INELIGIBLE,'Pacote F33 já decidido ou superado.');
      await client.query(`insert into app.tax_st_history_package_event(tenant_id,empresa_id,package_id,action,actor_id,occurred_at,correlation_id,details)
        values($1,$2,$3,'APPROVED',$4,now(),$5,'{"scope":"F34"}'::jsonb)`,[tenantId,companyId,packageId,userId,correlationId]);
      return {sourcePackageId:packageId,approved:true};
    });
  }

  async importarPacoteNormativo(tenantId:string,userId:string,companyId:string,input:Readonly<{version:string;coverageThrough:string;
    requiredComponents:LegalPackage['requiredComponents'];rules:readonly IcmsStLegalAccrualRule[];sources:readonly Readonly<{name:string;sha256:string;officialBasis:string;consultedAt:string}>[]}>,files:readonly UploadedFile[],correlationId:string){
    for(const track of ['RESTITUTION','COMPLEMENT'] as const){const components=input.requiredComponents[track];
      if(new Set(components).size!==components.length||components.some(component=>!input.rules.some(rule=>rule.tracks.includes(track)&&rule.component===component)))
        throw this.indeterminado(`Pacote sem regra vinculada para componente requerido em ${track}.`);}
    for(const rule of input.rules){if(rule.validThrough<rule.validFrom)throw this.indeterminado(`Vigência inválida na regra ${rule.id}.`);
      if(rule.component==='INFRACTION_PENALTY'&&!rule.formalActId)throw this.indeterminado(`Regra de penalidade sem ato formal: ${rule.id}.`);}
    const byName=new Map(files.map(file=>[file.originalname,file]));
    const sources:LegalPackage['sources'][number][]=[];
    for(const source of input.sources){const file=byName.get(source.name);if(!file||sha(file.buffer)!==source.sha256)throw this.indeterminado(`Fonte normativa ausente ou hash divergente: ${source.name}.`);
      const storageKey=`${tenantId}/${companyId}/fiscal/icms-st-legal-rules/${randomUUID()}/${source.sha256}`;
      await this.storage.enviarComChave(storageKey,file.buffer,file.mimetype||'application/octet-stream');sources.push({...source,storageKey});}
    const hashes=new Set(sources.map(source=>source.sha256));
    if(input.rules.some(rule=>!hashes.has(rule.sourceSha256)))throw this.indeterminado('Regra normativa aponta para fonte não anexada.');
    const canonical:LegalPackage={...input,sources};const canonicalJson=json(canonical);const contentSha=sha(canonicalJson);
    return comContextoHumano(this.pool.instancia,{tenantId,usuarioId:userId,correlationId},async(client)=>{
      const id=randomUUID();
      await client.query(`insert into app.tax_st_legal_rule_package(id,tenant_id,empresa_id,version,coverage_through,content_sha256,canonical_json,requested_by,created_at)
        values($1,$2,$3,$4,$5::date,$6,$7::jsonb,$8,now())`,[id,tenantId,companyId,input.version,input.coverageThrough,contentSha,canonicalJson,userId]);
      await client.query(`insert into app.tax_st_legal_rule_package_event(tenant_id,empresa_id,package_id,action,actor_id,occurred_at,correlation_id,details)
        values($1,$2,$3,'IMPORTED',$4,now(),$5,$6::jsonb)`,[tenantId,companyId,id,userId,correlationId,json({contentSha256:contentSha,sourceCount:sources.length})]);
      return {id,version:input.version,hash:contentSha,status:'PENDING_REVIEW'};
    });
  }

  async decidirPacoteNormativo(tenantId:string,userId:string,companyId:string,packageId:string,action:'APPROVED'|'REJECTED',reason:string|null,correlationId:string){
    return comContextoHumano(this.pool.instancia,{tenantId,usuarioId:userId,correlationId},async(client)=>{
      await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`f34/rule/${tenantId}/${companyId}/${packageId}`]);
      const row=await client.query<{id:string;canonical_json:unknown;content_sha256:string}>('select id,canonical_json,content_sha256 from app.tax_st_legal_rule_package where id=$1 and tenant_id=$2 and empresa_id=$3 and app.empresa_autorizada(empresa_id) for share',[packageId,tenantId,companyId]);
      if(!row.rows[0])throw this.naoEncontrado('Pacote normativo não encontrado.');
      const canonical=object(row.rows[0].canonical_json);
      if(action==='APPROVED'&&(sha(json(canonical))!==row.rows[0].content_sha256||!Array.isArray(canonical['sources'])||!Array.isArray(canonical['rules'])))
        throw this.indeterminado('Hash ou conteúdo canônico do pacote normativo divergente.');
      const previous=await client.query<{action:string}>('select action from app.tax_st_legal_rule_package_event where package_id=$1 order by occurred_at desc,id desc limit 1',[packageId]);
      if(previous.rows[0]?.action!=='IMPORTED')throw new ErroDeDominio(CODIGOS_DE_ERRO.ICMS_ST_ACCRUAL_RULE_PACKAGE_NOT_APPROVED,'Pacote normativo já recebeu decisão.');
      await client.query(`insert into app.tax_st_legal_rule_package_event(tenant_id,empresa_id,package_id,action,actor_id,occurred_at,correlation_id,details)
        values($1,$2,$3,$4,$5,now(),$6,$7::jsonb)`,[tenantId,companyId,packageId,action,userId,correlationId,json({reason})]);
      return {packageId,action};
    });
  }

  async importarAtoFormal(tenantId:string,userId:string,companyId:string,input:Readonly<{sourcePackageId:string;issuer:string;actNumber:string;actType:'ASSESSMENT_NOTICE'|'SUMMONS'|'DECISION'|'OTHER';actDate:string;periodStart:string;periodEnd:string;officialBasis:string;canonicalFacts:Readonly<Record<string,unknown>>}>,file:UploadedFile,correlationId:string){
    const fileSha=sha(file.buffer),storageKey=`${tenantId}/${companyId}/fiscal/icms-st-legal-acts/${randomUUID()}/${fileSha}`;
    await this.storage.enviarComChave(storageKey,file.buffer,file.mimetype||'application/octet-stream');
    return comContextoHumano(this.pool.instancia,{tenantId,usuarioId:userId,correlationId},async(client)=>{
      const source=await client.query('select id from app.tax_st_history_package where id=$1 and tenant_id=$2 and empresa_id=$3 and app.empresa_autorizada(empresa_id)',[input.sourcePackageId,tenantId,companyId]);
      if(!source.rowCount)throw this.naoEncontrado('Pacote F33 não encontrado para vínculo do ato.');
      const id=randomUUID();
      await client.query(`insert into app.tax_st_legal_formal_act(id,tenant_id,empresa_id,source_package_id,issuer,act_number,act_type,act_date,period_start,period_end,official_basis,storage_key,content_sha256,canonical_facts,requested_by,created_at)
        values($1,$2,$3,$4,$5,$6,$7,$8::date,$9::date,$10::date,$11,$12,$13,$14::jsonb,$15,now())`,[id,tenantId,companyId,input.sourcePackageId,input.issuer,input.actNumber,input.actType,input.actDate,input.periodStart,input.periodEnd,input.officialBasis,storageKey,fileSha,json(input.canonicalFacts),userId]);
      await client.query(`insert into app.tax_st_legal_formal_act_event(tenant_id,empresa_id,act_id,action,actor_id,occurred_at,correlation_id,details)
        values($1,$2,$3,'IMPORTED',$4,now(),$5,$6::jsonb)`,[tenantId,companyId,id,userId,correlationId,json({contentSha256:fileSha})]);
      return {id,hash:fileSha,status:'PENDING_REVIEW'};
    });
  }

  async decidirAtoFormal(tenantId:string,userId:string,companyId:string,actId:string,action:'APPROVED'|'REJECTED',reason:string|null,correlationId:string){
    return comContextoHumano(this.pool.instancia,{tenantId,usuarioId:userId,correlationId},async(client)=>{
      await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`f34/act/${tenantId}/${companyId}/${actId}`]);
      const row=await client.query('select id from app.tax_st_legal_formal_act where id=$1 and tenant_id=$2 and empresa_id=$3 and app.empresa_autorizada(empresa_id)',[actId,tenantId,companyId]);
      if(!row.rowCount)throw this.naoEncontrado('Ato formal não encontrado.');
      const previous=await client.query<{action:string}>('select action from app.tax_st_legal_formal_act_event where act_id=$1 order by occurred_at desc,id desc limit 1',[actId]);
      if(previous.rows[0]?.action!=='IMPORTED')throw this.indeterminado('Ato formal já recebeu decisão.');
      await client.query(`insert into app.tax_st_legal_formal_act_event(tenant_id,empresa_id,act_id,action,actor_id,occurred_at,correlation_id,details)
        values($1,$2,$3,$4,$5,now(),$6,$7::jsonb)`,[tenantId,companyId,actId,action,userId,correlationId,json({reason})]);
      return {actId,action};
    });
  }

  async listarAtos(tenantId:string,userId:string,companyId:string,sourcePackageId:string,correlationId:string){
    return comContextoHumano(this.pool.instancia,{tenantId,usuarioId:userId,correlationId},async(client)=>{
      const rows=await client.query<Record<string,unknown>>(`select a.id,a.issuer,a.act_number,a.act_type,a.act_date::text,a.period_start::text,a.period_end::text,a.content_sha256,
        (select e.action from app.tax_st_legal_formal_act_event e where e.act_id=a.id order by e.occurred_at desc,e.id desc limit 1) review_action
        from app.tax_st_legal_formal_act a where a.tenant_id=$1 and a.empresa_id=$2 and a.source_package_id=$3 and app.empresa_autorizada(a.empresa_id) order by a.act_date desc,a.id`,
        [tenantId,companyId,sourcePackageId]);
      return {itens:rows.rows.map(row=>({id:String(row['id']),issuer:String(row['issuer']),actNumber:String(row['act_number']),actType:String(row['act_type']),
        actDate:String(row['act_date']),periodStart:String(row['period_start']),periodEnd:String(row['period_end']),hash:String(row['content_sha256']),status:String(row['review_action'])}))};
    });
  }

  async calcular(tenantId:string,userId:string,companyId:string,input:Readonly<{sourcePackageId:string;referenceDate:string;rulePackageId:string|null;formalActIds:readonly string[]}>,correlationId:string){
    const loaded=await comContextoHumano(this.pool.instancia,{tenantId,usuarioId:userId,correlationId},async(client)=>{
      const source=await client.query<Record<string,unknown>>(`select p.id,p.regime,p.status,p.content_sha256,p.canonical_json,p.source_revision_ids,
        exists(select 1 from app.tax_st_history_package_event e where e.package_id=p.id and e.action='APPROVED') approved,
        exists(select 1 from app.tax_st_history_package_event e where e.package_id=p.id and e.action='SUPERSEDED') superseded,
        exists(select 1 from app.tax_st_history_package_event e where e.package_id=p.id and e.action='POSSIBLY_OUTDATED') possibly_outdated
        from app.tax_st_history_package p where p.id=$1 and p.tenant_id=$2 and p.empresa_id=$3 and app.empresa_autorizada(p.empresa_id)`,[input.sourcePackageId,tenantId,companyId]);
      const sourceRow=source.rows[0];if(!sourceRow)throw this.naoEncontrado('Pacote F33 não encontrado.');
      let rulePackage:Record<string,unknown>|null=null;let ruleStatus=false;let ruleSuperseded=false;
      if(input.rulePackageId){const found=await client.query<Record<string,unknown>>(`select p.id,p.version,p.coverage_through::text,p.content_sha256,p.canonical_json,
        (select e.action from app.tax_st_legal_rule_package_event e where e.package_id=p.id order by e.occurred_at desc,e.id desc limit 1) review_action,
        exists(select 1 from app.tax_st_legal_rule_package_event e where e.package_id=p.id and e.action='SUPERSEDED') superseded
        from app.tax_st_legal_rule_package p where p.id=$1 and p.tenant_id=$2 and p.empresa_id=$3 and app.empresa_autorizada(p.empresa_id)`,[input.rulePackageId,tenantId,companyId]);
        rulePackage=found.rows[0]??null;ruleSuperseded=Boolean(rulePackage?.['superseded']);ruleStatus=rulePackage?.['review_action']==='APPROVED'&&!ruleSuperseded;}
      const acts=input.formalActIds.length?await client.query<Record<string,unknown>>(`select a.id,a.content_sha256,a.storage_key,
        (select e.action from app.tax_st_legal_formal_act_event e where e.act_id=a.id order by e.occurred_at desc,e.id desc limit 1) review_action,
        a.canonical_facts from app.tax_st_legal_formal_act a where a.id=any($1::uuid[]) and a.tenant_id=$2 and a.empresa_id=$3 and a.source_package_id=$4 and app.empresa_autorizada(a.empresa_id)`,[input.formalActIds,tenantId,companyId,input.sourcePackageId]):{rows:[]};
      const canonical=object(sourceRow['canonical_json']);const lines=Array.isArray(canonical['lines'])?canonical['lines']:[];
      const sourceLineIds=lines.map(raw=>String(object(raw)['sourceLineId']??''));
      const hashMaterial={...canonical};delete hashMaterial['contentSha256'];
      const recomputedSourceHash=sha(json({...hashMaterial,packageId:String(sourceRow['id'])}));
      if(recomputedSourceHash!==String(sourceRow['content_sha256']))throw this.indeterminado('Hash canônico da fonte F33 divergente.');
      const persistedLines=await client.query<{count:string;line_ids:string[];revision_ids:string[]}>(`select count(*)::text count,
        coalesce(array_agg(source_line_id::text order by source_line_id::text),'{}') line_ids,
        coalesce(array_agg(distinct source_revision_id::text order by source_revision_id::text),'{}') revision_ids
        from app.tax_st_history_package_line where package_id=$1 and tenant_id=$2 and empresa_id=$3`,[input.sourcePackageId,tenantId,companyId]);
      const persisted=persistedLines.rows[0];
      const revisions=[...(Array.isArray(sourceRow['source_revision_ids'])?sourceRow['source_revision_ids'] as string[]:[])].map(String).sort();
      if(lines.length===0||Number(persisted?.count??0)!==lines.length||sourceLineIds.some(id=>!persisted?.line_ids.includes(id))||
        JSON.stringify([...(persisted?.revision_ids??[])].sort())!==JSON.stringify(revisions))
        throw this.indeterminado('Linhas e revisões persistidas da fonte F33 divergem do pacote canônico.');
      const currentRevisions=await client.query<{count:string}>(`select count(*)::text count from unnest($1::uuid[]) revision_id
        join app.tax_st_settlement_snapshot s on s.id=revision_id and s.tenant_id=$2 and s.empresa_id=$3
        join lateral(select action from app.tax_st_settlement_review_event r where r.snapshot_id=s.id order by r.occurred_at desc,r.id desc limit 1) review on review.action='APPROVED'
        where not exists(select 1 from app.tax_st_settlement_event e where e.snapshot_id=s.id and e.action='DOCUMENT_SET_CHANGED')
          and not exists(select 1 from app.tax_st_settlement_snapshot newer where newer.tenant_id=s.tenant_id and newer.empresa_id=s.empresa_id and newer.competence=s.competence and newer.regime=s.regime and newer.revision>s.revision
            and exists(select 1 from app.tax_st_settlement_review_event approved where approved.snapshot_id=newer.id and approved.action='APPROVED'))`,[revisions,tenantId,companyId]);
      const sourceCurrentlyEligible=Number(currentRevisions.rows[0]?.count??0)===revisions.length&&sourceRow['superseded']!==true&&sourceRow['possibly_outdated']!==true&&
        ['READY_FOR_INTERNAL_REVIEW','BLOQUEADO_POR_ACRESCIMOS_LEGAIS'].includes(String(sourceRow['status']));
      const sourceInput:IcmsStLegalAccrualSource={id:String(sourceRow['id']),tenantId,companyId,regime:sourceRow['regime'] as IcmsStLegalAccrualSource['regime'],
        approved:Boolean(sourceRow['approved'])&&sourceCurrentlyEligible&&recomputedSourceHash===String(sourceRow['content_sha256']),superseded:Boolean(sourceRow['superseded'])||!sourceCurrentlyEligible,hash:String(sourceRow['content_sha256']),
        lines:lines.flatMap((raw,index)=>{const line=object(raw);const rest=currency(line['restitutionPrincipalCents'])??0;const comp=currency(line['complementPrincipalCents'])??0;
          const base={id:String(line['sourceLineId']??index),competence:String(line['competence']??''),termStartDate:typeof line['termStartDate']==='string'?line['termStartDate']:null};
          return [...(rest>0?[{...base,track:'RESTITUTION' as const,principalCents:rest}]:[]),...(comp>0?[{...base,track:'COMPLEMENT' as const,principalCents:comp}]:[])];})};
      const content=rulePackage?object(rulePackage['canonical_json']):null;const rules=content&&Array.isArray(content['rules'])?content['rules'] as IcmsStLegalAccrualRule[]:[];
      let ruleSourcesValid=Boolean(content&&rulePackage&&sha(json(content))===String(rulePackage['content_sha256'])&&Array.isArray(content['sources'])&&
        Array.isArray(content['rules'])&&Array.isArray(object(content['requiredComponents'])['RESTITUTION'])&&Array.isArray(object(content['requiredComponents'])['COMPLEMENT']));
      const ruleSources=content&&Array.isArray(content['sources'])?content['sources']:[];
      for(const raw of ruleSources){const item=object(raw);const sourceBytes=await this.storage.obter(String(item['storageKey']??''));
        if(sha(sourceBytes.conteudo)!==String(item['sha256']))ruleSourcesValid=false;}
      if(!ruleSourcesValid)ruleStatus=false;
      if(rulePackage&&!ruleSourcesValid)ruleSuperseded=true;
      const formalActs=[];
      for(const row of acts.rows){const bytes=await this.storage.obter(String(row['storage_key']));const valid=row['review_action']==='APPROVED'&&sha(bytes.conteudo)===String(row['content_sha256']);
        const facts=object(row['canonical_facts']);formalActs.push({id:String(row['id']),tenantId,companyId,sourcePackageId:input.sourcePackageId,approved:valid,valid,hash:String(row['content_sha256']),
          components:(Array.isArray(facts['components'])?facts['components']:[]) as IcmsStLegalAccrualRule['component'][],
          penaltyAmounts:(Array.isArray(facts['penaltyAmounts'])?facts['penaltyAmounts']:[]) as {lineId:string;amountCents:number}[]});}
      const result=calculateIcmsStLegalAccruals({source:sourceInput,referenceDate:input.referenceDate,
        rulePackage:content&&rulePackage?{id:String(rulePackage['id']),version:String(rulePackage['version']),approved:ruleStatus,superseded:ruleSuperseded,hash:String(rulePackage['content_sha256']),
          coverageThrough:String(rulePackage['coverage_through']),requiredComponents:content['requiredComponents'] as Record<'RESTITUTION'|'COMPLEMENT',readonly IcmsStLegalAccrualRule['component'][]>,rules}:null,formalActs});
      return {result,rulePackageId:rulePackage?String(rulePackage['id']):null};
    });
    const canonicalJson=json(loaded.result),contentSha=sha(canonicalJson),key=sha(json({tenantId,companyId,sourcePackageId:input.sourcePackageId,referenceDate:input.referenceDate,rulePackageId:loaded.rulePackageId,formalActIds:[...input.formalActIds].sort(),contentSha}));
    return comContextoHumano(this.pool.instancia,{tenantId,usuarioId:userId,correlationId},async(client)=>{
      await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`f34/result/${tenantId}/${companyId}/${key}`]);
      const previous=await client.query<StoredResult>('select id,canonical_json,content_sha256,source_package_id,rule_package_id,status from app.tax_st_legal_accrual_result where tenant_id=$1 and empresa_id=$2 and idempotency_sha256=$3',[tenantId,companyId,key]);
      const prior=previous.rows[0];if(prior){if(sha(json(object(prior.canonical_json)))!==prior.content_sha256)throw new ErroDeDominio(CODIGOS_DE_ERRO.ICMS_ST_ACCRUAL_EXPORT_HASH_MISMATCH,'Hash do resultado reproduzido diverge.');
        await client.query(`insert into app.tax_st_legal_accrual_event(tenant_id,empresa_id,result_id,action,actor_id,occurred_at,correlation_id,details) values($1,$2,$3,'REPRODUCED',$4,now(),$5,$6::jsonb)`,[tenantId,companyId,prior.id,userId,correlationId,json({contentSha256:prior.content_sha256})]);
        return {id:prior.id,hash:prior.content_sha256,reused:true,result:prior.canonical_json};}
      await client.query('select id from app.tax_st_history_package where id=$1 and tenant_id=$2 and empresa_id=$3 for share',[input.sourcePackageId,tenantId,companyId]);
      if(loaded.rulePackageId)await client.query('select id from app.tax_st_legal_rule_package where id=$1 and tenant_id=$2 and empresa_id=$3 for share',[loaded.rulePackageId,tenantId,companyId]);
      if(input.formalActIds.length)await client.query('select id from app.tax_st_legal_formal_act where id=any($1::uuid[]) and tenant_id=$2 and empresa_id=$3 for share',[input.formalActIds,tenantId,companyId]);
      const id=randomUUID();const payload={...loaded.result,resultId:id,tenantId,companyId,rulePackageId:loaded.rulePackageId,canonicalJsonHash:contentSha,generatedAtUtc:new Date().toISOString()};
      const finalJson=json(payload),finalSha=sha(finalJson);
      await client.query(`insert into app.tax_st_legal_accrual_result(id,tenant_id,empresa_id,source_package_id,rule_package_id,reference_date,contract_version,idempotency_sha256,canonical_json,content_sha256,status,requested_by,generated_at,correlation_id)
        values($1,$2,$3,$4,$5,$6::date,1,$7,$8::jsonb,$9,$10,$11,now(),$12)`,[id,tenantId,companyId,input.sourcePackageId,loaded.rulePackageId,input.referenceDate,key,finalJson,finalSha,loaded.result.status,userId,correlationId]);
      await client.query(`insert into app.tax_st_legal_accrual_event(tenant_id,empresa_id,result_id,action,actor_id,occurred_at,correlation_id,details) values($1,$2,$3,'CALCULATED',$4,now(),$5,$6::jsonb)`,[tenantId,companyId,id,userId,correlationId,json({contentSha256:finalSha,status:loaded.result.status})]);
      const formalActIds=[...new Set(input.formalActIds)].sort();
      if(formalActIds.length!==input.formalActIds.length)throw this.indeterminado('A lista contém atos formais duplicados.');
      await client.query(`insert into app.tax_st_legal_accrual_event(tenant_id,empresa_id,result_id,action,actor_id,occurred_at,correlation_id,details)
        values($1,$2,$3,'SELECTED',$4,now(),$5,$6::jsonb)`,[tenantId,companyId,id,userId,correlationId,json({sourcePackageId:input.sourcePackageId,rulePackageId:loaded.rulePackageId,formalActIds,referenceDate:input.referenceDate})]);
      const older=await client.query<{id:string}>('select r.id from app.tax_st_legal_accrual_result r where r.tenant_id=$1 and r.empresa_id=$2 and r.source_package_id=$3 and r.id<>$4 and not exists(select 1 from app.tax_st_legal_accrual_event e where e.result_id=r.id and e.action=\'SUPERSEDED\') for update',[tenantId,companyId,input.sourcePackageId,id]);
      for(const previousResult of older.rows)await client.query(`insert into app.tax_st_legal_accrual_event(tenant_id,empresa_id,result_id,action,actor_id,occurred_at,correlation_id,details) values($1,$2,$3,'SUPERSEDED',$4,now(),$5,$6::jsonb)`,[tenantId,companyId,previousResult.id,userId,correlationId,json({supersededBy:id})]);
      return {id,hash:finalSha,reused:false,result:payload};
    });
  }

  async revisarResultado(tenantId:string,userId:string,companyId:string,resultId:string,reason:string,correlationId:string){
    return comContextoHumano(this.pool.instancia,{tenantId,usuarioId:userId,correlationId},async(client)=>{
      const row=await client.query('select id from app.tax_st_legal_accrual_result where id=$1 and tenant_id=$2 and empresa_id=$3 and app.empresa_autorizada(empresa_id)',[resultId,tenantId,companyId]);
      if(!row.rowCount)throw this.naoEncontrado('Resultado F34 não encontrado.');
      const latest=await client.query<{action:string}>('select action from app.tax_st_legal_accrual_event where result_id=$1 order by occurred_at desc,id desc limit 1',[resultId]);
      if(latest.rows[0]?.action==='SUPERSEDED')throw new ErroDeDominio(CODIGOS_DE_ERRO.ICMS_ST_ACCRUAL_RESULT_SUPERSEDED,'Resultado superado não recebe revisão.');
      await client.query(`insert into app.tax_st_legal_accrual_event(tenant_id,empresa_id,result_id,action,actor_id,occurred_at,correlation_id,details) values($1,$2,$3,'REVIEWED',$4,now(),$5,$6::jsonb)`,[tenantId,companyId,resultId,userId,correlationId,json({reason})]);
      return {resultId,reviewed:true};
    });
  }

  async obterResultado(tenantId:string,userId:string,companyId:string,resultId:string,correlationId:string){
    return comContextoHumano(this.pool.instancia,{tenantId,usuarioId:userId,correlationId},async(client)=>{
      const row=await client.query<StoredResult & {superseded:boolean}>(`select r.id,r.canonical_json,r.content_sha256,r.source_package_id,r.rule_package_id,r.status,
        exists(select 1 from app.tax_st_legal_accrual_event e where e.result_id=r.id and e.action='SUPERSEDED') superseded from app.tax_st_legal_accrual_result r
        where r.id=$1 and r.tenant_id=$2 and r.empresa_id=$3 and app.empresa_autorizada(r.empresa_id)`,[resultId,tenantId,companyId]);
      const result=row.rows[0];if(!result)throw this.naoEncontrado('Resultado F34 não encontrado.');
      const data=object(result.canonical_json);if(sha(json(data))!==result.content_sha256)throw new ErroDeDominio(CODIGOS_DE_ERRO.ICMS_ST_ACCRUAL_EXPORT_HASH_MISMATCH,'Hash do resultado divergente.');if(result.superseded)data['status']='SUPERSEDED';
      return {id:result.id,hash:result.content_sha256,result:data};
    });
  }

  async exportar(tenantId:string,userId:string,companyId:string,resultId:string,format:'PDF'|'CSV'|'JSON',correlationId:string){
    const result=await comContextoHumano(this.pool.instancia,{tenantId,usuarioId:userId,correlationId},async(client)=>{
      const row=await client.query<StoredResult & {superseded:boolean}>(`select r.id,r.canonical_json,r.content_sha256,r.source_package_id,r.rule_package_id,r.status,
        exists(select 1 from app.tax_st_legal_accrual_event e where e.result_id=r.id and e.action='SUPERSEDED') superseded from app.tax_st_legal_accrual_result r
        where r.id=$1 and r.tenant_id=$2 and r.empresa_id=$3 and app.empresa_autorizada(r.empresa_id)`,[resultId,tenantId,companyId]);return row.rows[0]??null;});
    if(!result)throw this.naoEncontrado('Resultado F34 não encontrado.');
    const data=object(result.canonical_json);if(sha(json(data))!==result.content_sha256)throw new ErroDeDominio(CODIGOS_DE_ERRO.ICMS_ST_ACCRUAL_EXPORT_HASH_MISMATCH,'Hash do resultado divergente.');if(result.superseded)data['status']='SUPERSEDED';let bytes:Buffer;const contentType=format==='PDF'?'application/pdf':format==='CSV'?'text/csv; charset=utf-8':'application/json';
    if(format==='JSON')bytes=Buffer.from(json(data),'utf8');
    else if(format==='CSV'){const rows=[['trilha','principal_centavos','atualizacao_centavos','juros_centavos','multa_mora_centavos','penalidade_centavos','total_centavos','estado'],...(['restitution','complement'] as const).map(key=>{const track=object(data[key]);return [key,track['principalCents'],track['monetaryUpdateCents'],track['lateInterestCents'],track['latePaymentFineCents'],track['infractionPenaltyCents'],track['totalCents'],data['status']];})];bytes=Buffer.from(rows.map(row=>row.map(value=>`"${String(value??'').replace(/"/gu,'""')}"`).join(';')).join('\r\n'),'utf8');}
    else bytes=renderIcmsStLegalAccrualsPdf(data,result.content_sha256);
    const artifactSha=sha(bytes),storageKey=`${tenantId}/fiscal/icms-st-legal-accruals/${resultId}/${artifactSha}.${format.toLowerCase()}`;await this.storage.enviarComChave(storageKey,bytes,contentType);
    await comContextoHumano(this.pool.instancia,{tenantId,usuarioId:userId,correlationId},async(client)=>client.query(`insert into app.tax_st_legal_accrual_event(tenant_id,empresa_id,result_id,action,actor_id,occurred_at,correlation_id,details) values($1,$2,$3,'EXPORTED',$4,now(),$5,$6::jsonb)`,[tenantId,companyId,resultId,userId,correlationId,json({format,artifactSha256:artifactSha})]));
    return {conteudo:bytes,nome:`icms-st-acrescimos-${resultId}.${format.toLowerCase()}`,contentType,hash:artifactSha};
  }

  private naoEncontrado(message:string){return new ErroDeDominio(CODIGOS_DE_ERRO.ICMS_ST_ACCRUAL_SOURCE_PACKAGE_INELIGIBLE,message);}
  private indeterminado(message:string){return new ErroDeDominio(CODIGOS_DE_ERRO.ICMS_ST_ACCRUAL_COMPONENT_INDETERMINATE,message);}
}
