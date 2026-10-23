import { createHash, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { buildHistoricalIcmsStPackage, type HistoricalIcmsStApprovedReversal, type HistoricalIcmsStLineMemory,
  type HistoricalIcmsStRegime, type HistoricalIcmsStSourceLine, type HistoricalIcmsStSourceSnapshot,
  type HistoricalIcmsStUnresolvedEvidence } from '@contaia/domain';
import { comContextoHumano } from '@contaia/db';
import { CODIGOS_DE_ERRO, ErroDeDominio } from '@contaia/domain';
import { PoolDoBanco } from '../banco/pool.provider';
import { StorageService } from '../comum/storage.service';
import { renderHistoricalIcmsStPdf } from './icms-st-history-pdf';

const CONTRACT_VERSION=1;
const sha=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const cents=(value:string|null):number|null=>{
  if(value===null)return null;
  try{const amount=BigInt(value);return amount>=0n&&amount<=BigInt(Number.MAX_SAFE_INTEGER)?Number(amount):null;}catch{return null;}
};
const object=(value:unknown):Record<string,unknown>=>typeof value==='object'&&value!==null&&!Array.isArray(value)?value as Record<string,unknown>:{};
const text=(value:unknown):string|null=>typeof value==='string'?value:null;
const memory=(value:unknown):HistoricalIcmsStLineMemory|null=>{
  const row=object(value); const ruleId=text(row['ruleId']??row['rule_id']); const formulaVersion=text(row['formulaVersion']??row['formula_version']);
  const inputSha256=text(row['inputSha256']??row['input_sha256']);
  return ruleId&&formulaVersion&&inputSha256?{ruleId,formulaVersion,inputSha256}:null;
};
const json=(value:unknown)=>JSON.stringify(value);
const csvField=(value:unknown)=>`"${String(value??'').replace(/"/gu,'""')}"`;
const csv=(pkg:ReturnType<typeof buildHistoricalIcmsStPackage>)=>[
  ['competencia','tipo_origem','revisao','linha','documento','modelo','chave_acesso','item','codigo_produto','restituicao_centavos','complemento_centavos','regra','versao_formula','hash_memoria','hash_documento','fontes'].map(csvField).join(';'),
  ...pkg.lines.map((line)=>[line.competence,line.sourceKind,line.sourceRevisionId,line.sourceLineId,line.documentId,line.documentModel,line.accessKey,line.itemId,line.productCode,
    line.restitutionPrincipalCents,line.complementPrincipalCents,line.sourceMemory.ruleId,line.sourceMemory.formulaVersion,line.sourceMemory.inputSha256,line.documentSha256,line.sourceIds.join('|')].map(csvField).join(';')),
].join('\r\n');

@Injectable()
export class IcmsStHistoryService {
  constructor(private readonly pool:PoolDoBanco,private readonly storage:StorageService){}

  private async carregar(tenantId:string,userId:string,companyId:string,regime:HistoricalIcmsStRegime,start:string,end:string,correlationId:string){
    return comContextoHumano(this.pool.instancia,{tenantId,usuarioId:userId,correlationId},async(client)=>{
      const company=await client.query<{ regime_tributario:string|null }>('select regime_tributario from app.empresa where id=$1 and tenant_id=$2 and app.empresa_autorizada(id)',[companyId,tenantId]);
      if(!company.rows[0])throw new ErroDeDominio(CODIGOS_DE_ERRO.EMPRESA_NAO_ENCONTRADA,'Empresa não encontrada.');
      const historic=await client.query<{regime:string|null}>('select valor_novo regime from app.empresa_evento_de_historico where empresa_id=$1 and aba=\'DADOS_FISCAIS\' and campo=\'regimeTributario\' and vigencia<=$2::date order by vigencia desc,ocorrido_em desc,sequencia desc limit 1',[companyId,`${start}-01`]);
      const realRegime=historic.rows[0]?.regime??company.rows[0].regime_tributario;
      if(realRegime!==regime)throw new ErroDeDominio(CODIGOS_DE_ERRO.ICMS_ST_HISTORY_REGIME_MISMATCH,'O regime informado não corresponde ao histórico fiscal da empresa.');
      const snapshots=await client.query<Record<string,unknown>>(`select s.id,s.revision,s.competence::text,s.regime,
        case when exists(select 1 from app.tax_st_settlement_event stale where stale.snapshot_id=s.id and stale.action='DOCUMENT_SET_CHANGED') then true else false end stale,
        case when s.facts->>'source'='F32_RETURN' then exists(select 1 from app.tax_st_return_event e where e.id::text=any(array(select jsonb_array_elements_text(s.facts->'eventIds'))) and not exists(select 1 from app.tax_st_return_reversal r where r.event_id=e.id)) else false end possible_outdated,
        (select exists(select 1 from app.tax_st_settlement_snapshot newer where newer.tenant_id=s.tenant_id and newer.empresa_id=s.empresa_id and newer.competence=s.competence and newer.regime=s.regime and newer.revision>s.revision and exists(select 1 from app.tax_st_settlement_review_event nr where nr.snapshot_id=newer.id and nr.action='APPROVED'))) superseded,
        coalesce(s.facts->'eventIds','[]'::jsonb) event_ids,s.gross_restitution_cents::text gross_restitution_cents,s.gross_complement_cents::text gross_complement_cents,
        rev.action review_action FROM app.tax_st_settlement_snapshot s
        LEFT JOIN LATERAL(SELECT action FROM app.tax_st_settlement_review_event WHERE snapshot_id=s.id ORDER BY occurred_at DESC,id DESC LIMIT 1) rev ON true
        WHERE s.tenant_id=$1 AND s.empresa_id=$2 AND s.regime=$3 AND s.competence >= $4::date AND s.competence <= $5::date
          AND coalesce(s.facts->>'source','') <> 'F32_RETURN'
        ORDER BY s.competence,s.revision DESC,s.id`,[tenantId,companyId,regime,`${start}-01`,`${end}-01`]);
      const ids=snapshots.rows.map((row)=>String(row['id']));
      const lines=ids.length?await client.query<Record<string,unknown>>(`select l.id,l.snapshot_id,s.input_sha256 snapshot_input_sha256,l.output_document_id,l.output_item_id,l.difference_kind,l.restitution_cents::text,l.complement_cents::text,
        l.facts,l.calculation,l.recovery_memory,l.source_ids,d.hash_sha256 document_sha256,d.modelo,d.chave_acesso,d.emitido_em::date::text document_date,i.ncm,i.cest,i.cfop
        from app.tax_st_settlement_line l join app.tax_st_settlement_snapshot s on s.id=l.snapshot_id and s.tenant_id=l.tenant_id and s.empresa_id=l.empresa_id
        join app.fiscal_document d on d.id=l.output_document_id and d.tenant_id=l.tenant_id and d.empresa_id=l.empresa_id
        left join app.fiscal_document_item i on i.document_id=d.id and i.empresa_id=d.empresa_id and i.tenant_id=d.tenant_id and i.numero::text=l.output_item_id and i.parser_version=d.parser_version
        where l.tenant_id=$1 and l.empresa_id=$2 and l.snapshot_id=any($3::uuid[]) order by s.competence,l.id`,[tenantId,companyId,ids]):{rows:[]};
      const bySnapshot=new Map<string,HistoricalIcmsStSourceLine[]>();
      for(const row of lines.rows){
        const facts=object(row['facts']),calc=object(row['calculation']);
        const snapshotRow=snapshots.rows.find((item)=>String(item['id'])===String(row['snapshot_id']));
        const documentHash=text(row['document_sha256']);
        const sourceLine:HistoricalIcmsStSourceLine={id:String(row['id']),documentId:String(row['output_document_id']),itemId:String(row['output_item_id']),documentSha256:documentHash??'',documentDate:String(row['document_date']??''),
          documentModel:row['modelo']==='65'?'65':'55',accessKey:String(row['chave_acesso']??''),productCode:text(facts['productCode']??facts['codigoProduto']),
          differenceKind:row['difference_kind'] as HistoricalIcmsStSourceLine['differenceKind'],restitutionCents:cents(row['restitution_cents'] as string|null),complementCents:cents(row['complement_cents'] as string|null),competence:String(snapshotRow?.['competence']??''),
          sourceIds:Array.isArray(row['source_ids'])?row['source_ids'] as string[]:[],memory:memory({ruleId:calc['ruleId'],formulaVersion:calc['formulaVersion'],inputSha256:row['snapshot_input_sha256']}),
          efdRecordCode:text(facts['efdRecordCode']??calc['efdRecordCode'])};
        const snapshotId=String(row['snapshot_id']);bySnapshot.set(snapshotId,[...(bySnapshot.get(snapshotId)??[]),sourceLine]);
      }
      const sourceSnapshots:HistoricalIcmsStSourceSnapshot[]=snapshots.rows.map((row)=>{
        return {id:String(row['id']),revision:Number(row['revision']),competence:String(row['competence']),regime,status:row['review_action']==='APPROVED'?'APPROVED':row['review_action']==='REJECTED'?'REJECTED':'PENDING_REVIEW',
          stale:Boolean(row['stale']),superseded:Boolean(row['superseded']),possibleOutdated:Boolean(row['possible_outdated']),grossRestitutionCents:cents(row['gross_restitution_cents'] as string|null),grossComplementCents:cents(row['gross_complement_cents'] as string|null),lines:bySnapshot.get(String(row['id']))??[]};
      });
      const reversalsQuery=await client.query<Record<string,unknown>>(`select r.id,r.event_id,r.original_snapshot_id,r.original_line_id,r.competence::text,r.reversed_restitution_cents::text,r.reversed_complement_cents::text,
        r.source_ids,r.formula_version,e.event_date::text,e.evidence_sha256,e.evidence_facts,coalesce(review.action='APPROVED',false) review_approved,
        c.id c002_snapshot_id,c.input_sha256 c002_input_sha256,coalesce(crev.action='APPROVED',false) c002_approved,
        exists(select 1 from app.tax_st_settlement_event ce where ce.snapshot_id=c.id and ce.action='DOCUMENT_SET_CHANGED') c002_stale,
        (orig.id is not null and orig.regime=$5 and oreview.action='APPROVED' and origline.id is not null and
          not exists(select 1 from app.tax_st_settlement_event oe where oe.snapshot_id=orig.id and oe.action='DOCUMENT_SET_CHANGED') and
          not exists(select 1 from app.tax_st_settlement_snapshot newer where newer.tenant_id=orig.tenant_id and newer.empresa_id=orig.empresa_id and newer.competence=orig.competence and newer.regime=orig.regime and newer.revision>orig.revision and exists(select 1 from app.tax_st_settlement_review_event nr where nr.snapshot_id=newer.id and nr.action='APPROVED'))) original_line_verified
        from app.tax_st_return_reversal r join app.tax_st_return_event e on e.id=r.event_id and e.tenant_id=r.tenant_id and e.empresa_id=r.empresa_id
        left join lateral(select action from app.tax_st_return_review_event where return_event_id=e.id order by occurred_at desc,id desc limit 1) review on true
        left join app.tax_st_settlement_snapshot orig on orig.id=r.original_snapshot_id and orig.tenant_id=r.tenant_id and orig.empresa_id=r.empresa_id
        left join app.tax_st_settlement_line origline on origline.snapshot_id=orig.id and origline.id=r.original_line_id and origline.tenant_id=r.tenant_id and origline.empresa_id=r.empresa_id
        left join lateral(select action from app.tax_st_settlement_review_event where snapshot_id=orig.id order by occurred_at desc,id desc limit 1) oreview on true
        left join lateral(select snap.id,snap.input_sha256,(select action from app.tax_st_settlement_review_event where snapshot_id=snap.id order by occurred_at desc,id desc limit 1) action
          from app.tax_st_settlement_snapshot snap where snap.tenant_id=r.tenant_id and snap.empresa_id=r.empresa_id and snap.facts->>'source'='F32_RETURN' and snap.facts->'eventIds' @> jsonb_build_array(e.id::text) order by snap.revision desc limit 1)c on true
        left join lateral(select action from app.tax_st_settlement_review_event where snapshot_id=c.id order by occurred_at desc,id desc limit 1) crev on true
        where r.tenant_id=$1 and r.empresa_id=$2 and r.competence between $3::date and $4::date order by r.competence,r.id`,[tenantId,companyId,`${start}-01`,`${end}-01`,regime]);
      const reversals:HistoricalIcmsStApprovedReversal[]=reversalsQuery.rows.map((row)=>{
        const facts=object(row['evidence_facts']);return {id:String(row['event_id']),competence:String(row['competence']),originalLineId:String(row['original_line_id']),eventDate:String(row['event_date']),
          reversedRestitutionCents:cents(row['reversed_restitution_cents'] as string|null)??0,reversedComplementCents:cents(row['reversed_complement_cents'] as string|null)??0,evidenceSha256:String(row['evidence_sha256']),
          c002SnapshotId:String(row['c002_snapshot_id']??''),sourceIds:Array.isArray(row['source_ids'])?row['source_ids'] as string[]:[],reviewApproved:Boolean(row['review_approved']),c002SnapshotApproved:Boolean(row['c002_approved']),
          originalSnapshotId:String(row['original_snapshot_id']),originalLineVerified:Boolean(row['original_line_verified']),c002SnapshotStale:Boolean(row['c002_stale']),
          memory:memory({ruleId:facts['ruleId']??row['formula_version'],formulaVersion:facts['formulaVersion']??row['formula_version'],inputSha256:facts['inputSha256']??facts['input_sha256']??row['c002_input_sha256']})};
      });
      const unresolvedRows=await client.query<Record<string,unknown>>(`select e.id,e.event_date::text competence,'UNREVIEWED_RETURN' source_kind
        from app.tax_st_return_event e left join lateral(select action from app.tax_st_return_review_event where return_event_id=e.id order by occurred_at desc,id desc limit 1) r on true
        where e.tenant_id=$1 and e.empresa_id=$2 and e.event_date >= $3::date and e.event_date < ($4::date+interval '1 month') and r.action is distinct from 'APPROVED'
        union all select c.source_event_id,c.output_competence::text,'AUTHORIZED_CANCELLATION' from app.tax_st_authorized_cancellation c
        where c.tenant_id=$1 and c.empresa_id=$2 and c.output_competence between $3::date and $4::date
        union all select e.id,s.competence::text,'DOCUMENT_SET_CHANGED' from app.tax_st_settlement_event e join app.tax_st_settlement_snapshot s on s.id=e.snapshot_id and s.tenant_id=e.tenant_id and s.empresa_id=e.empresa_id
        where e.tenant_id=$1 and e.empresa_id=$2 and e.action='DOCUMENT_SET_CHANGED' and s.competence between $3::date and $4::date`,[tenantId,companyId,`${start}-01`,`${end}-01`]);
      const unresolved:HistoricalIcmsStUnresolvedEvidence[]=unresolvedRows.rows.map((row)=>({id:String(row['id']),competence:String(row['competence']),sourceKind:row['source_kind'] as HistoricalIcmsStUnresolvedEvidence['sourceKind']}));
      return {company,sourceSnapshots,reversals,unresolved};
    });
  }

  async gerar(tenantId:string,userId:string,companyId:string,regime:HistoricalIcmsStRegime,start:string,end:string,correlationId:string){
    const loaded=await this.carregar(tenantId,userId,companyId,regime,start,end,correlationId);
    if(!loaded) return null;
    if('invalidRegime' in loaded)return {invalidRegime:true};
    const pkg=buildHistoricalIcmsStPackage({companyId,regime,periodStart:start,periodEnd:end,snapshots:loaded.sourceSnapshots,reversals:loaded.reversals,unresolvedEvidence:loaded.unresolved});
    const selection={tenantId,companyId,regime,start,end,contractVersion:CONTRACT_VERSION,sourceRevisionIds:pkg.sourceRevisionIds,
      excludedCompetences:pkg.excludedCompetences,lines:pkg.lines,unresolvedEvidence:pkg.unresolvedEvidence};
    const selectionSha=sha(json(selection));
    return comContextoHumano(this.pool.instancia,{tenantId,usuarioId:userId,correlationId},async(client)=>{
      await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`${tenantId}/${companyId}/${regime}/${start}/${end}/${CONTRACT_VERSION}`]);
      const previous=await client.query<{id:string;content_sha256:string;canonical_json:unknown}>('select id,content_sha256,canonical_json from app.tax_st_history_package where tenant_id=$1 and empresa_id=$2 and regime=$3 and period_start=$4 and period_end=$5 and contract_version=$6 and selection_sha256=$7',[tenantId,companyId,regime,`${start}-01`,`${end}-01`,CONTRACT_VERSION,selectionSha]);
      if(previous.rows[0]){
        await client.query(`insert into app.tax_st_history_package_event(tenant_id,empresa_id,package_id,action,actor_id,occurred_at,correlation_id,details) values($1,$2,$3,'REPRODUCED',$4,now(),$5,$6::jsonb)`,
          [tenantId,companyId,previous.rows[0].id,userId,correlationId,json({contentSha256:previous.rows[0].content_sha256})]);
        return {id:previous.rows[0].id,hash:previous.rows[0].content_sha256,package:previous.rows[0].canonical_json,reused:true};
      }
      const sourceRevisionIds=pkg.sourceRevisionIds;
      const payload={contractVersion:CONTRACT_VERSION,generatedAt:this.nowIso(),generatedBy:userId,tenantId,empresaId:companyId,selectionSha256:selectionSha,...JSON.parse(pkg.canonicalJson) as object};
      const id=randomUUID();
      const canonicalJson=json({...payload,packageId:id}),contentSha=sha(canonicalJson);
      const packageJson={...payload,packageId:id,contentSha256:contentSha};
      const storedCanonical=json(packageJson);
      await client.query(`insert into app.tax_st_history_package(id,tenant_id,empresa_id,regime,period_start,period_end,contract_version,selection_sha256,content_sha256,status,source_revision_ids,excluded_competences,canonical_json,requested_by,generated_at,correlation_id)
        values($1,$2,$3,$4,$5::date,$6::date,$7,$8,$9,$10,$11::uuid[],$12::jsonb,$13::jsonb,$14,$15::timestamptz,$16)`,
        [id,tenantId,companyId,regime,`${start}-01`,`${end}-01`,CONTRACT_VERSION,selectionSha,contentSha,pkg.status,sourceRevisionIds,JSON.stringify(pkg.excludedCompetences),storedCanonical,userId,payload.generatedAt,correlationId]);
      for(const line of pkg.lines){
        await client.query(`insert into app.tax_st_history_package_line(tenant_id,empresa_id,package_id,source_kind,source_revision_id,source_line_id,competence,event_date,document_id,item_id,document_model,access_key,product_code,source_ids,rule_id,formula_version,memory_sha256,document_sha256,restitution_principal_cents,complement_principal_cents,efd_record_code,facts)
          values($1,$2,$3,$4,$5,$6,$7::date,$8::date,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22::jsonb)`,
          [tenantId,companyId,id,line.sourceKind,line.sourceKind==='APPROVED_SETTLEMENT'?line.sourceRevisionId:line.sourceRevisionId,line.sourceLineId,`${line.competence}-01`,line.eventDate,line.documentId,line.itemId,line.documentModel,line.accessKey,line.productCode,line.sourceIds,
            line.sourceMemory.ruleId,line.sourceMemory.formulaVersion,line.sourceMemory.inputSha256,line.documentSha256,line.restitutionPrincipalCents,line.complementPrincipalCents,line.efdRecordCode,json({sourceIds:line.sourceIds})]);
      }
      await client.query(`insert into app.tax_st_history_package_event(tenant_id,empresa_id,package_id,action,actor_id,occurred_at,correlation_id,details) values($1,$2,$3,'SELECTED',$4,$5,$6,$7::jsonb),($1,$2,$3,'GENERATED',$4,$5,$6,$8::jsonb)`,
        [tenantId,companyId,id,userId,payload.generatedAt,correlationId,json({selectionSha256:selectionSha,sourceCount:pkg.sourceRevisionIds.length}),json({contentSha256:contentSha,status:pkg.status,lineCount:pkg.lines.length})]);
      const superseded=await client.query<{id:string}>('select id from app.tax_st_history_package where tenant_id=$1 and empresa_id=$2 and regime=$3 and period_start=$4::date and period_end=$5::date and contract_version=$6 and id<>$7',[tenantId,companyId,regime,`${start}-01`,`${end}-01`,CONTRACT_VERSION,id]);
      for(const old of superseded.rows)await client.query(`insert into app.tax_st_history_package_event(tenant_id,empresa_id,package_id,action,actor_id,occurred_at,correlation_id,details) values($1,$2,$3,'SUPERSEDED',$4,$5,$6,$7::jsonb)`,
        [tenantId,companyId,old.id,userId,payload.generatedAt,correlationId,json({supersededBy:id,selectionSha256:selectionSha})]);
      return {id,hash:contentSha,package:packageJson,reused:false};
    });
  }

  private nowIso(){return new Date().toISOString();}

  async baixar(tenantId:string,userId:string,companyId:string,packageId:string,format:'PDF'|'CSV'|'JSON',correlationId:string){
    const record=await comContextoHumano(this.pool.instancia,{tenantId,usuarioId:userId,correlationId},async(client)=>{
      const result=await client.query<{canonical_json:unknown;content_sha256:string;regime:HistoricalIcmsStRegime;period_start:string;period_end:string}>('select canonical_json,content_sha256,regime,period_start::text,period_end::text from app.tax_st_history_package where id=$1 and tenant_id=$2 and empresa_id=$3 and app.empresa_autorizada(empresa_id)',[packageId,tenantId,companyId]);
      return result.rows[0]??null;
    });
    if(!record)throw new ErroDeDominio(CODIGOS_DE_ERRO.ICMS_ST_HISTORY_PACKAGE_NOT_FOUND,'Pacote histórico não encontrado.');
    const pkgData=object(record.canonical_json);const lines=Array.isArray(pkgData['lines'])?pkgData['lines']:[];
    const minimal={companyId:companyId,regime:record.regime,periodStart:record.period_start.slice(0,7),periodEnd:record.period_end.slice(0,7),grossRestitutionCents:Number(pkgData['grossRestitutionCents']??0),grossComplementCents:Number(pkgData['grossComplementCents']??0),reversedRestitutionCents:Number(pkgData['reversedRestitutionCents']??0),reversedComplementCents:Number(pkgData['reversedComplementCents']??0),netPrincipalBalanceCents:Number(pkgData['netPrincipalBalanceCents']??0),status:pkgData['status'],lines,excludedCompetences:Array.isArray(pkgData['excludedCompetences'])?pkgData['excludedCompetences']:[]} as unknown as ReturnType<typeof buildHistoricalIcmsStPackage>;
    const bytes=format==='JSON'?Buffer.from(json(pkgData),'utf8'):format==='CSV'?Buffer.from(csv(minimal),'utf8'):renderHistoricalIcmsStPdf(minimal,record.content_sha256);
    const hash=sha(bytes),key=`${tenantId}/fiscal/icms-st-history/${packageId}/${hash}.${format.toLowerCase()}`;
    await this.storage.enviarComChave(key,bytes,format==='PDF'?'application/pdf':format==='CSV'?'text/csv; charset=utf-8':'application/json');
    await comContextoHumano(this.pool.instancia,{tenantId,usuarioId:userId,correlationId},async(client)=>{
      await client.query(`insert into app.tax_st_history_package_event(tenant_id,empresa_id,package_id,action,actor_id,occurred_at,correlation_id,details) values($1,$2,$3,'DOWNLOADED',$4,now(),$5,$6::jsonb)`,[tenantId,companyId,packageId,userId,correlationId,json({format,artifactSha256:hash})]);
    });
    return {conteudo:bytes,nome:`icms-st-historico-${packageId}.${format.toLowerCase()}`,contentType:format==='PDF'?'application/pdf':format==='CSV'?'text/csv; charset=utf-8':'application/json',hash};
  }
}
