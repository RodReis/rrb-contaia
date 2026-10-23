import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarPool, criarPoolDaAplicacao } from './client.js';
import { comContextoHumano } from './contexto.js';
import { limparCenario, montarCenario } from './testes/cenario-rls.js';
import { FIXTURES } from './testes/fixtures-rls.js';

const admin=criarPool();
const app=criarPoolDaAplicacao();
let cenario:Awaited<ReturnType<typeof montarCenario>>;

beforeAll(async()=>{cenario=await montarCenario(admin);},120_000);
afterAll(async()=>{if(cenario)await limparCenario(admin,cenario);await Promise.all([admin.end(),app.end()]);});

describe('revisão humana de devolução F32',()=>{
  it('auxiliar submete, contador aprova, função grava estorno e a trilha não aceita edição',async()=>{
    const fixture=FIXTURES['app.tax_st_return_event'];
    if(!fixture?.preparar)throw new Error('fixture de devolução F32 ausente');
    const refs=await fixture.preparar(admin,{tenantId:cenario.tenantA,empresaId:cenario.empresaA1,autorId:cenario.usuarios.naCarteira,sufixo:cenario.sufixo});
    const eventResult=await admin.query<{id:string}>(`insert into app.tax_st_return_event(tenant_id,empresa_id,original_snapshot_id,original_line_id,origin,
      return_document_identity,return_item_identity,event_date,idempotency_key,normalized_unit,returned_quantity_scaled,evidence_sha256,evidence_facts,actor_id,correlation_id,occurred_at)
      values($1,$2,$3,$4,'MANUAL_DOCUMENT',$5,'1','2017-02-01',$6,'UN',1,repeat('f',64),'{"formulaVersion":"F32_FIXTURE","sourceIds":["fixture"]}'::jsonb,$7,'f32-review',now()) returning id`,
      [cenario.tenantA,cenario.empresaA1,refs['snapshotId'],refs['lineId'],`f32-return-${randomUUID()}`,randomUUID(),cenario.usuarios.naCarteira]);
    const eventId=eventResult.rows[0]?.id;
    if(!eventId)throw new Error('evento de devolução F32 ausente');
    const auxiliaryResult=await admin.query<{id:string}>(`insert into app.usuario(tenant_id,sub_oidc,email,nome,estado)
      values($1,$2,$3,'Auxiliar F32','ATIVO') returning id`,[cenario.tenantA,`f32-aux-${cenario.sufixo}`,`f32-aux-${cenario.sufixo}@matriz.local`]);
    const auxiliar=auxiliaryResult.rows[0]?.id;
    if(!auxiliar)throw new Error('usuário auxiliar F32 ausente');
    await admin.query('insert into app.carteira_vinculo(tenant_id,usuario_id,empresa_id) values($1,$2,$3)',[cenario.tenantA,auxiliar,cenario.empresaA1]);
    await admin.query("insert into app.usuario_papel(tenant_id,usuario_id,papel) values($1,$2,'auxiliar') on conflict do nothing",[cenario.tenantA,auxiliar]);
    await admin.query("insert into app.usuario_papel(tenant_id,usuario_id,papel) values($1,$2,'contador') on conflict do nothing",[cenario.tenantA,cenario.usuarios.naCarteira]);
    const submit=async(userId:string,action:'SUBMITTED'|'APPROVED')=>comContextoHumano(app,{tenantId:cenario.tenantA,usuarioId:userId,correlationId:`f32-review-${action}`},async(client)=>
      client.query('select app.tax_st_return_review($1::uuid,$2::uuid,$3::uuid,$4::timestamptz,$5::text,$6::text,$7::text)',
        [eventId,cenario.empresaA1,userId,new Date(),action,null,`f32-review-${action}`]));
    await submit(auxiliar,'SUBMITTED');
    await expect(submit(auxiliar,'APPROVED')).rejects.toThrow('ICMS_ST_RETURN_REVIEW_FORBIDDEN');
    await submit(cenario.usuarios.naCarteira,'APPROVED');
    const reversal=await comContextoHumano(app,{tenantId:cenario.tenantA,usuarioId:cenario.usuarios.naCarteira,correlationId:'f32-finalize'},async(client)=>
      client.query<{id:string}>('select app.tax_st_return_finalize($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::date,$6::numeric,$7::numeric,$8::bigint,$9::bigint,$10::text,$11::timestamptz) id',
        [eventId,cenario.tenantA,cenario.empresaA1,cenario.usuarios.naCarteira,'2017-02-01',1,0,0,0,'f32-finalize',new Date()]));
    expect(reversal.rows[0]?.id).toBeTruthy();
    const reviews=await admin.query<{action:string}>('select action from app.tax_st_return_review_event where return_event_id=$1 order by occurred_at,id',[eventId]);
    expect(reviews.rows.map(row=>row.action)).toEqual(['SUBMITTED','APPROVED']);
    await expect(admin.query("update app.tax_st_return_review_event set action='REJECTED' where return_event_id=$1",[eventId])).rejects.toThrow();
    await expect(admin.query('delete from app.tax_st_return_review_event where return_event_id=$1',[eventId])).rejects.toThrow();
  },30_000);
});
