import { createHash } from 'node:crypto';
import { comContexto, preservarXmlCompletoRecuperado, registrarTentativaDaCiencia, transicionarCienciaDaEmissao, type CienciaDaEmissao } from '@contaia/db';
import { contextoTecnico } from '@contaia/domain';
import { ComandoCienciaDfeSchema, ComandoConsultarProcNFeSchema, type RespostaCienciaDfe, type RespostaConsultarProcNFe, type ComandoCienciaDfe, type ComandoConsultarProcNFe, FiscalAcknowledgementCommandSchema, FISCAL_ACKNOWLEDGEMENT_QUEUE, FISCAL_ACKNOWLEDGEMENT_DLQ, tempoDeRetryDaCiencia } from '@contaia/shared';
import { parsearDocumentoFiscal } from '@contaia/shared/fiscal-document-parser';
import { Queue, Worker, type Job } from 'bullmq';
import type { Pool } from 'pg';
import type { ConexaoDoRedis } from '@contaia/signer-client';
import { criarConexaoRedis } from './redis.js';

type ClienteSigner = Readonly<{
  manifestarCiencia: (command: ComandoCienciaDfe) => Promise<RespostaCienciaDfe>;
  consultarProcNFe: (command: ComandoConsultarProcNFe) => Promise<RespostaConsultarProcNFe>;
}>;
type Dependencias = Readonly<{ pool: Pool; schedulerPool: Pool; conexao: ConexaoDoRedis; signer: ClienteSigner; agora: () => Date; prefixo?: string }>;
type Pendente = CienciaDaEmissao & Readonly<{ etapa: 'CIENCIA' | 'RECUPERACAO_XML'; cnpj: string }>;

const chaveIdempotente = (tenantId: string, companyId: string, key: string, etapa: string) =>
  `ack-${createHash('sha256').update(`${tenantId}:${companyId}:${key}:210210:1:${etapa}`).digest('hex').slice(0,48)}`;

const comandoBase = (row: Pendente) => ({ tenantId: row.tenant_id, empresaId: row.empresa_id, cnpj: row.cnpj,
  chaveAcesso: row.chave_acesso, correlationId: row.correlation_id });

