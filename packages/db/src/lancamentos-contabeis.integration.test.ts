import type {PoolClient} from 'pg';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {criarPool,criarPoolDaAplicacao} from './client.js';
import {comContextoHumano} from './contexto.js';
import {limparCenario,montarCenario,type Cenario} from './testes/cenario-rls.js';

const admin=criarPool();const app=criarPoolDaAplicacao();let c:Cenario;let contaId:string;let entryId:string;const ano=2098;
const comoA=<T>(run:(client:PoolClient)=>Promise<T>)=>comContextoHumano(app,{tenantId:c.tenantA,usuarioId:c.usuarios.naCarteira,correlationId:'f40-integration'},run);
const codigo=()=>`F40-${c.sufixo}-${crypto.randomUUID()}`;

beforeAll(async()=>{c=await montarCenario(admin);const id=await comoA(async client=>{
  const conta=await client.query<{id:string}>(`insert into app.conta_contabil(tenant_id,empresa_id,codigo,nome,tipo,natureza,classe_contabil,politica_centro_custo) values($1,$2,$3,'Conta F40','analitica','devedora','ASSET','OPTIONAL') returning id`,[c.tenantA,c.empresaA1,codigo()]);
  const lancamento=await client.query<{id:string}>(`insert into app.lancamento_contabil(tenant_id,empresa_id,exercicio,data_contabil,competencia,historico,criado_por) values($1,$2,$3,$4,$5,'Prova F40',$6) returning id`,[c.tenantA,c.empresaA1,ano,`${ano}-01-15`,`${ano}-01`,c.usuarios.naCarteira]);return{conta:conta.rows[0]!.id,lancamento:lancamento.rows[0]!.id};
});contaId=id.conta;entryId=id.lancamento;},60_000);
afterAll(async()=>{if(c)await limparCenario(admin,c);await Promise.all([admin.end(),app.end()]);});

describe('F40: lançamentos contábeis no PostgreSQL',()=>{
  it('isola lançamentos e partidas pela empresa e pelo tenant',async()=>{
    await comoA(client=>client.query(`insert into app.lancamento_contabil_partida(tenant_id,empresa_id,lancamento_id,conta_id,lado,valor_centavos,posicao) values($1,$2,$3,$4,'DEBIT',1200,0)`,[c.tenantA,c.empresaA1,entryId,contaId]));
    const visivel=await comoA(async client=>(await client.query(`select id from app.lancamento_contabil where id=$1`,[entryId])).rowCount);
    const fora=await comContextoHumano(app,{tenantId:c.tenantA,usuarioId:c.usuarios.fora},async client=>(await client.query(`select id from app.lancamento_contabil where id=$1`,[entryId])).rowCount);
    const outroTenant=await comContextoHumano(app,{tenantId:c.tenantB,usuarioId:c.usuarios.deB},async client=>(await client.query(`select id from app.lancamento_contabil where id=$1`,[entryId])).rowCount);
    expect(visivel).toBe(1);expect(fora).toBe(0);expect(outroTenant).toBe(0);
  });
  it('reverte sequência ao falhar validação diferida e efetiva somente lançamento balanceado',async()=>{
    const falha=await comContextoHumano(app,{tenantId:c.tenantA,usuarioId:c.usuarios.naCarteira,correlationId:'f40-rollback'},async client=>{
      await client.query(`insert into app.lancamento_contabil_sequencia(tenant_id,empresa_id,exercicio,ultimo_numero) values($1,$2,$3,1)`,[c.tenantA,c.empresaA1,ano]);
      await client.query(`select set_config('app.lancamento_contabil_transicao','true',true)`);
      await client.query(`update app.lancamento_contabil set estado='POSTED',numero=1,efetivado_por=$1 where id=$2`,[c.usuarios.naCarteira,entryId]);
    }).then(()=>false,()=>true);
    expect(falha).toBe(true);const inexistente=await admin.query(`select 1 from app.lancamento_contabil_sequencia where tenant_id=$1 and empresa_id=$2 and exercicio=$3`,[c.tenantA,c.empresaA1,ano]);expect(inexistente.rowCount).toBe(0);
    const efetivado=await comContextoHumano(app,{tenantId:c.tenantA,usuarioId:c.usuarios.naCarteira,correlationId:'f40-post'},async client=>{
      await client.query(`insert into app.lancamento_contabil_partida(tenant_id,empresa_id,lancamento_id,conta_id,lado,valor_centavos,posicao) values($1,$2,$3,$4,'CREDIT',1200,1)`,[c.tenantA,c.empresaA1,entryId,contaId]);
      const seq=await client.query<{ultimo_numero:number}>(`insert into app.lancamento_contabil_sequencia(tenant_id,empresa_id,exercicio,ultimo_numero) values($1,$2,$3,1) returning ultimo_numero`,[c.tenantA,c.empresaA1,ano]);
      await client.query(`select set_config('app.lancamento_contabil_transicao','true',true)`);await client.query(`update app.lancamento_contabil set estado='POSTED',numero=$1,efetivado_por=$2 where id=$3`,[seq.rows[0]!.ultimo_numero,c.usuarios.naCarteira,entryId]);return seq.rows[0]!.ultimo_numero;
    });
    expect(Number(efetivado)).toBe(1);
    await expect(comoA(client=>client.query(`update app.lancamento_contabil_partida set valor_centavos=valor_centavos where lancamento_id=$1`,[entryId]))).rejects.toMatchObject({code:'23001'});
  });
});
