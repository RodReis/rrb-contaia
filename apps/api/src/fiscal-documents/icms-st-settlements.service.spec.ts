import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';

const state=vi.hoisted(()=>({query:vi.fn(),approved:true,prior:false,unit:'UN',quantity:'30000000000',kind:'RESTITUTION',restitution:'10',complement:null as string|null}));
vi.mock('@contaia/db',()=>({
  comContextoHumano:(_pool:unknown,_context:unknown,operation:(client:{query:typeof state.query})=>unknown)=>operation({query:state.query}),
  getDfeCaptureCompany:vi.fn(),listarHistoricoRegimeTributario:vi.fn(),
}));

import { IcmsStSettlementsService } from './icms-st-settlements.service.js';

const createService=()=>{
  state.query.mockImplementation(async(sql:string)=>{
    if(sql.includes('select exists(select 1 from app.usuario u join app.usuario_papel'))return {rows:[{allowed:true}]};
    if(sql.includes('from app.tax_st_return_event e join app.tax_st_return_reversal'))return {rows:state.prior?[{id:'existing',evidence_sha256:createHash('sha256').update('fixture').digest('hex'),competence:'2019-02-01',returned_quantity_scaled:'10000000000',
      remaining_quantity_scaled:'20000000000',reversed_restitution_cents:'3',reversed_complement_cents:'0',original_line_id:'line',normalized_unit:'UN',requested_quantity:'10000000000',
      origin:'MANUAL_DOCUMENT',return_document_identity:'devolucao-original',return_item_identity:'1',event_date:'2019-02-03'}]:[]};
    if(sql.includes('select l.difference_kind kind'))return {rows:[{kind:state.kind,restitution:state.restitution,complement:state.complement,
      facts:{quantityScaled:state.quantity,unit:state.unit,factDate:'2017-01-01'},calculation:{formulaVersion:'RULE-1'},unit:state.unit,
      source_ids:[],snapshot_id:'snapshot',revision:1,approved:state.approved,stale:false}]};
    if(sql.includes('sum(returned_quantity_scaled)'))return {rows:[{quantity:'0'}]};
    if(sql.includes('insert into app.tax_st_return_event'))return {rows:[{id:'event'}]};
    return {rows:[]};
  });
  const storage={enviarComChave:vi.fn().mockResolvedValue(undefined)};
  return {service:new IcmsStSettlementsService({instancia:{} as never} as never,storage as never),storage};
};

afterEach(()=>{vi.clearAllMocks();state.approved=true;state.prior=false;state.unit='UN';state.quantity='30000000000';state.kind='RESTITUTION';state.restitution='10';state.complement=null;});

describe('registro de devolução F32',()=>{
  it('usa linha aprovada, trava saldo, guarda anexo privado e rateia centavos por quantidade',async()=>{
    const {service,storage}=createService();
    const result=await service.registerManualReturn('tenant','user','company',{originalSnapshotId:'snapshot',originalLineId:'line',
      returnDocumentIdentity:'devolucao-1',returnItemIdentity:'1',eventDate:'2019-02-03',unit:'UN',returnedQuantityScaled:'10000000000',
      idempotencyKey:'00000000-0000-4000-8000-000000000001'},
      {nomeOriginal:'comprovante.pdf',tipoConteudo:'application/pdf',conteudo:Buffer.from('fixture')},'correlation');
    expect(result).toMatchObject({competence:'2019-02-01',returnedQuantityScaled:'10000000000',remainingQuantityScaled:'20000000000',reversedRestitutionCents:3,reversedComplementCents:0});
    expect(storage.enviarComChave).toHaveBeenCalledOnce();
    expect(state.query).toHaveBeenCalledWith(expect.stringContaining('pg_advisory_xact_lock'),expect.any(Array));
  });

  it('recusa linha sem aprovação sem enviar o anexo',async()=>{
    state.approved=false;
    const {service,storage}=createService();
    await expect(service.registerManualReturn('tenant','user','company',{originalSnapshotId:'snapshot',originalLineId:'line',
      returnDocumentIdentity:'devolucao-1',returnItemIdentity:'1',eventDate:'2019-02-03',unit:'UN',returnedQuantityScaled:'10000000000',
      idempotencyKey:'00000000-0000-4000-8000-000000000001'},
      {nomeOriginal:'comprovante.pdf',tipoConteudo:'application/pdf',conteudo:Buffer.from('fixture')},'correlation'))
      .rejects.toMatchObject({codigo:'ICMS_ST_REVISION_STALE'});
    expect(storage.enviarComChave).not.toHaveBeenCalled();
  });

  it('rejeita reutilização da idempotência com outra identidade fiscal antes do upload',async()=>{
    state.prior=true;
    const {service,storage}=createService();
    await expect(service.registerManualReturn('tenant','user','company',{originalSnapshotId:'snapshot',originalLineId:'line',
      returnDocumentIdentity:'documento-divergente',returnItemIdentity:'1',eventDate:'2019-02-03',unit:'UN',returnedQuantityScaled:'10000000000',
      idempotencyKey:'00000000-0000-4000-8000-000000000001'},
      {nomeOriginal:'comprovante.pdf',tipoConteudo:'application/pdf',conteudo:Buffer.from('fixture')},'correlation'))
      .rejects.toMatchObject({codigo:'CONFLITO_DE_VERSAO'});
    expect(storage.enviarComChave).not.toHaveBeenCalled();
  });
});
