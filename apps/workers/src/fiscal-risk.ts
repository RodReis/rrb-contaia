import { atualizarEstadoDeRiscoFiscal, comContexto, finalizarTentativaDeRiscoFiscal, iniciarTentativaDeRiscoFiscal, obterDocumentoParaRiscoFiscal, obterHistoricoDeComprasParaRiscoFiscal, obterOriginalDeRiscoFiscal, obterConfiguracaoDeRiscoFiscal, registrarEventoDeRiscoFiscal } from '@contaia/db';
import { contextoTecnico, classificarFaixaDeConfianca, decidirPropostaDeManifestacao, ehCnpjValido, normalizarCnpj, valorMonetarioParaCentavos } from '@contaia/domain';
import { FiscalRiskCommandSchema, FISCAL_RISK_QUEUE, FISCAL_RISK_DLQ, PropostaDeManifestacaoSchema, type FiscalRiskCommand } from '@contaia/shared';
import { Queue, Worker, type Job } from 'bullmq';
import type { Pool } from 'pg';
import type { ConexaoDoRedis } from '@contaia/signer-client';
import { createHash } from 'node:crypto';
import { parsearDocumentoFiscal } from '@contaia/shared/fiscal-document-parser';
import { criarConexaoRedis } from './redis.js';

const executar=async(pool:Pool,command:FiscalRiskCommand):Promise<void>=>{
  const context=contextoTecnico({identidadeTecnica:'worker',finalidade:'PROCESSAMENTO_DE_EMPRESA',tenantId:command.tenantId,empresaId:command.companyId,correlationId:command.correlationId});
  const started=await comContexto(pool,context,async(client)=>{
    const document=await obterDocumentoParaRiscoFiscal(client,{tenantId:command.tenantId,empresaId:command.companyId,documentId:command.documentId});
    const config=await obterConfiguracaoDeRiscoFiscal(client,command.companyId,command.tenantId);
    if(!document||document.especie!=='NFE_55'||document.modelo!=='55'||document.estado!=='PROCESSADO'||document.inconsistencia_aberta||document.ja_manifestado){
      await atualizarEstadoDeRiscoFiscal(client,{tenantId:command.tenantId,empresaId:command.companyId,executionId:command.executionId,state:'INELEGIVEL',code:'FISCAL_RISK_DOCUMENT_NOT_ELIGIBLE',correlationId:command.correlationId});
      return null;
    }
    const attempt=await iniciarTentativaDeRiscoFiscal(client,{tenantId:command.tenantId,empresaId:command.companyId,executionId:command.executionId,etapa:'DETERMINISTICA',correlationId:command.correlationId,iniciadoEm:new Date()});
    if(!attempt)return null;
    await registrarEventoDeRiscoFiscal(client,{tenantId:command.tenantId,empresaId:command.companyId,executionId:command.executionId,state:'PROCESSANDO',code:'FISCAL_RISK_STARTED',detail:null,correlationId:command.correlationId});
    const original=await obterOriginalDeRiscoFiscal(client,{tenantId:command.tenantId,empresaId:command.companyId,stagingId:String(document.primary_staging_id)});
    return {document,config,original,attemptId:String(attempt.id),attempt:Number(attempt.numero)};
  });
  if(!started)return;
  const {document,config,original}=started;
  const actualHash=original?createHash('sha256').update(original).digest('hex'):null;
  let parsed:ReturnType<typeof parsearDocumentoFiscal>|null=null;
  if(original&&document)try{parsed=parsearDocumentoFiscal(original,'NFE_55',document.emitido_em);}catch{parsed=null;}
  const supplierCnpj=parsed?.partes.find((party)=>party.papel==='EMITENTE')?.identificador??null;
  const history=parsed&&supplierCnpj&&ehCnpjValido(supplierCnpj)&&document?.emitido_em
    ?await comContexto(pool,context,(client)=>obterHistoricoDeComprasParaRiscoFiscal(client,{tenantId:command.tenantId,empresaId:command.companyId,
      cnpjEmitente:normalizarCnpj(supplierCnpj),dataEmissao:String(document.emitido_em).slice(0,10),documentId:command.documentId}))
    :null;
  const isEligible=document!==null&&document.especie==='NFE_55'&&document.modelo==='55'&&document.estado==='PROCESSADO'
    &&!document.inconsistencia_aberta&&!document.ja_manifestado&&actualHash===document.hash_sha256&&parsed!==null;
  const evidence:string[]=[];const gaps:string[]=[];
  if(actualHash&&actualHash===document?.hash_sha256)evidence.push('documento:hash-f18-verificado');else gaps.push('documento:hash-invalido');
  if(document?.especie==='NFE_55'&&document.modelo==='55')evidence.push('documento:modelo-55');
  if(config){evidence.push(`configuracao:versao-${config.versao}`);}
  else gaps.push('configuracao:ausente');
  if(parsed?.itens.length)evidence.push(`documento:itens-${parsed.itens.length}`);else gaps.push('documento:itens-ausentes');
  for(const [index,item] of (parsed?.itens??[]).entries()){
    if(item.ncm&&/^\d{8}$/u.test(item.ncm))evidence.push(`documento:item-${index+1}:ncm-${item.ncm}`);else gaps.push(`documento:item-${index+1}:ncm-ausente-ou-invalido`);
    if(item.cfop&&/^\d{4}$/u.test(item.cfop))evidence.push(`documento:item-${index+1}:cfop-${item.cfop}`);else gaps.push(`documento:item-${index+1}:cfop-ausente-ou-invalido`);
  }
  if(supplierCnpj&&ehCnpjValido(supplierCnpj)&&config){
    const approved=config.fornecedores.some((supplier)=>supplier.situacao==='ATIVO'&&supplier.cnpj===normalizarCnpj(supplierCnpj));
    evidence.push(approved?'fornecedor:aprovado':'fornecedor:nao-listado-como-aprovado');
  }else gaps.push('fornecedor:identificador-ou-configuracao-ausente');
  const totalCentavos=parsed?.total?valorMonetarioParaCentavos(parsed.total):null;
  if(totalCentavos!==null&&config){
    const limit=BigInt(config.limite_centavos);
    evidence.push(`documento:total-centavos-${totalCentavos}`);
    evidence.push(totalCentavos>limit?'documento:total-acima-do-limite':'documento:total-no-limite-ou-abaixo');
  }else gaps.push('documento:total-ou-limite-ausente');
  if(history){
    evidence.push(`historico:compras-12m-${history.quantidade}`);
    if(history.primeira_emissao)evidence.push(`historico:primeira-compra-${history.primeira_emissao}`);
    if(history.ultima_emissao)evidence.push(`historico:ultima-compra-${history.ultima_emissao}`);
    const historicalTotal=history.total_centavos?BigInt(history.total_centavos):0n;
    evidence.push(`historico:total-centavos-${historicalTotal}`);
    const minCents=history.menor_valor?valorMonetarioParaCentavos(history.menor_valor):null;
    const maxCents=history.maior_valor?valorMonetarioParaCentavos(history.maior_valor):null;
    if(minCents!==null)evidence.push(`historico:menor-compra-centavos-${minCents}`);
    if(maxCents!==null)evidence.push(`historico:maior-compra-centavos-${maxCents}`);
  }else gaps.push('historico:sem-cnpj-ou-data-para-janela-12-meses');
  if(document?.ja_manifestado)gaps.push('manifestacao_conclusiva:documento-reportado-ja-manifestado');
  else gaps.push('manifestacao_conclusiva:consulta-limitada-a-eventos-disponiveis-na-F20');
  const fornecedorAprovado=supplierCnpj&&ehCnpjValido(supplierCnpj)&&config
    ?config.fornecedores.some((supplier)=>supplier.situacao==='ATIVO'&&supplier.cnpj===normalizarCnpj(supplierCnpj))
    :null;
  const dentroDoLimite=totalCentavos!==null&&config?totalCentavos<=BigInt(config.limite_centavos):null;
  const totalHistoricoEmCentavos=history?.total_centavos===undefined||history?.total_centavos===null?null:BigInt(history.total_centavos);
  const decisao=decidirPropostaDeManifestacao({fornecedorAprovado,dentroDoLimite,valorEmCentavos:totalCentavos,
    comprasAnteriores12Meses:history?Number(history.quantidade):null,totalHistoricoEmCentavos,conflito:false});
  const referenciasPorRisco:Record<string,string[]>={
    FORNECEDOR_NAO_APROVADO:['fornecedor:nao-listado-como-aprovado'],
    VALOR_ACIMA_DO_LIMITE:['documento:total-acima-do-limite'],
    VALOR_ACIMA_DE_TRES_VEZES_A_MEDIA_HISTORICA:[`historico:compras-12m-${history?.quantidade??0}`,`documento:total-centavos-${totalCentavos??'indisponivel'}`],
    SINAIS_CONTRADITORIOS:['sinais:conflito-detectado'],
  };
  gaps.push(...decisao.lacunas);
  const startedAt=Date.now();
  await comContexto(pool,context,async(client)=>{
    if(!isEligible){
      await finalizarTentativaDeRiscoFiscal(client,{tenantId:command.tenantId,empresaId:command.companyId,executionId:command.executionId,attemptId:started.attemptId,
        result:'FALHA',errorCode:'FISCAL_RISK_DOCUMENT_NOT_ELIGIBLE',durationMs:Date.now()-startedAt,correlationId:command.correlationId});
      await atualizarEstadoDeRiscoFiscal(client,{tenantId:command.tenantId,empresaId:command.companyId,executionId:command.executionId,state:'INELEGIVEL',code:'FISCAL_RISK_DOCUMENT_NOT_ELIGIBLE',correlationId:command.correlationId});
      return;
    }
    if(!config)gaps.push('configuracao:ausente');
    const confidence=decisao.confianca;
    const riscos=decisao.riscos.map((code)=>({codigo:code,severidade:'media' as const,evidencias:referenciasPorRisco[code]??[]}));
    const evidenciasFinais=evidence.slice(0,100);
    const lacunasFinais=[...new Set(gaps)];
    if(evidence.length>100)lacunasFinais.push('EVIDENCIAS_LIMITADAS_A_100_REFERENCIAS');
    const output=PropostaDeManifestacaoSchema.parse({tipo_manifestacao:decisao.tipo,confianca:confidence,justificativa:decisao.motivo,
      riscos,evidencias:evidenciasFinais,lacunas:lacunasFinais.slice(0,100)});
    const proposal={tipo:output.tipo_manifestacao,confidence:String(output.confianca),band:output.tipo_manifestacao==='ABSTER_SE'?'ABSTER_SE':String(classificarFaixaDeConfianca(output.confianca)),
      justification:output.justificativa,risks:output.riscos,evidence:output.evidencias,gaps:output.lacunas,
      origin:output.tipo_manifestacao==='ABSTER_SE'?'ABSTENCAO':'DETERMINISTICA',schemaVersion:'f20-risk-v1',fallback:output.tipo_manifestacao==='ABSTER_SE'};
    await finalizarTentativaDeRiscoFiscal(client,{tenantId:command.tenantId,empresaId:command.companyId,executionId:command.executionId,attemptId:started.attemptId,
      result:'SUCESSO',durationMs:Date.now()-startedAt,correlationId:command.correlationId,proposal});
    await registrarEventoDeRiscoFiscal(client,{tenantId:command.tenantId,empresaId:command.companyId,executionId:command.executionId,state:decisao.tipo,code:decisao.tipo==='ABSTER_SE'?'FISCAL_RISK_EVIDENCE_INSUFFICIENT':'FISCAL_RISK_PROPOSAL_RECORDED',detail:'Proposta determinística registrada para revisão humana; nenhuma manifestação foi executada.',correlationId:command.correlationId});
  });
};
export const iniciarConsumidorDeRiscoFiscal=async(deps:Readonly<{pool:Pool;conexao:ConexaoDoRedis;prefixo?:string}>)=>{
  const redis=criarConexaoRedis(deps.conexao);const common={connection:redis,...(deps.prefixo===undefined?{}:{prefix:deps.prefixo})};
  const dead=new Queue(FISCAL_RISK_DLQ,common);
  const worker=new Worker(FISCAL_RISK_QUEUE,async(job:Job<unknown>)=>{
    const command=FiscalRiskCommandSchema.parse(job.data);await executar(deps.pool,command);
  },{...common,concurrency:4});
  worker.on('failed',(job)=>{
    if(!job||job.attemptsMade<Number(job.opts.attempts??3))return;
    const parsed=FiscalRiskCommandSchema.safeParse(job.data);if(!parsed.success)return;
    const command=parsed.data;
    const ctx=contextoTecnico({identidadeTecnica:'worker',finalidade:'PROCESSAMENTO_DE_EMPRESA',tenantId:command.tenantId,empresaId:command.companyId,correlationId:command.correlationId});
    void Promise.allSettled([
      comContexto(deps.pool,ctx,async(client)=>{
        await atualizarEstadoDeRiscoFiscal(client,{tenantId:command.tenantId,empresaId:command.companyId,executionId:command.executionId,state:'DLQ',code:'FISCAL_RISK_RETRY_EXHAUSTED',correlationId:command.correlationId});
      }),
      dead.add('dead',{...command,attempts:job.attemptsMade,code:'FISCAL_RISK_RETRY_EXHAUSTED'},{jobId:`fiscal-risk-dead-${command.executionId}`,removeOnFail:false}),
    ]).then((results)=>{for(const result of results)if(result.status==='rejected')console.error(JSON.stringify({event:'fiscal-risk-dlq-failed',name:result.reason instanceof Error?result.reason.name:'UnknownError'}));});
  });
  worker.on('error',(error)=>console.error(JSON.stringify({event:'fiscal-risk-worker-error',name:error.name})));
  return {fechar:async()=>{await worker.close();await dead.close();await redis.quit().catch(()=>redis.disconnect());}};
};