const executarCiencia = async (deps: Dependencias, row: Pendente, agora: Date): Promise<void> => {
  const ctx = contextoTecnico({ identidadeTecnica: 'worker', finalidade: 'PROCESSAMENTO_DE_EMPRESA', tenantId: row.tenant_id, empresaId: row.empresa_id, correlationId: row.correlation_id });
  const tentativa = row.tentativas_ciencia_ciclo + 1;
  const tentativaHistorica = row.tentativas_ciencia + 1;
  if (tentativa > 3) {
    await comContexto(deps.pool,ctx,(client) => transicionarCienciaDaEmissao(client,{ tenantId:row.tenant_id,empresaId:row.empresa_id,acknowledgementId:row.id,estado:'DLQ',codigo:'FISCAL_ACK_RETRY_EXHAUSTED',correlationId:row.correlation_id }));
    return;
  }
  const claimed=await comContexto(deps.pool,ctx,async (client) => {
    const claimed=await client.query(`update app.fiscal_acknowledgement set estado='CIENCIA_EM_ENVIO',atualizado_em=now() where id=$1 and estado in ('CIENCIA_PENDENTE','RESULTADO_INCERTO') returning id`,[row.id]);
    if(!claimed.rowCount) throw new Error('FISCAL_ACK_ALREADY_CLAIMED');
    return true;
  });
  if(!claimed) return;
  let resposta: RespostaCienciaDfe;
  try {
    resposta = await deps.signer.manifestarCiencia(ComandoCienciaDfeSchema.parse({ ...comandoBase(row), tipoEvento:'210210', sequencia:1,
      ocorridoEm:row.solicitada_em.toISOString(), chaveIdempotente:chaveIdempotente(row.tenant_id,row.empresa_id,row.chave_acesso,'ciencia') }));
  } catch {
    resposta = { tipo:'INCERTO',codigo:'FISCAL_ACK_RESULT_UNCERTAIN',protocolo:null,chaveAcesso:row.chave_acesso,cnpj:row.cnpj,
      tipoEvento:'210210',sequencia:1,ambiente:'HOMOLOGACAO',recebidoEm:null };
  }
  const identityOk = resposta.chaveAcesso===row.chave_acesso && resposta.cnpj===row.cnpj && resposta.tipoEvento==='210210' && resposta.sequencia===1;
  const tipo = identityOk ? resposta.tipo : 'INCERTO';
  const resultado = tipo==='ACEITO' ? 'ACEITO' : tipo==='DUPLICIDADE' && resposta.protocolo ? 'DUPLICIDADE_CONCILIADA' : tipo==='JA_MANIFESTADO' ? 'JA_MANIFESTADO' : tipo==='REJEITADO' ? 'REJEITADO' : 'INCERTO';
  await comContexto(deps.pool,ctx,async (client) => {
    const atual=(await client.query<{estado:string}>(`select estado from app.fiscal_acknowledgement where id=$1 for update`,[row.id])).rows[0]?.estado;
    if(atual!=='CIENCIA_EM_ENVIO') return;
    await registrarTentativaDaCiencia(client,{ tenantId:row.tenant_id,empresaId:row.empresa_id,acknowledgementId:row.id,etapa:'CIENCIA',tentativa:tentativaHistorica,
      resultado,codigo:identityOk ? resposta.codigo : 'FISCAL_ACK_IDENTITY_MISMATCH',protocolo:resultado==='ACEITO'||resultado==='DUPLICIDADE_CONCILIADA' ? resposta.protocolo : null,
      ambiente:identityOk ? resposta.ambiente : null,correlationId:row.correlation_id,iniciadaEm:agora,finalizadaEm:deps.agora() });
    if (resultado==='ACEITO'||resultado==='DUPLICIDADE_CONCILIADA') {
      if (resultado==='DUPLICIDADE_CONCILIADA' && !resposta.protocolo) throw new Error('FISCAL_ACK_PROTOCOL_UNRECONCILED');
      await transicionarCienciaDaEmissao(client,{ tenantId:row.tenant_id,empresaId:row.empresa_id,acknowledgementId:row.id,estado:'CIENCIA_REGISTRADA',
        codigo:resposta.codigo,protocolo:resposta.protocolo,ambiente:resposta.ambiente,correlationId:row.correlation_id });
      await transicionarCienciaDaEmissao(client,{ tenantId:row.tenant_id,empresaId:row.empresa_id,acknowledgementId:row.id,estado:'XML_COMPLETO_PENDENTE',correlationId:row.correlation_id });
    } else if (resultado==='JA_MANIFESTADO') await transicionarCienciaDaEmissao(client,{ tenantId:row.tenant_id,empresaId:row.empresa_id,acknowledgementId:row.id,estado:'JA_MANIFESTADO',codigo:resposta.codigo,correlationId:row.correlation_id });
    else if (resultado==='REJEITADO') await transicionarCienciaDaEmissao(client,{ tenantId:row.tenant_id,empresaId:row.empresa_id,acknowledgementId:row.id,estado:'REJEITADO',codigo:resposta.codigo,correlationId:row.correlation_id });
    else {
      await transicionarCienciaDaEmissao(client,{ tenantId:row.tenant_id,empresaId:row.empresa_id,acknowledgementId:row.id,estado:'RESULTADO_INCERTO',codigo:'FISCAL_ACK_RESULT_UNCERTAIN',correlationId:row.correlation_id });
      if (tentativa>=3) await transicionarCienciaDaEmissao(client,{ tenantId:row.tenant_id,empresaId:row.empresa_id,acknowledgementId:row.id,estado:'DLQ',codigo:'FISCAL_ACK_RETRY_EXHAUSTED',correlationId:row.correlation_id });
      else {
        const next=new Date(deps.agora().getTime()+tempoDeRetryDaCiencia(tentativa));
        await transicionarCienciaDaEmissao(client,{ tenantId:row.tenant_id,empresaId:row.empresa_id,acknowledgementId:row.id,estado:'RETRY_AGENDADO',codigo:'FISCAL_ACK_RESULT_UNCERTAIN',proximaTentativaEm:next,correlationId:row.correlation_id });
        await transicionarCienciaDaEmissao(client,{ tenantId:row.tenant_id,empresaId:row.empresa_id,acknowledgementId:row.id,estado:'CIENCIA_PENDENTE',codigo:'FISCAL_ACK_RESULT_UNCERTAIN',proximaTentativaEm:next,correlationId:row.correlation_id });
      }
    }
  });
};
export const validarXmlCompletoRecuperado = (xml: string, chaveAcesso: string, cnpj: string): boolean => {
  try {
    const parsed = parsearDocumentoFiscal(Buffer.from(xml,'utf8'),'NFE_55');
    return parsed.chaveAcesso === chaveAcesso && parsed.partes.find((parte) => parte.papel === 'DESTINATARIO')?.identificador === cnpj;
  } catch {
    return false;
  }
};

