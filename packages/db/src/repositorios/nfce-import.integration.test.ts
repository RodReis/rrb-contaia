import { contextoHumano, contextoTecnico } from '@contaia/domain';
import { afterAll,beforeAll,describe,expect,it } from 'vitest';
import { criarPool,criarPoolDaAplicacao } from '../client.js';
import { comContexto } from '../contexto.js';
import { limparCenario,montarCenario,type Cenario } from '../testes/cenario-rls.js';
import { criarLoteNfce,consultarLoteNfce,finalizarLoteNfce,obterOriginalEventoCancelamentoNfce } from './nfce-import.js';

const admin=criarPool();const app=criarPoolDaAplicacao();let c:Cenario;
beforeAll(async()=>{c=await montarCenario(admin);},60_000);
afterAll(async()=>{await limparCenario(admin,c);await Promise.all([admin.end(),app.end()]);});

describe('repositório F30 de NFC-e',()=>{
  it('preserva escopo por carteira e rejeita mutação de evento fiscal',async()=>{
    const company=await admin.query<{id:string;cnpj:string}>(`insert into app.empresa(tenant_id,cnpj,razao_social,status,situacao) values($1,$2,'NFC-e teste','ATIVA','ativo') returning id,cnpj`,[c.tenantA,`9${String(Date.now()).slice(-13)}`]);
    const co=company.rows[0]!;
    await admin.query(`insert into app.carteira_vinculo(tenant_id,usuario_id,empresa_id) values($1,$2,$3)`,[c.tenantA,c.usuarios.naCarteira,co.id]);
    const bytes=Buffer.from('<fixture/>');const hash='a'.repeat(64);const key=`${c.tenantA}/${co.id}/nfce/${hash}.xml`;
    const batch=await comContexto(app,contextoHumano({tenantId:c.tenantA,usuarioId:c.usuarios.naCarteira,correlationId:'f30-db-test-create'}),client=>criarLoteNfce(client,{tenantId:c.tenantA,companyId:co.id,actorId:c.usuarios.naCarteira,correlationId:'f30-db-test-create',source:'PORTAL_GO',items:[{name:'teste.xml',size:bytes.length,hash,key,bytes}]}));
    expect(batch.itemIds).toHaveLength(1);
    await comContexto(app,contextoHumano({tenantId:c.tenantA,usuarioId:c.usuarios.naCarteira,correlationId:'f30-db-test-terminal'}),client=>client.query(`update app.nfce_import_batch set status='COMPLETED_WITH_REJECTIONS' where id=$1`,[batch.batchId]));
    const repeats=await Promise.all([1,2].map(index=>comContexto(app,contextoHumano({tenantId:c.tenantA,usuarioId:c.usuarios.naCarteira,correlationId:`f30-db-test-repeat-${index}`}),client=>criarLoteNfce(client,{tenantId:c.tenantA,companyId:co.id,actorId:c.usuarios.naCarteira,correlationId:`f30-db-test-repeat-${index}`,source:'PORTAL_GO',items:[{name:'teste.xml',size:bytes.length,hash,key,bytes}]}))));
    expect(repeats).toEqual([1,2].map(()=>({batchId:batch.batchId,reused:true,itemIds:[]})));
    const duplicateHash='b'.repeat(64);const duplicateKey=`${c.tenantA}/${co.id}/nfce/${duplicateHash}.xml`;
    const duplicate=await comContexto(app,contextoHumano({tenantId:c.tenantA,usuarioId:c.usuarios.naCarteira,correlationId:'f30-db-test-duplicate'}),client=>criarLoteNfce(client,{tenantId:c.tenantA,companyId:co.id,actorId:c.usuarios.naCarteira,correlationId:'f30-db-test-duplicate',source:'PORTAL_GO',items:[{name:'a.xml',size:bytes.length,hash:duplicateHash,key:duplicateKey,bytes},{name:'b.xml',size:bytes.length,hash:duplicateHash,key:duplicateKey,bytes}]}));
    expect(duplicate.itemIds).toHaveLength(2);
    const duplicateBatch=await comContexto(app,contextoHumano({tenantId:c.tenantA,usuarioId:c.usuarios.naCarteira,correlationId:'f30-db-test-duplicate-read'}),client=>consultarLoteNfce(client,co.id,duplicate.batchId));
    expect(duplicateBatch?.itens.map(item=>item['status']).sort()).toEqual(['QUEUED','REJECTED']);
    const partialStatus=await comContexto(app,contextoHumano({tenantId:c.tenantA,usuarioId:c.usuarios.naCarteira,correlationId:'f30-db-test-partial'}),async client=>{await client.query(`update app.nfce_import_item set status='IMPORTED' where batch_id=$1 and status='QUEUED'`,[duplicate.batchId]);await finalizarLoteNfce(client,duplicate.batchId);return client.query<{status:string}>('select status from app.nfce_import_batch where id=$1',[duplicate.batchId]);});
    expect(partialStatus.rows[0]?.status).toBe('COMPLETED_WITH_REJECTIONS');
    const rejectedStatus=await comContexto(app,contextoHumano({tenantId:c.tenantA,usuarioId:c.usuarios.naCarteira,correlationId:'f30-db-test-rejected'}),async client=>{await client.query(`update app.nfce_import_item set status='REJECTED' where batch_id=$1`,[duplicate.batchId]);await finalizarLoteNfce(client,duplicate.batchId);return client.query<{status:string}>('select status from app.nfce_import_batch where id=$1',[duplicate.batchId]);});
    expect(rejectedStatus.rows[0]?.status).toBe('REJECTED');
    const visible=await comContexto(app,contextoHumano({tenantId:c.tenantA,usuarioId:c.usuarios.naCarteira,correlationId:'f30-db-test-read'}),client=>consultarLoteNfce(client,co.id,batch.batchId));
    expect(visible?.itens).toHaveLength(1);
    const denied=await comContexto(app,contextoHumano({tenantId:c.tenantA,usuarioId:c.usuarios.fora,correlationId:'f30-db-test-deny'}),client=>consultarLoteNfce(client,co.id,batch.batchId));
    expect(denied).toBeNull();
    const source=await comContexto(app,contextoHumano({tenantId:c.tenantA,usuarioId:c.usuarios.naCarteira,correlationId:'f30-db-test-source'}),client=>client.query<{id:string}>('select id from app.nfce_import_source where item_id=$1',[batch.itemIds[0]]));
    expect(source.rows).toHaveLength(1);
    const staleSignal=await comContexto(app,contextoTecnico({identidadeTecnica:'worker-nfce',finalidade:'IMPORTACAO_NFCE',tenantId:c.tenantA,empresaId:co.id,correlationId:'f30-db-test-stale'}),client=>client.query<{count:number}>(`select app.tax_st_settlement_mark_stale($1,'2026-10-01',$2,'f30-db-test-stale',$3)::integer as count`,[co.id,c.usuarios.admin,'00000000-0000-4000-8000-000000000001']));
    expect(staleSignal.rows[0]?.count).toBe(0);
    await comContexto(app,contextoHumano({tenantId:c.tenantA,usuarioId:c.usuarios.naCarteira,correlationId:'f30-db-test-event-insert'}),client=>client.query(`insert into app.nfce_import_event(tenant_id,empresa_id,item_id,source_id,chave_acesso,cnpj,ambiente,tipo,sequencia,protocolo,hash_sha256,original_key,tamanho_bytes,correlation_id)
      values($1,$2,$3,$4,repeat('1',44),$5,'PRODUCAO','110111','1','152260000000001',$6,$7,1,'f30-db-test-event')`,[c.tenantA,co.id,batch.itemIds[0],source.rows[0]?.id,co.cnpj,'c'.repeat(64),key]));
    const visibleEvent=await comContexto(app,contextoHumano({tenantId:c.tenantA,usuarioId:c.usuarios.naCarteira,correlationId:'f30-db-test-event-read'}),client=>client.query('select id from app.nfce_import_event where item_id=$1',[batch.itemIds[0]]));
    expect(visibleEvent.rows).toHaveLength(1);
    const eventOriginal=await comContexto(app,contextoHumano({tenantId:c.tenantA,usuarioId:c.usuarios.naCarteira,correlationId:'f30-db-test-event-original'}),client=>obterOriginalEventoCancelamentoNfce(client,co.id,batch.itemIds[0]!));
    expect(eventOriginal).toMatchObject({original_key:key,hash_sha256:'c'.repeat(64),source_id:source.rows[0]?.id,document_id:null});
    await expect(comContexto(app,contextoHumano({tenantId:c.tenantA,usuarioId:c.usuarios.naCarteira,correlationId:'f30-db-test-event-duplicate'}),client=>client.query(`insert into app.nfce_import_event(tenant_id,empresa_id,item_id,source_id,chave_acesso,cnpj,ambiente,tipo,sequencia,protocolo,hash_sha256,original_key,tamanho_bytes,correlation_id)
      values($1,$2,$3,$4,repeat('1',44),$5,'PRODUCAO','110111','1','152260000000001',$6,$7,1,'f30-db-test-event-duplicate')`,[c.tenantA,co.id,batch.itemIds[0],source.rows[0]?.id,co.cnpj,'d'.repeat(64),key]))).rejects.toMatchObject({code:'23505'});
    const deniedEvent=await comContexto(app,contextoHumano({tenantId:c.tenantA,usuarioId:c.usuarios.fora,correlationId:'f30-db-test-event-deny'}),client=>client.query('select id from app.nfce_import_event where item_id=$1',[batch.itemIds[0]]));
    expect(deniedEvent.rows).toHaveLength(0);
    await expect(comContexto(app,contextoTecnico({identidadeTecnica:'worker-nfce',finalidade:'IMPORTACAO_NFCE',tenantId:c.tenantA,empresaId:co.id,correlationId:'f30-db-test-event-delete'}),client=>client.query('delete from app.nfce_import_event where item_id=$1',[batch.itemIds[0]]))).rejects.toMatchObject({code:'42501'});
    await expect(comContexto(app,contextoTecnico({identidadeTecnica:'worker-nfce',finalidade:'IMPORTACAO_NFCE',tenantId:c.tenantA,empresaId:co.id,correlationId:'f30-db-test-delete'}),client=>client.query(`delete from app.fiscal_document_event where nfce_source_id=$1`,[source.rows[0]?.id]))).rejects.toMatchObject({code:'42501'});
  });
});
