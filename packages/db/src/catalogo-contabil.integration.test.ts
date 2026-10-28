import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarPool, criarPoolDaAplicacao } from './client.js';
import { comContextoHumano, semContexto } from './contexto.js';
import { limparCenario, montarCenario, type Cenario } from './testes/cenario-rls.js';

const admin=criarPool(); const app=criarPoolDaAplicacao(); let c:Cenario; let accountId:string; let centerId:string; let eventId:string;
const comoA=<T>(run:(client:PoolClient)=>Promise<T>)=>comContextoHumano(app,{tenantId:c.tenantA,usuarioId:c.usuarios.naCarteira,correlationId:'f39-test'},run);
const codeError=async(run:()=>Promise<unknown>):Promise<string>=>{try{await run();return 'none';}catch(error){return (error as {code?:string}).code??'unknown';}};

beforeAll(async()=>{
  c=await montarCenario(admin);
  const ids=await comoA(async(client)=>{
    const acc=await client.query<{id:string}>(`insert into app.conta_contabil(tenant_id,empresa_id,codigo,nome,tipo,natureza,classe_contabil,politica_centro_custo) values($1,$2,$3,'Caixa','analitica','devedora','ASSET','OPTIONAL') returning id`,[c.tenantA,c.empresaA1,`A-${c.sufixo}`]);
    const center=await client.query<{id:string}>(`insert into app.centro_custo(tenant_id,empresa_id,codigo,nome,tipo) values($1,$2,$3,'Operação','sintetica') returning id`,[c.tenantA,c.empresaA1,`C-${c.sufixo}`]);
    const event=await client.query<{id:string}>(`insert into app.catalogo_contabil_evento(tenant_id,empresa_id,catalogo,item_id,codigo_item,acao,resultado,usuario_id,correlation_id) values($1,$2,'CONTA',$3,$4,'CRIACAO','SUCESSO',$5,'f39-test') returning id`,[c.tenantA,c.empresaA1,acc.rows[0]?.id,`A-${c.sufixo}`,c.usuarios.naCarteira]);
    return {account:acc.rows[0]?.id,center:center.rows[0]?.id,event:event.rows[0]?.id};
  });
  accountId=String(ids.account); centerId=String(ids.center); eventId=String(ids.event);
},60_000);

afterAll(async()=>{if(c)await limparCenario(admin,c);await Promise.all([admin.end(),app.end()]);});

describe('F39: isolamento e catálogo contábil no PostgreSQL',()=>{
  it('mantém as tabelas sob RLS por tenant e carteira',async()=>{
    const leitura=async(empresaId:string)=>comoA(async(client)=>{
      const {rows}=await client.query('select id from app.conta_contabil where id=$1 and empresa_id=$2',[accountId,empresaId]);return rows.length;
    });
    expect(await leitura(c.empresaA1)).toBe(1);
    expect(await comContextoHumano(app,{tenantId:c.tenantB,usuarioId:c.usuarios.deB},async(client)=>(await client.query('select id from app.conta_contabil where id=$1',[accountId])).rows.length)).toBe(0);
    expect(await comContextoHumano(app,{tenantId:c.tenantA,usuarioId:c.usuarios.fora},async(client)=>(await client.query('select id from app.conta_contabil where id=$1',[accountId])).rows.length)).toBe(0);
    expect(await semContexto(app,async(client)=>(await client.query('select id from app.conta_contabil where id=$1',[accountId])).rows.length)).toBe(0);
  });

  it('proíbe reuso de código normalizado e edição da trilha append-only',async()=>{
    const conflito=await codeError(()=>comoA((client)=>client.query(`insert into app.centro_custo(tenant_id,empresa_id,codigo,nome,tipo) values($1,$2,$3,'Duplicado','analitica')`,[c.tenantA,c.empresaA1,` c-${c.sufixo} `])));
    expect(conflito).toBe('23505');
    expect(await codeError(()=>comoA((client)=>client.query('update app.catalogo_contabil_evento set acao=acao where id=$1',[eventId])))).toBe('42501');
    expect(centerId).not.toBe('');
  });

  it('impede referência hierárquica cruzada entre empresas no FK composto',async()=>{
    const cruzada=await codeError(()=>comContextoHumano(app,{tenantId:c.tenantA,usuarioId:c.usuarios.duasEmpresas},(client)=>client.query(`insert into app.centro_custo(tenant_id,empresa_id,codigo,nome,tipo,centro_pai) values($1,$2,$3,'Fora','analitica',$4)`,[c.tenantA,c.empresaA2,`X-${randomUUID()}`,`C-${c.sufixo}`])));
    expect(cruzada).toBe('23503');
  });
});