const executarRecuperacao = async (deps: Dependencias, row: Pendente, agora: Date): Promise<void> => {
  const ctx = contextoTecnico({ identidadeTecnica: 'worker', finalidade: 'PROCESSAMENTO_DE_EMPRESA', tenantId: row.tenant_id, empresaId: row.empresa_id, correlationId: row.correlation_id });
  const jaDisponivel = await comContexto(deps.pool,ctx,async(client)=>client.query<{disponivel:boolean}>(
    `select exists(select 1 from app.fiscal_document where tenant_id=$1 and empresa_id=$2 and especie='NFE_55' and chave_acesso=$3) as disponivel`,
    [row.tenant_id,row.empresa_id,row.chave_acesso]));
  if(jaDisponivel.rows[0]?.disponivel){
    await comContexto(deps.pool,ctx,(client)=>transicionarCienciaDaEmissao(client,{tenantId:row.tenant_id,empresaId:row.empresa_id,
      acknowledgementId:row.id,estado:'XML_COMPLETO_JA_DISPONIVEL',codigo:'FISCAL_FULL_XML_ALREADY_AVAILABLE',correlationId:row.correlation_id}));
    return;
  }
  const tentativa = row.tentativas_xml_ciclo+1;
  const tentativaHistorica = row.tentativas_xml+1;
  if (tentativa>3) { await comContexto(deps.pool,ctx,(client) => transicionarCienciaDaEmissao(client,{tenantId:row.tenant_id,empresaId:row.empresa_id,acknowledgementId:row.id,estado:'DLQ',codigo:'FISCAL_FULL_XML_RETRY_EXHAUSTED',correlationId:row.correlation_id})); return; }
  let resposta: RespostaConsultarProcNFe;
  try { resposta=await deps.signer.consultarProcNFe(ComandoConsultarProcNFeSchema.parse({ ...comandoBase(row),chaveIdempotente:chaveIdempotente(row.tenant_id,row.empresa_id,row.chave_acesso,'xml') })); }
  catch { resposta={tipo:'PENDENTE',xmlCompleto:null,chaveAcesso:row.chave_acesso,cnpj:row.cnpj,codigo:'FISCAL_FULL_XML_UNAVAILABLE',recebidoEm:null}; }
  const identidadeOk=resposta.chaveAcesso===row.chave_acesso&&resposta.cnpj===row.cnpj;
  let conteudo: Buffer | null=null;
  if (resposta.tipo==='OBTIDO'&&identidadeOk&&resposta.xmlCompleto) {
    if (validarXmlCompletoRecuperado(resposta.xmlCompleto,row.chave_acesso,row.cnpj)) conteudo=Buffer.from(resposta.xmlCompleto,'utf8');
  }
  const result=conteudo?'XML_OBTIDO':resposta.tipo==='DIVERGENTE'||!identidadeOk?'DIVERGENTE':'XML_PENDENTE';
  await comContexto(deps.pool,ctx,async (client) => {
    const atual=(await client.query<{estado:string}>(`select estado from app.fiscal_acknowledgement where id=$1 for update`,[row.id])).rows[0]?.estado;
    if(atual!=='XML_COMPLETO_PENDENTE') return;
    await registrarTentativaDaCiencia(client,{tenantId:row.tenant_id,empresaId:row.empresa_id,acknowledgementId:row.id,etapa:'RECUPERACAO_XML',tentativa:tentativaHistorica,
      resultado:result,codigo:conteudo?null:resposta.codigo??'FISCAL_FULL_XML_UNAVAILABLE',correlationId:row.correlation_id,iniciadaEm:agora,finalizadaEm:deps.agora()});
    if (conteudo) {
      const stagingId=await preservarXmlCompletoRecuperado(client,{tenantId:row.tenant_id,empresaId:row.empresa_id,acknowledgementId:row.id,conteudo,correlationId:row.correlation_id,capturadoEm:deps.agora()});
      await transicionarCienciaDaEmissao(client,{tenantId:row.tenant_id,empresaId:row.empresa_id,acknowledgementId:row.id,estado:'XML_COMPLETO_OBTIDO',xmlStagingId:stagingId,correlationId:row.correlation_id});
    } else if (result==='DIVERGENTE') await transicionarCienciaDaEmissao(client,{tenantId:row.tenant_id,empresaId:row.empresa_id,acknowledgementId:row.id,estado:'IMPEDIDO',codigo:'FISCAL_FULL_XML_MISMATCH',correlationId:row.correlation_id});
    else if (tentativa>=3) await transicionarCienciaDaEmissao(client,{tenantId:row.tenant_id,empresaId:row.empresa_id,acknowledgementId:row.id,estado:'DLQ',codigo:'FISCAL_FULL_XML_RETRY_EXHAUSTED',correlationId:row.correlation_id});
    else {
      const next=new Date(deps.agora().getTime()+tempoDeRetryDaCiencia(tentativa));
      await transicionarCienciaDaEmissao(client,{tenantId:row.tenant_id,empresaId:row.empresa_id,acknowledgementId:row.id,estado:'RETRY_AGENDADO',codigo:'FISCAL_FULL_XML_UNAVAILABLE',proximaTentativaEm:next,correlationId:row.correlation_id});
      await transicionarCienciaDaEmissao(client,{tenantId:row.tenant_id,empresaId:row.empresa_id,acknowledgementId:row.id,estado:'XML_COMPLETO_PENDENTE',codigo:'FISCAL_FULL_XML_UNAVAILABLE',proximaTentativaEm:next,correlationId:row.correlation_id});
    }
  });
};

