import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { Injectable } from '@nestjs/common';
import { comContextoHumano, getDfeCaptureCompany, listarHistoricoRegimeTributario } from '@contaia/db';
import {
  CODIGOS_DE_ERRO,
  ErroDeConflito,
  ErroDeDominio,
  decimalDeclaradoParaCentavos,
  calculateIcmsStReturnReversal,
  renderIcmsStC002,
  resolveIcmsStSettlement,
  type IcmsStInputEntry,
  type IcmsStOutputLine,
  type IcmsStSettlementRule,
} from '@contaia/domain';
import { CuratedTaxPackageSchema } from '@contaia/shared';

import { PoolDoBanco } from '../banco/pool.provider';
import { noCatalogoTributario } from '../tax-rules/catalogo-contexto';
import { StorageService, type ArquivoRecebido } from '../comum/storage.service';

type PackageRow = Readonly<{ id: string; content: unknown; content_sha256: string }>;
type OutputRow = Readonly<{
  document_id: string; access_key: string; document_state: string; model: string; protocol: string | null; fact_date: string | null;
  destination_indicator: string | null; final_consumer_indicator: string | null;
  destination_identifier: string | null;
  seller_uf: string | null; destination_uf: string | null; final_consumer: boolean | null;
  item_number: number; gtin: string | null; ncm: string | null; cest: string | null; cfop: string | null; cst_csosn: string | null;
  unit: string | null; quantity: string | null; value: string | null; freight: string | null; insurance: string | null;
  other_expenses: string | null; discount: string | null; canceled_before_processing: boolean; post_sale_event_state: boolean | null;
  has_document_conflict: boolean;
}>;
type EntryRow = Readonly<{
  document_id: string; protocol: string | null; document_state: string; fact_date: string | null; has_document_conflict: boolean;
  item_number: number; gtin: string | null; unit: string | null; quantity: string | null;
  input_icms: string | null; input_icms_st: string | null; presumed_base: string | null;
}>;

const toQuantityScaled = (value: string | null): bigint | null => {
  if (value === null || !/^\d+(?:\.\d{1,10})?$/u.test(value)) return null;
  const [integer, fraction = ''] = value.split('.');
  if (integer === undefined) return null;
  try { return BigInt(integer) * 10_000_000_000n + BigInt(fraction.padEnd(10, '0')); }
  catch { return null; }
};
const jsonText = (value: unknown): string => JSON.stringify(value, (_key, child: unknown) => typeof child === 'bigint' ? child.toString() : child);
const motivosDeBloqueio = (facts: unknown): readonly unknown[] => {
  if (typeof facts !== 'object' || facts === null || !('blockingReasonCodes' in facts)) return [];
  const reasons = (facts as { blockingReasonCodes?: unknown }).blockingReasonCodes;
  return Array.isArray(reasons) ? reasons : [];
};
const centavosSeguros = (value:string|null):number|null => {
  if(value===null)return null;
  try { const integer=BigInt(value); return integer>=0n&&integer<=BigInt(Number.MAX_SAFE_INTEGER)?Number(integer):null; }
  catch { return null; }
};

const itemBaseCents = (row: OutputRow): number | null => {
  const values = [row.value, row.discount ?? '0'];
  const parsed = values.map(decimalDeclaradoParaCentavos);
  const [value, discount] = parsed;
  if (value === undefined || discount === undefined || value === null || discount === null) return null;
  const base = BigInt(value) - BigInt(discount);
  return base < 0n || base > BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(base);
};

const packageRules = (rows: readonly PackageRow[], date: string, regime: string | null) => {
  const packages = rows.flatMap((row) => {
    const parsed = CuratedTaxPackageSchema.safeParse(row.content);
    if (!parsed.success) return [];
    const content = parsed.data;
    if (content.jurisdiction !== 'GO' || content.validFrom > date || content.validUntil !== null && content.validUntil < date ||
        regime === null || !content.regimes.includes(regime as 'SIMPLES_NACIONAL' | 'LUCRO_PRESUMIDO')) return [];
    const rules = (content.icmsStSettlementRules ?? []) as readonly IcmsStSettlementRule[];
    if (rules.length === 0) return [];
    return [{ id: row.id, hash: row.content_sha256, rules }];
  });
  return packages;
};

@Injectable()
export class IcmsStSettlementsService {
  agora: () => Date = () => new Date();
  constructor(private readonly pool: PoolDoBanco, private readonly storage: StorageService) {}

