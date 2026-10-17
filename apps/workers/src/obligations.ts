import { randomUUID } from 'node:crypto';

import { comContexto, gerarOcorrenciasPublicadas } from '@contaia/db';
import { contextoTecnico } from '@contaia/domain';
import type { Pool } from 'pg';
import type { ConexaoDoRedis } from '@contaia/signer-client';

type Dependencias = Readonly<{ pool:Pool; schedulerPool:Pool; conexao:ConexaoDoRedis; agora?:()=>Date; intervaloMs?:number }>;

export const iniciarAgendadorDeObrigacoes = (deps:Dependencias):Readonly<{fechar:()=>Promise<void>}> => {
  const agora=deps.agora??(()=>new Date());
  let rodando=false;
  const executar=async()=>{
    if(rodando)return;rodando=true;
    try{
      const candidates=await deps.schedulerPool.query<{tenant_id:string;empresa_id:string}>('select * from app.obligation_companies_pending(500)');
      for(const candidate of candidates.rows){
        const correlationId=`obligations-${randomUUID()}`;
        const ctx=contextoTecnico({identidadeTecnica:'workers-dfe-capture',finalidade:'PROCESSAMENTO_DE_EMPRESA',tenantId:candidate.tenant_id,empresaId:candidate.empresa_id,correlationId});
        await comContexto(deps.pool,ctx,async client=>{
          const local=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(agora());
          const ano=Number(local.slice(0,4)),mes=Number(local.slice(5,7));
          const mesAtual=`${ano}-${String(mes).padStart(2,'0')}`;
          const dataProximo=new Date(Date.UTC(ano,mes,1));
          const proximo=`${dataProximo.getUTCFullYear()}-${String(dataProximo.getUTCMonth()+1).padStart(2,'0')}`;
          await gerarOcorrenciasPublicadas(client,candidate.tenant_id,mesAtual,local);
          await gerarOcorrenciasPublicadas(client,candidate.tenant_id,proximo,local);
        });
      }
      const outbox=await deps.schedulerPool.query<{id:string;tenant_id:string;empresa_id:string;canal:string;tentativas:number;correlation_id:string}>('select * from app.obligation_publishable_outbox(200)');
      for(const item of outbox.rows){
        const ctx=contextoTecnico({identidadeTecnica:'workers-dfe-capture',finalidade:'PROCESSAMENTO_DE_EMPRESA',tenantId:item.tenant_id,empresaId:item.empresa_id,correlationId:item.correlation_id});
        await comContexto(deps.pool,ctx,async client=>{
          const claim=await client.query(`update app.obligation_channel_outbox set estado='PROCESSANDO',tentativas=tentativas+1,atualizado_em=now() where id=$1 and estado in ('PENDENTE','RETRY') returning id`,[item.id]);
          if(!claim.rowCount)return;
          try{
            // Adaptadores locais dublados: registram entrega técnica independente por canal;
            // não chamam provedor nem destinatário real.
            await client.query(`update app.obligation_channel_outbox set estado='ENTREGUE_LOCAL',erro_sanitizado=null,proxima_tentativa_em=null,atualizado_em=now() where id=$1`,[item.id]);
          }catch{
            const tentativas=item.tentativas+1;const esgotado=tentativas>=5;const espera=Math.min(60*2**tentativas,3600);
            await client.query(`update app.obligation_channel_outbox set estado=$2,erro_sanitizado='ADAPTADOR_LOCAL_INDISPONIVEL',proxima_tentativa_em=case when $2='RETRY' then now()+($3||' seconds')::interval else null end,atualizado_em=now() where id=$1`,[item.id,esgotado?'ESGOTADO':'RETRY',espera]);
          }
        });
      }
    }catch(error){console.error(JSON.stringify({event:'obligations-scheduler-error',name:error instanceof Error?error.name:'UnknownError'}));}
    finally{rodando=false;}
  };
  const timer=setInterval(()=>void executar(),deps.intervaloMs??60_000);void executar();
  return {fechar:async()=>{clearInterval(timer);while(rodando)await new Promise(resolve=>setTimeout(resolve,10));}};
};