export const processarCienciaDaEmissao = async (deps: Dependencias, command: unknown): Promise<void> => {
  const parsed=FiscalAcknowledgementCommandSchema.parse(command);
  const ctx=contextoTecnico({identidadeTecnica:'worker',finalidade:'PROCESSAMENTO_DE_EMPRESA',tenantId:parsed.tenantId,empresaId:parsed.companyId,correlationId:parsed.correlationId});
  const row=await comContexto(deps.pool,ctx,async (client) => {
    const {rows}=await client.query<Pendente>(`select a.*,o.etapa,s.cnpj from app.fiscal_acknowledgement a join app.fiscal_acknowledgement_outbox o on o.acknowledgement_id=a.id join app.dfe_capture_staging s on s.id=a.staging_id where a.id=$1 and a.tenant_id=$2 and a.empresa_id=$3 and o.estado='PUBLICADO'`,[parsed.acknowledgementId,parsed.tenantId,parsed.companyId]); return rows[0]??null;
  });
  if (!row) return;
  if (row.etapa==='CIENCIA') await executarCiencia(deps,row,deps.agora()); else await executarRecuperacao(deps,row,deps.agora());
};

export const iniciarConsumidorDeCiencias = async (deps: Dependencias) => {
  const redis=criarConexaoRedis(deps.conexao); const common={connection:redis,...(deps.prefixo===undefined?{}:{prefix:deps.prefixo})};
  const queue=new Queue(FISCAL_ACKNOWLEDGEMENT_QUEUE,common); const dead=new Queue(FISCAL_ACKNOWLEDGEMENT_DLQ,common);
  const worker=new Worker(FISCAL_ACKNOWLEDGEMENT_QUEUE,(job:Job<unknown>)=>processarCienciaDaEmissao(deps,job.data),{...common,concurrency:2});
  worker.on('failed',(job,error)=>{
    if(!job||job.attemptsMade<Number(job.opts.attempts??3))return;
    const command=FiscalAcknowledgementCommandSchema.safeParse(job.data);
    if(command.success) {
      const ctx=contextoTecnico({identidadeTecnica:'worker',finalidade:'PROCESSAMENTO_DE_EMPRESA',tenantId:command.data.tenantId,empresaId:command.data.companyId,correlationId:command.data.correlationId});
      void Promise.allSettled([
        comContexto(deps.pool,ctx,(client)=>transicionarCienciaDaEmissao(client,{tenantId:command.data.tenantId,empresaId:command.data.companyId,
          acknowledgementId:command.data.acknowledgementId,estado:'DLQ',codigo:'FISCAL_ACK_WORKER_FAILED',correlationId:command.data.correlationId})),
        dead.add('dead',{...command.data,codigo:'FISCAL_ACK_WORKER_FAILED',tentativas:job.attemptsMade},{jobId:`ack-dead-${command.data.acknowledgementId}-${job.id}`,removeOnFail:false}),
      ]).then((results)=>{
        for(const result of results) if(result.status==='rejected') console.error(JSON.stringify({event:'fiscal-ack-dlq-write-failed',name:result.reason instanceof Error?result.reason.name:'Unknown'}));
      });
    }
    console.error(JSON.stringify({event:'fiscal-ack-worker-failed',name:error.name}));
  });
  worker.on('error',(error)=>console.error(JSON.stringify({event:'fiscal-ack-worker-error',name:error.name})));
  await worker.waitUntilReady();
  return {fechar:async()=>{await worker.close();await queue.close();await dead.close();redis.disconnect();}};
};