  async registerManualReturn(tenantId: string, userId: string, companyId: string, input: Readonly<{
    originalSnapshotId: string; originalLineId: string; returnDocumentIdentity: string; returnItemIdentity: string;
    eventDate: string; unit: string; returnedQuantityScaled: string; returnedQuantity:string; returnDocumentNumber:string; returnAccessKey:string;
    returnModel:'55'|'65';returnSeries:string;returnCfop:string;ncm:string|null;productCode:string;productDescription:string;
    unitPrice:string;total:string;efdDate:string|null;idempotencyKey: string;
  }>, file: ArquivoRecebido, correlationId: string) {
    if (file.conteudo.byteLength < 1 || file.conteudo.byteLength > 10 * 1024 * 1024 ||
        !['application/pdf','application/xml','text/xml','image/jpeg','image/png'].includes(file.tipoConteudo)) {
      throw new ErroDeDominio(CODIGOS_DE_ERRO.ICMS_ST_EVENT_EVIDENCE_INVALID, 'Anexe PDF, XML, PNG ou JPEG de até 10 MB.');
    }
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(input.eventDate) || Number.isNaN(Date.parse(`${input.eventDate}T00:00:00Z`)) ||
        new Date(`${input.eventDate}T00:00:00Z`).toISOString().slice(0,10)!==input.eventDate ||
        !/^\d+$/u.test(input.returnedQuantityScaled) || BigInt(input.returnedQuantityScaled) <= 0n ||
        toQuantityScaled(input.returnedQuantity.replace(',', '.'))?.toString()!==input.returnedQuantityScaled ||
        !/^\d{1,20}$/u.test(input.returnDocumentNumber)||!/^[0-9]{44}$/u.test(input.returnAccessKey)||input.returnDocumentIdentity!==input.returnAccessKey||
        !/^[1-9]\d{0,2}$/u.test(input.returnItemIdentity)||!/^\d{4}$/u.test(input.returnCfop)||
        (input.ncm!==null&&!/^\d{8}$/u.test(input.ncm))||
        !/^[0-9a-f]{8}-[0-9a-f-]{27}$/iu.test(input.idempotencyKey)) {
      throw new ErroDeDominio(CODIGOS_DE_ERRO.ICMS_ST_EVENT_EVIDENCE_INVALID, 'Dados de devolução inválidos.');
    }
    const fileSha256 = createHash('sha256').update(file.conteudo).digest('hex');
    const sha256 = createHash('sha256').update(jsonText({fileSha256,returnDocumentIdentity:input.returnDocumentIdentity,returnItemIdentity:input.returnItemIdentity,
      eventDate:input.eventDate,unit:input.unit,returnedQuantityScaled:input.returnedQuantityScaled,returnDocumentNumber:input.returnDocumentNumber,
      returnAccessKey:input.returnAccessKey,returnModel:input.returnModel,returnSeries:input.returnSeries,returnCfop:input.returnCfop,ncm:input.ncm,
      productCode:input.productCode,productDescription:input.productDescription,unitPrice:input.unitPrice,total:input.total,efdDate:input.efdDate})).digest('hex');
    const storageKey = `${tenantId}/icms_st_return/${fileSha256}`;
    return comContextoHumano(this.pool.instancia, { tenantId, usuarioId: userId, correlationId }, async (client) => {
        const submitter=await client.query<{allowed:boolean}>(`select exists(select 1 from app.usuario u join app.usuario_papel p on p.usuario_id=u.id and p.tenant_id=u.tenant_id
          where u.id=$1 and u.tenant_id=$2 and u.estado='ATIVO' and p.removido_em is null and p.papel in ('admin_escritorio','contador','auxiliar')) allowed`,[userId,tenantId]);
        if(submitter.rows[0]?.allowed!==true)throw new ErroDeDominio(CODIGOS_DE_ERRO.SEM_AUTORIZACAO,'Papel sem autorização para submeter evidência de devolução.');
        await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [`icms-st-return:${tenantId}:${companyId}:${input.originalLineId}`]);
        await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [`icms-st-return-identity:${tenantId}:${companyId}:${input.returnDocumentIdentity}:${input.returnItemIdentity}:${input.eventDate}`]);
        const previous=await client.query<{id:string;evidence_sha256:string;competence:string|null;returned_quantity_scaled:string|null;remaining_quantity_scaled:string|null;reversed_restitution_cents:string|null;reversed_complement_cents:string|null;original_line_id:string;normalized_unit:string;requested_quantity:string;origin:string;return_document_identity:string;return_item_identity:string;event_date:string;review_action:string|null}>(
          `select e.id,e.evidence_sha256,to_char(r.competence,'YYYY-MM-DD') competence,r.returned_quantity_scaled::text,
                  r.remaining_quantity_scaled::text,r.reversed_restitution_cents::text,r.reversed_complement_cents::text
                  ,e.original_line_id,e.normalized_unit,e.returned_quantity_scaled::text requested_quantity,e.origin,
                  e.return_document_identity,e.return_item_identity,to_char(e.event_date,'YYYY-MM-DD') event_date,review.action review_action
             from app.tax_st_return_event e left join app.tax_st_return_reversal r on r.event_id=e.id
             left join lateral(select action from app.tax_st_return_review_event where return_event_id=e.id order by occurred_at desc,id desc limit 1) review on true
            where e.tenant_id=$1 and e.empresa_id=$2 and (e.idempotency_key=$3 or
              (e.origin='MANUAL_DOCUMENT' and e.return_document_identity=$4 and e.return_item_identity=$5 and e.event_date=$6::date))`,
          [tenantId,companyId,input.idempotencyKey,input.returnDocumentIdentity,input.returnItemIdentity,input.eventDate]);
        const priorEvent=previous.rows[0];
        if(priorEvent){
          if(priorEvent.origin!=='MANUAL_DOCUMENT'||priorEvent.evidence_sha256!==sha256||priorEvent.original_line_id!==input.originalLineId||
             priorEvent.normalized_unit!==input.unit||priorEvent.requested_quantity!==input.returnedQuantityScaled||
             priorEvent.return_document_identity!==input.returnDocumentIdentity||priorEvent.return_item_identity!==input.returnItemIdentity||priorEvent.event_date!==input.eventDate)
            throw new ErroDeConflito(CODIGOS_DE_ERRO.CONFLITO_DE_VERSAO,'Identidade do evento reutilizada com conteúdo divergente.');
          return {id:priorEvent.id,status:priorEvent.review_action??'SUBMITTED',competence:priorEvent.competence,
            returnedQuantityScaled:priorEvent.returned_quantity_scaled,remainingQuantityScaled:priorEvent.remaining_quantity_scaled,
            reversedRestitutionCents:priorEvent.reversed_restitution_cents===null?null:Number(priorEvent.reversed_restitution_cents),
            reversedComplementCents:priorEvent.reversed_complement_cents===null?null:Number(priorEvent.reversed_complement_cents),evidenceSha256:priorEvent.evidence_sha256,reused:true};
        }
        const original = await client.query<{ kind:string; restitution:string|null; complement:string|null; facts:unknown; calculation:unknown; unit:string|null; source_ids:string[]; snapshot_id:string; revision:number; approved:boolean; stale:boolean; document_number:string|null; access_key:string|null; fact_date:string|null }>(
          `select l.difference_kind kind,l.restitution_cents::text restitution,l.complement_cents::text complement,l.facts,l.calculation,l.source_ids,
                  l.facts->>'unit' unit,l.snapshot_id,s.revision,d.numero_documento::text document_number,d.chave_acesso access_key,to_char(d.emitido_em,'YYYY-MM-DD') fact_date,
                  exists(select 1 from app.tax_st_settlement_review_event r where r.snapshot_id=s.id and r.action='APPROVED') approved,
                  exists(select 1 from app.tax_st_settlement_event e where e.snapshot_id=s.id and e.action='DOCUMENT_SET_CHANGED') stale
             from app.tax_st_settlement_line l join app.tax_st_settlement_snapshot s on s.id=l.snapshot_id
             join app.fiscal_document d on d.id=l.output_document_id and d.tenant_id=l.tenant_id and d.empresa_id=l.empresa_id
            where l.tenant_id=$1 and l.empresa_id=$2 and l.snapshot_id=$3 and l.id=$4`,
          [tenantId,companyId,input.originalSnapshotId,input.originalLineId]);
        const line=original.rows[0];
        if (!line) throw new ErroDeDominio(CODIGOS_DE_ERRO.ICMS_ST_EVENT_LINK_NOT_FOUND,'Linha original não encontrada.');
        if (!line.approved || line.stale) throw new ErroDeDominio(CODIGOS_DE_ERRO.ICMS_ST_REVISION_STALE,'Revisão original sem aprovação vigente.');
        if (line.unit !== input.unit) throw new ErroDeDominio(CODIGOS_DE_ERRO.ICMS_ST_RETURN_UNIT_INCOMPATIBLE,'Unidade da devolução difere da saída original.');
        const facts=typeof line.facts==='object'&&line.facts!==null?line.facts as Record<string,unknown>:{};
        const calculation=typeof line.calculation==='object'&&line.calculation!==null?line.calculation as Record<string,unknown>:{};
        const formulaVersion=typeof calculation['formulaVersion']==='string'?calculation['formulaVersion']:'';
        const sourceFactDate=typeof facts['factDate']==='string'?facts['factDate']:'';
        if(!/^\d{4}-\d{2}-\d{2}$/u.test(sourceFactDate)||input.eventDate<sourceFactDate||typeof facts['quantityScaled']!=='string'||!/^\d{1,38}$/u.test(facts['quantityScaled'])||formulaVersion.length===0)
          throw new ErroDeDominio(CODIGOS_DE_ERRO.ICMS_ST_ORIGINAL_CALCULATION_UNAVAILABLE,'Memória original sem data, quantidade ou versão de fórmula verificável.');
        const total=BigInt(facts['quantityScaled']);
        const restitution=centavosSeguros(line.restitution);
        const complement=centavosSeguros(line.complement);
        const prior=await client.query<{quantity:string}>(`select coalesce(sum(returned_quantity_scaled),0)::text quantity from app.tax_st_return_reversal
          where tenant_id=$1 and empresa_id=$2 and original_line_id=$3`,[tenantId,companyId,input.originalLineId]);
        const result=calculateIcmsStReturnReversal({differenceKind:line.kind as 'RESTITUTION'|'COMPLEMENT'|'NONE'|'INDETERMINATE',
          originalQuantityScaled:total,previouslyReturnedQuantityScaled:BigInt(prior.rows[0]?.quantity??'0'),returnedQuantityScaled:BigInt(input.returnedQuantityScaled),
          originalRestitutionCents:restitution,originalComplementCents:complement});
        if (!result.ok) throw new ErroDeDominio(result.reasonCode==='ICMS_ST_RETURN_QUANTITY_EXCEEDED'?CODIGOS_DE_ERRO.ICMS_ST_RETURN_QUANTITY_EXCEEDED:CODIGOS_DE_ERRO.ICMS_ST_ORIGINAL_CALCULATION_UNAVAILABLE,'Quantidade excede saldo ou cálculo original indisponível.');
        const competence=`${input.eventDate.slice(0,7)}-01`;
        const originalNumber=line.document_number;
        const originalAccessKey=line.access_key;
        const originalDate=line.fact_date;
        if(originalNumber===null||originalAccessKey===null||originalDate===null)
          throw new ErroDeDominio(CODIGOS_DE_ERRO.ICMS_ST_ORIGINAL_CALCULATION_UNAVAILABLE,'Documento original sem campos obrigatórios para o registro C002.');
        await this.storage.enviarComChave(storageKey,file.conteudo,file.tipoConteudo);
        const inserted=await client.query<{id:string}>(`insert into app.tax_st_return_event(tenant_id,empresa_id,original_snapshot_id,original_line_id,origin,
          return_document_identity,return_item_identity,event_date,idempotency_key,normalized_unit,returned_quantity_scaled,evidence_sha256,evidence_facts,actor_id,correlation_id,occurred_at)
          values($1,$2,$3,$4,'MANUAL_DOCUMENT',$5,$6,$7::date,$8::uuid,$9,$10::numeric,$11,$12::jsonb,$13,$14,$15)
          on conflict(tenant_id,empresa_id,origin,return_document_identity,return_item_identity,event_date) do nothing returning id`,
          [tenantId,companyId,input.originalSnapshotId,input.originalLineId,input.returnDocumentIdentity,input.returnItemIdentity,input.eventDate,input.idempotencyKey,input.unit,
           input.returnedQuantityScaled,sha256,jsonText({storageKey,fileSha256,mimeType:file.tipoConteudo,formulaVersion,originalQuantityScaled:total.toString(),
             originalRestitutionCents:restitution,originalComplementCents:complement,differenceKind:line.kind,sourceIds:[input.originalLineId,...line.source_ids],
             returnDocumentNumber:input.returnDocumentNumber,returnAccessKey:input.returnAccessKey,returnModel:input.returnModel,returnSeries:input.returnSeries,
             returnCfop:input.returnCfop,ncm:input.ncm,productCode:input.productCode,productDescription:input.productDescription,
             returnedQuantity:input.returnedQuantity.replace(',', '.'),unitPrice:input.unitPrice.replace(',', '.'),total:input.total.replace(',', '.'),efdDate:input.efdDate,
             originalDocumentNumber:originalNumber,originalAccessKey,originalDate}),userId,correlationId,this.agora()]);
        const eventId=inserted.rows[0]?.id;
        if (!eventId) throw new ErroDeConflito(CODIGOS_DE_ERRO.CONFLITO_DE_VERSAO,'Evento fiscal já registrado com esta identidade.');
        await client.query('select app.tax_st_return_review($1::uuid,$2::uuid,$3::uuid,$4::timestamptz,$5::text,$6::text,$7::text)',
          [eventId,companyId,userId,this.agora(),'SUBMITTED',null,correlationId]);
        await client.query('select app.tax_st_settlement_mark_return_stale($1::uuid,$2::date,$3::uuid,$4::text,$5::uuid,$6::timestamptz)',
          [companyId,competence,userId,correlationId,eventId,this.agora()]);
        return {id:eventId,status:'SUBMITTED',competence,returnedQuantityScaled:input.returnedQuantityScaled,
          remainingQuantityScaled:result.remainingQuantityScaled.toString(),reversedRestitutionCents:null,reversedComplementCents:null,evidenceSha256:sha256};
    });
  }

  async reviewManualReturn(tenantId:string,userId:string,companyId:string,eventId:string,action:'APPROVED'|'REJECTED',reason:string|null,correlationId:string) {
    return comContextoHumano(this.pool.instancia,{tenantId,usuarioId:userId,correlationId},async(client)=>{
      await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`icms-st-return-review:${tenantId}:${companyId}:${eventId}`]);
      const selected=await client.query<{original_snapshot_id:string;original_line_id:string;return_item_identity:string;event_date:string;returned_quantity_scaled:string;normalized_unit:string;evidence_facts:unknown}>(
        `select original_snapshot_id,original_line_id,return_item_identity,to_char(event_date,'YYYY-MM-DD') event_date,returned_quantity_scaled::text,normalized_unit,evidence_facts
           from app.tax_st_return_event where id=$1 and tenant_id=$2 and empresa_id=$3`,[eventId,tenantId,companyId]);
      const event=selected.rows[0];
      if(!event)throw new ErroDeDominio(CODIGOS_DE_ERRO.ICMS_ST_EVENT_LINK_NOT_FOUND,'Devolução não encontrada.');
      if(action==='REJECTED'&&(reason===null||reason.trim().length<10))throw new ErroDeDominio(CODIGOS_DE_ERRO.ICMS_ST_EVENT_EVIDENCE_INVALID,'Rejeição exige motivo com ao menos 10 caracteres.');
      if(action==='REJECTED'){
        try {
          await client.query('select app.tax_st_return_review($1::uuid,$2::uuid,$3::uuid,$4::timestamptz,$5::text,$6::text,$7::text)',
            [eventId,companyId,userId,this.agora(),action,reason,correlationId]);
        } catch(error) {
          const message=error instanceof Error?error.message:'';
          if(message.includes('ICMS_ST_RETURN_REVIEW_FORBIDDEN'))throw new ErroDeDominio(CODIGOS_DE_ERRO.SEM_AUTORIZACAO,'Somente contador/admin pode decidir a devolução.');
          if(message.includes('ICMS_ST_RETURN_REVIEW_CONFLICT'))throw new ErroDeConflito(CODIGOS_DE_ERRO.CONFLITO_DE_VERSAO,'Devolução já decidida ou revisão superada.');
          if(message.includes('ICMS_ST_RETURN_NOT_FOUND'))throw new ErroDeDominio(CODIGOS_DE_ERRO.ICMS_ST_EVENT_LINK_NOT_FOUND,'Devolução não encontrada.');
          throw error;
        }
        return {eventId,action};
      }
      const facts=typeof event.evidence_facts==='object'&&event.evidence_facts!==null?event.evidence_facts as Record<string,unknown>:{};
      const total=typeof facts['originalQuantityScaled']==='string'?BigInt(facts['originalQuantityScaled']):0n;
      const restitution=typeof facts['originalRestitutionCents']==='number'?facts['originalRestitutionCents']:null;
      const complement=typeof facts['originalComplementCents']==='number'?facts['originalComplementCents']:null;
      const previous=await client.query<{quantity:string}>(`select coalesce(sum(returned_quantity_scaled),0)::text quantity from app.tax_st_return_reversal
        where tenant_id=$1 and empresa_id=$2 and original_line_id=$3`,[tenantId,companyId,event.original_line_id]);
      const differenceKind=facts['differenceKind'];
      if(differenceKind!=='RESTITUTION'&&differenceKind!=='COMPLEMENT'&&differenceKind!=='NONE')
        throw new ErroDeDominio(CODIGOS_DE_ERRO.ICMS_ST_ORIGINAL_CALCULATION_UNAVAILABLE,'Tipo de diferença original indisponível.');
      const result=calculateIcmsStReturnReversal({differenceKind,
        originalQuantityScaled:total,previouslyReturnedQuantityScaled:BigInt(previous.rows[0]?.quantity??'0'),returnedQuantityScaled:BigInt(event.returned_quantity_scaled),
        originalRestitutionCents:restitution,originalComplementCents:complement});
      if(!result.ok)throw new ErroDeDominio(CODIGOS_DE_ERRO.ICMS_ST_RETURN_QUANTITY_EXCEEDED,'Saldo devolvível indisponível ou quantidade excedida.');
      const competence=`${event.event_date.slice(0,7)}-01`;
      const textFact=(key:string):string|null=>typeof facts[key]==='string'?facts[key] as string:null;
      const model=textFact('returnModel');
      if(model!=='55'&&model!=='65')throw new ErroDeDominio(CODIGOS_DE_ERRO.ICMS_ST_EVENT_EVIDENCE_INVALID,'Modelo fiscal da devolução inválido.');
      const c002=renderIcmsStC002({competence:competence.slice(0,7),returnDate:event.event_date,efdDate:textFact('efdDate'),
        returnDocumentNumber:textFact('returnDocumentNumber')??'',returnAccessKey:textFact('returnAccessKey')??'',returnModel:model,
        returnSeries:textFact('returnSeries')??'',returnCfop:textFact('returnCfop')??'',ncm:textFact('ncm'),itemNumber:Number(event.return_item_identity),
        productCode:textFact('productCode')??'',productDescription:textFact('productDescription')??'',unit:event.normalized_unit,
        quantity:textFact('returnedQuantity')??'',unitPrice:textFact('unitPrice')??'',total:textFact('total')??'',
        originalDocumentNumber:textFact('originalDocumentNumber'),originalAccessKey:textFact('originalAccessKey'),originalDate:textFact('originalDate'),
        reversedRestitutionCents:result.reversedRestitutionCents,reversedComplementCents:result.reversedComplementCents});
      if(c002===null)throw new ErroDeDominio(CODIGOS_DE_ERRO.ICMS_ST_EVENT_EVIDENCE_INVALID,'Evidência incompleta para linha C002; estorno não aprovado.');
      try {
        await client.query('select app.tax_st_return_review($1::uuid,$2::uuid,$3::uuid,$4::timestamptz,$5::text,$6::text,$7::text)',
          [eventId,companyId,userId,this.agora(),action,reason,correlationId]);
      } catch(error) {
        const message=error instanceof Error?error.message:'';
        if(message.includes('ICMS_ST_RETURN_REVIEW_FORBIDDEN'))throw new ErroDeDominio(CODIGOS_DE_ERRO.SEM_AUTORIZACAO,'Somente contador/admin pode decidir a devolução.');
        if(message.includes('ICMS_ST_RETURN_REVIEW_CONFLICT'))throw new ErroDeConflito(CODIGOS_DE_ERRO.CONFLITO_DE_VERSAO,'Devolução já decidida ou revisão superada.');
        if(message.includes('ICMS_ST_RETURN_NOT_FOUND'))throw new ErroDeDominio(CODIGOS_DE_ERRO.ICMS_ST_EVENT_LINK_NOT_FOUND,'Devolução não encontrada.');
        throw error;
      }
      const inserted=await client.query<{id:string}>(`select app.tax_st_return_finalize($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::date,
        $6::numeric,$7::numeric,$8::bigint,$9::bigint,$10::text,$11::timestamptz) id`,
        [eventId,tenantId,companyId,userId,competence,event.returned_quantity_scaled,result.remainingQuantityScaled.toString(),
          result.reversedRestitutionCents,result.reversedComplementCents,correlationId,this.agora()]);
      if(!inserted.rows[0])throw new Error('Estorno F32 não persistido após aprovação.');
      const snapshot=await this.composeReturnSnapshot(client,{tenantId,userId,companyId,competence,correlationId});
      return {eventId,action,competence,remainingQuantityScaled:result.remainingQuantityScaled.toString(),
        reversedRestitutionCents:result.reversedRestitutionCents,reversedComplementCents:result.reversedComplementCents,c002,
        snapshotId:snapshot.id,revision:snapshot.revision};
    });
  }

  private async composeReturnSnapshot(client:PoolClient,input:Readonly<{
    tenantId:string;userId:string;companyId:string;competence:string;correlationId:string;
  }>):Promise<{id:string;revision:number}> {
    const month=input.competence.slice(0,7);
    await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`icms-st:${input.tenantId}:${input.companyId}:${month}`]);
    const selected=await client.query<{event_id:string;event_date:string;event_competence:string;quantity:string;unit:string;item_identity:string;
      restitution:string;complement:string;evidence_sha256:string;evidence_facts:unknown;regime:string|null}>(
      `select e.id event_id,to_char(e.event_date,'YYYY-MM-DD') event_date,to_char(r.competence,'YYYY-MM-DD') event_competence,
          e.returned_quantity_scaled::text quantity,e.normalized_unit unit,e.return_item_identity item_identity,
          r.reversed_restitution_cents::text restitution,r.reversed_complement_cents::text complement,e.evidence_sha256,e.evidence_facts,s.regime
         from app.tax_st_return_reversal r join app.tax_st_return_event e on e.id=r.event_id and e.tenant_id=r.tenant_id and e.empresa_id=r.empresa_id
         join app.tax_st_settlement_snapshot s on s.id=e.original_snapshot_id and s.tenant_id=e.tenant_id and s.empresa_id=e.empresa_id
        where r.tenant_id=$1 and r.empresa_id=$2 and r.competence=$3::date order by e.event_date,e.id`,[input.tenantId,input.companyId,input.competence]);
    if(selected.rows.length===0)throw new Error('Nenhuma devolução aprovada para compor revisão F32.');
    const rows=selected.rows.map((event)=>{
      const evidence=typeof event.evidence_facts==='object'&&event.evidence_facts!==null?event.evidence_facts as Record<string,unknown>:{};
      const field=(key:string):string|null=>typeof evidence[key]==='string'?evidence[key] as string:null;
      const model=field('returnModel');
      const restitution=centavosSeguros(event.restitution);const complement=centavosSeguros(event.complement);
      if((model!=='55'&&model!=='65')||restitution===null||complement===null)
        throw new ErroDeDominio(CODIGOS_DE_ERRO.ICMS_ST_EVENT_EVIDENCE_INVALID,'Devolução aprovada sem dados C002 ou estorno verificável.');
      const c002=renderIcmsStC002({competence:month,returnDate:event.event_date,efdDate:field('efdDate'),returnDocumentNumber:field('returnDocumentNumber')??'',
        returnAccessKey:field('returnAccessKey')??'',returnModel:model,returnSeries:field('returnSeries')??'',returnCfop:field('returnCfop')??'',ncm:field('ncm'),
        itemNumber:Number(event.item_identity),productCode:field('productCode')??'',productDescription:field('productDescription')??'',unit:event.unit,
        quantity:field('returnedQuantity')??'',unitPrice:field('unitPrice')??'',total:field('total')??'',originalDocumentNumber:field('originalDocumentNumber'),
        originalAccessKey:field('originalAccessKey'),originalDate:field('originalDate'),reversedRestitutionCents:restitution,reversedComplementCents:complement});
      if(c002===null)throw new ErroDeDominio(CODIGOS_DE_ERRO.ICMS_ST_EVENT_EVIDENCE_INVALID,'Linha C002 não pode ser composta com evidência incompleta.');
      return {eventId:event.event_id,eventDate:event.event_date,evidenceSha256:event.evidence_sha256,c002,restitution,complement,regime:event.regime};
    });
    const inputHash=createHash('sha256').update(jsonText(rows)).digest('hex');
    const idempotencyKey=`f32-return-${inputHash}`;
    const revisionRow=await client.query<{revision:number|null}>(`select max(revision)::int revision from app.tax_st_settlement_snapshot
      where tenant_id=$1 and empresa_id=$2 and competence=$3::date`,[input.tenantId,input.companyId,input.competence]);
    const revision=(revisionRow.rows[0]?.revision??0)+1;
    const grossRestitution=rows.reduce((sum,row)=>sum+row.restitution,0);
    const grossComplement=rows.reduce((sum,row)=>sum+row.complement,0);
    if(!Number.isSafeInteger(grossRestitution)||!Number.isSafeInteger(grossComplement))
      throw new ErroDeDominio(CODIGOS_DE_ERRO.ICMS_ST_ORIGINAL_CALCULATION_UNAVAILABLE,'Totais C002 excedem o intervalo seguro.');
    const processedAt=this.agora();
    const c002Lines=rows.map((row)=>row.c002);
    const facts={source:'F32_RETURN',layout:'C002',blockingReasonCodes:[],c002Lines,c002Sha256:createHash('sha256').update(c002Lines.join('\n')).digest('hex'),
      eventIds:rows.map((row)=>row.eventId),evidenceHashes:rows.map((row)=>row.evidenceSha256),inputSha256:inputHash};
    const payload={snapshot:{tenant_id:input.tenantId,empresa_id:input.companyId,competence:input.competence,regime:rows[0]?.regime??null,
      revision,idempotency_key:idempotencyKey,input_sha256:inputHash,package_id:null,package_sha256:null,status:'PENDING_REVIEW',
      gross_restitution_cents:grossRestitution,gross_complement_cents:grossComplement,net_amount_cents:grossRestitution-grossComplement,
      line_count:rows.length,blocked_line_count:0,facts,reprocessing_reason:'Revisão por devolução F32',actor_id:input.userId,
      correlation_id:input.correlationId,processed_at:processedAt},lines:[],event_details:{source:'F32_RETURN',inputSha256:inputHash,eventIds:rows.map((row)=>row.eventId)}};
    const created=await client.query<{snapshot_id:string}>('select app.tax_st_settlement_process($1::jsonb) snapshot_id',[jsonText(payload)]);
    if(!created.rows[0]?.snapshot_id)throw new Error('Revisão imutável da competência do evento não foi persistida.');
    return {id:created.rows[0].snapshot_id,revision};
  }

  async get(tenantId: string, userId: string, companyId: string, snapshotId: string, correlationId: string, page = 1, model?: '55' | '65') {
    return comContextoHumano(this.pool.instancia, { tenantId, usuarioId: userId, correlationId }, async (client) => {
      const snapshot = await client.query(`select s.id,s.competence,s.regime,s.revision,
          case when exists(select 1 from app.tax_st_settlement_event changed where changed.snapshot_id=s.id and changed.action='DOCUMENT_SET_CHANGED') then 'STALE'
               when rev.action='APPROVED' then 'APPROVED' when rev.action='REJECTED' then 'REJECTED' else s.status end status,
          s.gross_restitution_cents,s.gross_complement_cents,s.net_amount_cents,s.line_count,s.blocked_line_count,s.facts,s.processed_at,rev.action review_action
          from app.tax_st_settlement_snapshot s left join lateral(select e.action,e.occurred_at,e.id from app.tax_st_settlement_review_event e where e.snapshot_id=s.id order by e.occurred_at desc,e.id desc limit 1) rev on true
          where s.tenant_id=$1 and s.empresa_id=$2 and s.id=$3`,
        [tenantId, companyId, snapshotId]);
      if (!snapshot.rows[0]) throw new ErroDeDominio(CODIGOS_DE_ERRO.ICMS_ST_SETTLEMENT_NOT_FOUND, 'Apuração não encontrada.');
      const pageSize = 50;
      const offset = (page - 1) * pageSize;
      const lines = await client.query(`select l.id,l.output_document_id,l.output_item_id,l.difference_kind,l.restitution_cents,l.complement_cents,l.facts,l.calculation,l.recovery_memory,l.source_ids,l.blocking_reason_codes
          from app.tax_st_settlement_line l join app.fiscal_document d on d.id=l.output_document_id and d.tenant_id=l.tenant_id and d.empresa_id=l.empresa_id
         where l.tenant_id=$1 and l.empresa_id=$2 and l.snapshot_id=$3 and ($4::text is null or d.modelo=$4)
         order by l.output_document_id,l.output_item_id limit $5 offset $6`, [tenantId,companyId,snapshotId,model??null,pageSize,offset]);
      const lineCount = await client.query<{ count: string }>(`select count(*)::text count from app.tax_st_settlement_line l join app.fiscal_document d on d.id=l.output_document_id and d.tenant_id=l.tenant_id and d.empresa_id=l.empresa_id
         where l.tenant_id=$1 and l.empresa_id=$2 and l.snapshot_id=$3 and ($4::text is null or d.modelo=$4)`,[tenantId,companyId,snapshotId,model??null]);
      const events = await client.query(`select action,occurred_at,details from app.tax_st_settlement_event where tenant_id=$1 and empresa_id=$2 and snapshot_id=$3
        union all select action,occurred_at,details from app.tax_st_settlement_review_event where tenant_id=$1 and empresa_id=$2 and snapshot_id=$3 order by occurred_at`,
        [tenantId, companyId, snapshotId]);
      const returnEvents=await client.query<{id:string;origin:string;return_document_identity:string;return_item_identity:string;event_date:string;normalized_unit:string;
        returned_quantity_scaled:string;evidence_sha256:string;competence:string|null;reversed_restitution_cents:string|null;reversed_complement_cents:string|null;
        remaining_quantity_scaled:string|null;original_line_id:string;review_action:string|null;review_details:unknown;evidence_facts:unknown}>(`select e.id,e.origin,e.return_document_identity,e.return_item_identity,to_char(e.event_date,'YYYY-MM-DD') event_date,
          e.normalized_unit,e.returned_quantity_scaled::text returned_quantity_scaled,e.evidence_sha256,r.competence::text competence,
          r.reversed_restitution_cents::text reversed_restitution_cents,r.reversed_complement_cents::text reversed_complement_cents,
          r.remaining_quantity_scaled::text remaining_quantity_scaled,r.original_line_id,review.action review_action,review.details review_details,e.evidence_facts
        from app.tax_st_return_event e left join app.tax_st_return_reversal r on r.event_id=e.id
        left join lateral(select action,details from app.tax_st_return_review_event where return_event_id=e.id order by occurred_at desc,id desc limit 1) review on true
       where e.tenant_id=$1 and e.empresa_id=$2 and (e.original_snapshot_id=$3 or r.competence=(select competence from app.tax_st_settlement_snapshot where id=$3))
       order by e.event_date,e.occurred_at,e.id`,[tenantId,companyId,snapshotId]);
      const returnRows=returnEvents.rows.map((event)=>{
        const evidence=typeof event.evidence_facts==='object'&&event.evidence_facts!==null?event.evidence_facts as Record<string,unknown>:{};
        const textFact=(key:string):string|null=>typeof evidence[key]==='string'?evidence[key] as string:null;
        const centsFact=(value:string|null):number|null=>centavosSeguros(value);
        const model=textFact('returnModel');
        const c002=event.review_action==='APPROVED'&&event.competence!==null&&event.reversed_restitution_cents!==null&&event.reversed_complement_cents!==null&&
          (model==='55'||model==='65')&&textFact('returnDocumentNumber')!==null&&textFact('returnAccessKey')!==null&&textFact('returnSeries')!==null&&
          textFact('returnCfop')!==null&&textFact('productCode')!==null&&textFact('productDescription')!==null&&textFact('returnedQuantity')!==null&&textFact('unitPrice')!==null&&textFact('total')!==null&&
          textFact('originalDocumentNumber')!==null&&textFact('originalAccessKey')!==null&&textFact('originalDate')!==null&&
          centsFact(event.reversed_restitution_cents)!==null&&centsFact(event.reversed_complement_cents)!==null
          ?renderIcmsStC002({competence:event.competence.slice(0,7),returnDate:event.event_date,efdDate:textFact('efdDate'),
            returnDocumentNumber:textFact('returnDocumentNumber')!,returnAccessKey:textFact('returnAccessKey')!,returnModel:model,returnSeries:textFact('returnSeries')!,
            returnCfop:textFact('returnCfop')!,ncm:textFact('ncm'),itemNumber:Number(event.return_item_identity),productCode:textFact('productCode')!,
            productDescription:textFact('productDescription')!,unit:event.normalized_unit,quantity:textFact('returnedQuantity')!,unitPrice:textFact('unitPrice')!,
            total:textFact('total')!,originalDocumentNumber:textFact('originalDocumentNumber'),originalAccessKey:textFact('originalAccessKey'),
            originalDate:textFact('originalDate'),reversedRestitutionCents:centsFact(event.reversed_restitution_cents)!,
            reversedComplementCents:centsFact(event.reversed_complement_cents)!}):null;
        return {id:event.id,origin:event.origin,return_document_identity:event.return_document_identity,return_item_identity:event.return_item_identity,
          event_date:event.event_date,normalized_unit:event.normalized_unit,returned_quantity_scaled:event.returned_quantity_scaled,evidence_sha256:event.evidence_sha256,
          competence:event.competence,reversed_restitution_cents:event.reversed_restitution_cents,reversed_complement_cents:event.reversed_complement_cents,
          remaining_quantity_scaled:event.remaining_quantity_scaled,original_line_id:event.original_line_id,review_action:event.review_action,
          rejection_reason:typeof event.review_details==='object'&&event.review_details!==null&&'reason' in event.review_details?event.review_details.reason:null,c002};
      });
      const filteredLineCount = Number(lineCount.rows[0]?.count ?? 0);
      const isReturnSnapshot=typeof snapshot.rows[0].facts==='object'&&snapshot.rows[0].facts!==null&&
        'source' in snapshot.rows[0].facts&&(snapshot.rows[0].facts as {source?:unknown}).source==='F32_RETURN';
      const visibleLineCount=isReturnSnapshot?returnRows.filter((event)=>event.c002!==null).length:filteredLineCount;
      return { ...snapshot.rows[0], line_count: visibleLineCount, lines: lines.rows, events: events.rows, returnEvents:returnRows,
        c002Lines:returnRows.map((event)=>event.c002).filter((line):line is string=>line!==null),line_page: page, line_page_size: pageSize,
        line_total_pages: Math.ceil(visibleLineCount / pageSize) };
    });
  }

  private async packages(correlationId: string): Promise<PackageRow[]> {
    return noCatalogoTributario(this.pool.instancia, correlationId, async (client) => {
      const { rows } = await client.query<PackageRow>(
        `select id,content,content_sha256 from app.tax_package_list(false) where status='PUBLISHED'`,
      );
      return rows;
    });
  }

  async process(tenantId: string, userId: string, companyId: string, competence: string, correlationId: string,
    input: Readonly<{ idempotencyKey: string; reprocessingReason?: string | undefined }>) {
    const publishedPackages = await this.packages(correlationId);
    return comContextoHumano(this.pool.instancia, { tenantId, usuarioId: userId, correlationId }, async (client) => {
      const company = await getDfeCaptureCompany(client, companyId);
      if (!company || company.tenantId !== tenantId || !company.active) {
        throw new ErroDeDominio(CODIGOS_DE_ERRO.EMPRESA_NAO_ENCONTRADA, 'Empresa não encontrada ou inativa.');
      }
      const monthStart = `${competence}-01`;
      await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [`icms-st:${tenantId}:${companyId}:${competence}`]);
      const outputQuery = await client.query<OutputRow>(
        `select d.id document_id,d.chave_acesso access_key,d.estado document_state,d.modelo model,d.protocolo protocol,
                to_char(d.emitido_em,'YYYY-MM-DD') fact_date,emit.uf seller_uf,dest.uf destination_uf,d.consumidor_final final_consumer,
                d.id_dest destination_indicator,d.ind_final final_consumer_indicator,dest.identificador destination_identifier,
                i.numero item_number,i.gtin,i.ncm,i.cest,i.cfop,i.cst_csosn,i.unidade unit,i.quantidade::text quantity,
                i.valor::text value,i.frete::text freight,i.seguro::text insurance,i.outras_despesas::text other_expenses,
                i.desconto::text discount,
                false canceled_before_processing,ev.post_sale_event_state,
                exists(select 1 from app.fiscal_document_event conflict_event
                  where conflict_event.document_id=d.id and (conflict_event.tipo in ('CONFLITO','FALHA','XML_INVALIDO') or
                    (conflict_event.tipo in ('REUTILIZADO','REPROCESSADO') and conflict_event.codigo in ('CONFLITO','FALHA','XML_INVALIDO')))) has_document_conflict
           from app.fiscal_document d
           join app.fiscal_document_party emit on emit.document_id=d.id and emit.parser_version=d.parser_version and emit.papel='EMITENTE'
           left join app.fiscal_document_party dest on dest.document_id=d.id and dest.parser_version=d.parser_version and dest.papel='DESTINATARIO'
           join app.fiscal_document_item i on i.document_id=d.id and i.parser_version=d.parser_version and i.tipo='ITEM'
           left join lateral (
             select CASE WHEN bool_or(lower(e.tipo) like '%cancel%' OR lower(coalesce(e.codigo,'')) like '%cancel%') THEN TRUE ELSE NULL END post_sale_event_state
               from app.fiscal_document_event e where e.document_id=d.id and e.tipo='EVENTO_SEFAZ'
           ) ev on true
          where d.tenant_id=$1 and d.empresa_id=$2 and d.especie in ('NFE_55','NFCE_65') and d.estado<>'CANCELLED' and d.emitido_em >= $3::date
            and d.emitido_em < ($3::date + interval '1 month') and emit.identificador=$4 and (dest.identificador is null or dest.identificador<>$4)
          order by d.emitido_em,d.id,i.numero`,
        [tenantId, companyId, monthStart, company.cnpj.replace(/\D/gu, '')],
      );
      const cancelledOutputs = await client.query<{id:string;access_key:string;model:string;cancelled_at:string|null}>(
        `select id,chave_acesso access_key,modelo model,cancelado_em::text cancelled_at from app.fiscal_document
          where tenant_id=$1 and empresa_id=$2 and especie in ('NFE_55','NFCE_65') and estado='CANCELLED'
            and emitido_em >= $3::date and emitido_em < ($3::date + interval '1 month') order by id`,
        [tenantId,companyId,monthStart]);
      const entryQuery = await client.query<EntryRow>(
        `select d.id document_id,d.protocolo protocol,to_char(d.emitido_em,'YYYY-MM-DD') fact_date,d.estado document_state,
                exists(select 1 from app.fiscal_document_event conflict_event
                  where conflict_event.document_id=d.id and (conflict_event.tipo in ('CONFLITO','FALHA','XML_INVALIDO') or
                    (conflict_event.tipo in ('REUTILIZADO','REPROCESSADO') and conflict_event.codigo in ('CONFLITO','FALHA','XML_INVALIDO')))) has_document_conflict,
                i.numero item_number,i.gtin,i.unidade unit,i.quantidade::text quantity,
                (max(t.valor) filter(where t.codigo='ICMS'))::text input_icms,
                (max(t.valor) filter(where t.codigo='ICMS_ST'))::text input_icms_st,
                (max(t.base_calculo) filter(where t.codigo='ICMS_ST'))::text presumed_base
           from app.fiscal_document d
           join app.fiscal_document_party emit on emit.document_id=d.id and emit.parser_version=d.parser_version and emit.papel='EMITENTE'
           join app.fiscal_document_party dest on dest.document_id=d.id and dest.parser_version=d.parser_version and dest.papel='DESTINATARIO'
           join app.fiscal_document_item i on i.document_id=d.id and i.parser_version=d.parser_version and i.tipo='ITEM'
           left join app.fiscal_document_tax t on t.document_id=i.document_id and t.parser_version=i.parser_version and t.numero_item=i.numero
             and t.escopo='ITEM' and t.codigo in ('ICMS','ICMS_ST')
          where d.tenant_id=$1 and d.empresa_id=$2 and d.especie='NFE_55' and d.emitido_em >= '2016-10-27'::date
            and d.emitido_em < '2018-03-01'::date and dest.identificador=$3 and emit.identificador<>$3
          group by d.id,d.protocolo,d.emitido_em,d.estado,i.numero,i.gtin,i.unidade,i.quantidade
          order by d.emitido_em,d.id,i.numero`,
        [tenantId, companyId, company.cnpj.replace(/\D/gu, '')],
      );

      const outputRows = outputQuery.rows;
      const regimeHistoryRows = await listarHistoricoRegimeTributario(client, companyId);
      const effectiveRegimeHistory = regimeHistoryRows;
      const entryRows = entryQuery.rows;
      const outputs: IcmsStOutputLine[] = [];
      const regimes = new Set<string>();
      const rulesByDate = new Map<string, readonly IcmsStSettlementRule[]>();
      const selectedPackages = new Map<string, Readonly<{id: string; hash: string}>>();
      for (const row of outputRows) {
        const effectiveRegime = effectiveRegimeHistory.filter((entry) => row.fact_date !== null && entry.valid_from <= row.fact_date).at(-1);
        const historical = effectiveRegime === undefined ? null : { regime: effectiveRegime.regime, vigente_desde: effectiveRegime.valid_from };
        const itemRegime = historical?.regime === 'SIMPLES_NACIONAL' || historical?.regime === 'LUCRO_PRESUMIDO' ? historical.regime : null;
        if (itemRegime !== null) regimes.add(itemRegime);
        const packagesForDate = packageRules(publishedPackages, row.fact_date ?? '', itemRegime);
        for (const selected of packagesForDate) selectedPackages.set(selected.id, { id: selected.id, hash: selected.hash });
        const rulesForDate = packagesForDate.flatMap((selected) => selected.rules);
        rulesByDate.set(row.fact_date ?? '', rulesForDate);
        outputs.push({
          id: `${row.document_id}:${row.item_number}`, documentId: row.document_id, accessKey: row.access_key, itemNumber: row.item_number, documentModel: row.model,
          documentAuthorized: row.document_state === 'PROCESSADO' && row.protocol !== null && !row.has_document_conflict,
          documentCanceled: row.canceled_before_processing, canceledAfterSale: row.post_sale_event_state,
          factDate: row.fact_date ?? '', sellerUf: row.seller_uf, destinationUf: row.destination_uf,
          finalConsumer: row.final_consumer, destinationIndicator: row.destination_indicator,
          finalConsumerIndicator: row.final_consumer_indicator, destinationIdentifier: row.destination_identifier, regime: itemRegime, productId: row.gtin,
          ncm: row.ncm, cest: row.cest, cfop: row.cfop, cstCsosn: row.cst_csosn, unit: row.unit,
          quantityScaled: toQuantityScaled(row.quantity), quantityScale: 10, outputBaseCents: itemBaseCents(row), ruleId: null,
        });
      }
      const consistentRegime = regimes.size === 1 ? [...regimes][0] as 'SIMPLES_NACIONAL' | 'LUCRO_PRESUMIDO' : null;
      const entries: IcmsStInputEntry[] = entryRows.map((row) => ({
        id: `${row.document_id}:${row.item_number}`, documentId: row.document_id, efdRecordId: null,
        companyId, productId: row.gtin, unit: row.unit, factDate: row.fact_date ?? '', competence: row.fact_date?.slice(0, 7) ?? '',
        quantityScaled: toQuantityScaled(row.quantity),
        inputIcmsCents: decimalDeclaradoParaCentavos(row.input_icms),
        inputIcmsStCents: decimalDeclaradoParaCentavos(row.input_icms_st),
        presumedBaseCents: decimalDeclaradoParaCentavos(row.presumed_base),
        corroborated: row.document_state === 'PROCESSADO' && row.protocol !== null && !row.has_document_conflict,
        linkedOutputLineIds: [],
      }));
      const applicableRules = [...rulesByDate.values()].flat().filter((rule, index, all) => all.findIndex((candidate) => candidate.id === rule.id) === index);
      const packageSelections = [...selectedPackages.values()];
      const pkg = packageSelections.length === 1 ? packageSelections[0] ?? null : null;
      const result = resolveIcmsStSettlement({ companyId, competence, regime: consistentRegime, outputs, entries, rules: applicableRules });
      const documentSetHash = createHash('sha256').update(jsonText({ outputs: outputRows, cancelledOutputs: cancelledOutputs.rows, entries: entryRows })).digest('hex');
      const inputHash = createHash('sha256').update(jsonText({ result, documentSetHash, packageId: pkg?.id ?? null, packageSha256: pkg?.hash ?? null,
        regimeHistory: effectiveRegimeHistory, company: { id: company.id, cnpj: company.cnpj, active: company.active },
        outputs, entries, outputFacts: outputRows, inputFacts: entryRows })).digest('hex');

      const existing = await client.query<{ id: string; revision: number; input_sha256: string; status: string }>(
        `select id,revision,input_sha256,status from app.tax_st_settlement_snapshot
          where tenant_id=$1 and empresa_id=$2 and competence=$3::date and idempotency_key=$4`,
        [tenantId, companyId, monthStart, input.idempotencyKey],
      );
      if (existing.rows[0]) {
        if (existing.rows[0].input_sha256 !== inputHash) {
          throw new ErroDeConflito(CODIGOS_DE_ERRO.ICMS_ST_SETTLEMENT_IDEMPOTENCY_CONFLICT, 'Chave de idempotência já usada com conjunto documental diferente.');
        }
        return { id: existing.rows[0].id, revision: existing.rows[0].revision, status: existing.rows[0].status, reused: true };
      }
      if (input.reprocessingReason === undefined && (await client.query(
        `select 1 from app.tax_st_settlement_snapshot where tenant_id=$1 and empresa_id=$2 and competence=$3::date limit 1`,
        [tenantId, companyId, monthStart],
      )).rows.length > 0) {
        throw new ErroDeDominio(CODIGOS_DE_ERRO.ICMS_ST_SETTLEMENT_REPROCESS_REASON_REQUIRED, 'Reprocessamento exige motivo.');
      }
      const revisionQuery = await client.query<{ revision: number | null }>(
        `select max(revision)::int revision from app.tax_st_settlement_snapshot where tenant_id=$1 and empresa_id=$2 and competence=$3::date`,
        [tenantId, companyId, monthStart],
      );
      const revision = (revisionQuery.rows[0]?.revision ?? 0) + 1;
      const competenceOutputs = outputs.filter((line) => line.factDate.startsWith(competence) && !line.documentCanceled);
      const packageCoverageAmbiguous = pkg === null && packageSelections.length > 1;
      const coverageReasons = [...(competenceOutputs.length===0?['OUTPUT_DOCUMENT_COVERAGE_UNAVAILABLE']:[]),
        ...(applicableRules.length===0?['NO_APPLICABLE_SETTLEMENT_RULE']:[]),
        ...(packageCoverageAmbiguous?['SETTLEMENT_PACKAGE_AMBIGUOUS']:[]),
        'OFFICIAL_LAYOUT_UNAVAILABLE'];
      const coverageBlocked = coverageReasons.length > 0;
      const storedLines = coverageBlocked ? result.lines.map((line) => ({ ...line, differenceKind: 'INDETERMINATE' as const,
        restitutionCents: null, complementCents: null, presumedBaseCents: null, effectiveBaseCents: null,
        inputIcmsCents: null, inputIcmsStCents: null, effectiveIcmsCents: null, ruleId: null,
        formulaVersion: null, sourceIds: [], recoveryDocumentIds: [], blockingReasonCodes: [...new Set([...line.blockingReasonCodes,...coverageReasons])] })) : result.lines;
      const blockedLineCount = storedLines.filter((line) => line.differenceKind === 'INDETERMINATE').length;
      const status = result.status === 'BLOCKED' || coverageBlocked ? 'BLOCKED' : 'PENDING_REVIEW';
      const facts = { documentSetHash, regimeHistory: [...new Set(competenceOutputs.map((line) => line.regime))], packageId: pkg?.id ?? null, packageSha256: pkg?.hash ?? null,
        layout: 'OFFICIAL_UNMAPPED',
        outputDocumentIds: [...new Set(outputs.map((line) => line.documentId))].sort(),
        excludedCancelledOutputDocuments: cancelledOutputs.rows.map(({id,access_key,model,cancelled_at})=>({id,accessKey:access_key,model,cancelledAt:cancelled_at})),
        sourceDocuments: [...new Set(entries.map((line) => line.documentId).filter((id): id is string => id !== null))].sort(),
        blockingReasonCodes: [...new Set([...result.blockingReasonCodes,...coverageReasons])] };
      const processedAt = this.agora();
      const payload = {
        snapshot: { tenant_id: tenantId, empresa_id: companyId, competence: monthStart, regime: consistentRegime, revision,
          idempotency_key: input.idempotencyKey, input_sha256: inputHash, package_id: pkg?.id ?? null, package_sha256: pkg?.hash ?? null,
          status, gross_restitution_cents: status === 'BLOCKED' ? null : result.grossRestitutionCents,
          gross_complement_cents: status === 'BLOCKED' ? null : result.grossComplementCents,
          net_amount_cents: status === 'BLOCKED' ? null : result.netAmountCents, line_count: storedLines.length, blocked_line_count: blockedLineCount,
          facts, reprocessing_reason: input.reprocessingReason ?? null, actor_id: userId, correlation_id: correlationId, processed_at: processedAt },
        lines: storedLines.map((line) => ({ output_document_id: line.outputDocumentId, output_item_id: line.outputItemId,
          difference_kind: line.differenceKind, restitution_cents: line.restitutionCents, complement_cents: line.complementCents,
          facts: outputs.find((item) => item.documentId===line.outputDocumentId&&item.id===line.outputItemId) ?? {}, calculation: line,
          recovery_memory: { origin: line.recoveryOrigin, documents: line.recoveryDocumentIds, inputIcmsCents: line.inputIcmsCents,
            inputIcmsStCents: line.inputIcmsStCents, presumedBaseCents: line.presumedBaseCents }, source_ids: line.sourceIds,
          blocking_reason_codes: line.blockingReasonCodes })),
        event_details: { revision, inputSha256: inputHash, packageId: pkg?.id ?? null },
      };
      const persisted = await client.query<{ snapshot_id: string }>('select app.tax_st_settlement_process($1::jsonb) snapshot_id', [jsonText(payload)]);
      const snapshotId = persisted.rows[0]?.snapshot_id;
      if (snapshotId === undefined) throw new Error('snapshot F29 não foi persistido');
      return { id: snapshotId, revision, status, reused: false, blockedLineCount, packageId: pkg?.id ?? null };
    });
  }

  async list(tenantId: string, userId: string, companyId: string, correlationId: string, model?: '55' | '65') {
    return comContextoHumano(this.pool.instancia, { tenantId, usuarioId: userId, correlationId }, async (client) => {
      const { rows } = await client.query(`select s.id,s.competence,s.revision,
          case when exists(select 1 from app.tax_st_settlement_event changed where changed.snapshot_id=s.id and changed.action='DOCUMENT_SET_CHANGED') then 'STALE'
               when rev.action='APPROVED' then 'APPROVED' when rev.action='REJECTED' then 'REJECTED' else s.status end status,
          s.gross_restitution_cents,s.gross_complement_cents,s.net_amount_cents,
          case when s.facts->>'source'='F32_RETURN' then coalesce(jsonb_array_length(s.facts->'c002Lines'),0)
               when $3::text is null then s.line_count else (select count(*)::int from app.tax_st_settlement_line fl join app.fiscal_document fd on fd.id=fl.output_document_id where fl.snapshot_id=s.id and fd.modelo=$3) end line_count,
          s.blocked_line_count,s.processed_at,rev.action review_action
        from app.tax_st_settlement_snapshot s left join lateral(select e.action from app.tax_st_settlement_review_event e where e.snapshot_id=s.id order by e.occurred_at desc,e.id desc limit 1) rev on true
          where s.tenant_id=$1 and s.empresa_id=$2 and ($3::text is null or exists(select 1 from app.tax_st_settlement_line fl join app.fiscal_document fd on fd.id=fl.output_document_id where fl.snapshot_id=s.id and fd.modelo=$3)
            or (s.facts->>'source'='F32_RETURN' and exists(select 1 from app.tax_st_return_event re where re.tenant_id=s.tenant_id and re.empresa_id=s.empresa_id and re.evidence_facts->>'returnModel'=$3 and re.event_date=s.competence)))
          order by s.competence desc,s.revision desc limit 50`, [tenantId,companyId,model??null]);
      return { itens: rows };
    });
  }

  async review(tenantId: string, userId: string, companyId: string, snapshotId: string, expectedRevision: number,
    action: 'SUBMITTED' | 'APPROVED' | 'REJECTED', reason: string | null, correlationId: string) {
    return comContextoHumano(this.pool.instancia, { tenantId, usuarioId: userId, correlationId }, async (client) => {
      const coverage = await client.query<{ status: string; facts: unknown; blocked_line_count: number; line_count:number }>(
        `select status,facts,blocked_line_count,line_count from app.tax_st_settlement_snapshot
          where tenant_id=$1 and empresa_id=$2 and id=$3`, [tenantId,companyId,snapshotId]);
      const facts = coverage.rows[0]?.facts;
      const factRecord=typeof facts==='object'&&facts!==null?facts as Record<string,unknown>:{};
      const c002Lines=Array.isArray(factRecord['c002Lines'])?factRecord['c002Lines']:[];
      const validReturnSnapshot=factRecord['source']==='F32_RETURN'&&factRecord['layout']==='C002'&&
        c002Lines.length===coverage.rows[0]?.line_count&&c002Lines.every((line)=>typeof line==='string')&&
        typeof factRecord['c002Sha256']==='string'&&factRecord['c002Sha256']===createHash('sha256').update(c002Lines.join('\n')).digest('hex');
      if (!coverage.rows[0] || coverage.rows[0].status !== 'PENDING_REVIEW' || coverage.rows[0].blocked_line_count !== 0 ||
          (await client.query(`select 1 from app.tax_st_settlement_event where tenant_id=$1 and empresa_id=$2 and snapshot_id=$3 and action='DOCUMENT_SET_CHANGED' limit 1`,[tenantId,companyId,snapshotId])).rows.length>0 ||
          settlementCoverageBlocksReview(facts) || (action==='APPROVED'&&!validReturnSnapshot)) {
        throw new ErroDeDominio(CODIGOS_DE_ERRO.ICMS_ST_SETTLEMENT_NOT_APPROVABLE,
          'A cobertura da competência ou o demonstrativo oficial ainda não permite submeter ou decidir a apuração.');
      }
      try {
        await client.query('select app.tax_st_settlement_review($1::uuid,$2::uuid,$3::uuid,$4::integer,$5::timestamptz,$6::text,$7::text,$8::text)',
          [snapshotId, companyId, userId, expectedRevision, this.agora(), action, reason, correlationId]);
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        if (message.includes('ICMS_ST_SETTLEMENT_REVIEW_CONFLICT')) {
          throw new ErroDeConflito(CODIGOS_DE_ERRO.ICMS_ST_SETTLEMENT_REVIEW_CONFLICT, 'Revisão superada ou decisão já registrada.');
        }
        if (message.includes('ICMS_ST_SETTLEMENT_NOT_APPROVABLE')) {
          throw new ErroDeDominio(CODIGOS_DE_ERRO.ICMS_ST_SETTLEMENT_NOT_APPROVABLE, 'Apuração bloqueada ou fora do fluxo de revisão.');
        }
        if (message.includes('ICMS_ST_SETTLEMENT_REVIEW_FORBIDDEN')) {
          throw new ErroDeDominio(CODIGOS_DE_ERRO.ICMS_ST_SETTLEMENT_REVIEW_FORBIDDEN, 'Papel sem alçada para esta ação.');
        }
        if (message.includes('ICMS_ST_SETTLEMENT_NOT_FOUND')) {
          throw new ErroDeDominio(CODIGOS_DE_ERRO.ICMS_ST_SETTLEMENT_NOT_FOUND, 'Apuração não encontrada.');
        }
        throw error;
      }
      return { snapshotId, revision: expectedRevision, action };
    });
  }
}

export const settlementCoverageBlocksReview = (facts: unknown): boolean => motivosDeBloqueio(facts).length > 0;
