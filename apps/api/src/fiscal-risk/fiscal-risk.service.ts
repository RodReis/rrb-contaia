import { Inject, Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { atualizarEstadoDeRiscoFiscal, comContextoHumano, criarExecucaoDeRiscoFiscal, getDfeCaptureCompany, listarHistoricoDeConfiguracoesDeRiscoFiscal, obterAnaliseDeRiscoFiscal, obterConfiguracaoDeRiscoFiscal, obterDocumentoParaRiscoFiscal, obterExecucoesDeRiscoFiscal, publicarConfiguracaoDeRiscoFiscal, registrarEventoDeRiscoFiscal, listarInboxManifestacoes, registrarDecisaoManifestacao } from '@contaia/db';
import { ehCnpjValido, normalizarCnpj, valorMonetarioParaCentavos, CODIGOS_DE_ERRO, ErroDeDominio, validarJustificativaManifestacao, chaveIdempotenteManifestacao, hashPayloadManifestacao } from '@contaia/domain';
import { FISCAL_RISK_API_QUEUE, FISCAL_RISK_JOB, FISCAL_RISK_JOB_OPTIONS, FiscalRiskCommandSchema, MANIFESTATION_CONCLUSIVA_JOB, ManifestacaoConclusivaCommandSchema } from '@contaia/shared';
import { PoolDoBanco } from '../banco/pool.provider';

const versaoClassificador = 'f20-1.0.0';
const permitidoConfigurar = (roles: readonly string[]) => roles.some((role) => ['admin_escritorio','contador'].includes(role));
const erroRisco = (code: typeof CODIGOS_DE_ERRO[keyof typeof CODIGOS_DE_ERRO], message: string) => new ErroDeDominio(code,message);

@Injectable()
export class FiscalRiskService {
  constructor(private readonly pool: PoolDoBanco, @Inject(FISCAL_RISK_API_QUEUE) private readonly queue: Queue | null,
    @Inject('FISCAL_MANIFESTATION_API_QUEUE') private readonly manifestationQueue:Queue|null) {}

  async inbox(tenantId:string,userId:string,companyId:string,correlationId:string,filtros?:Readonly<{tipo?:string;confianca?:string;risco?:string;prazo?:string;emitente?:string;valor?:string;busca?:string;pagina?:number;ordenacao?:string;estado?:string}>){
    const result=await comContextoHumano(this.pool.instancia,{tenantId,usuarioId:userId,correlationId},async(client)=>{
      const company=await getDfeCaptureCompany(client,companyId);if(!company||company.tenantId!==tenantId)throw erroRisco(CODIGOS_DE_ERRO.EMPRESA_NAO_ENCONTRADA,'Empresa não encontrada.');
      return {itens:await listarInboxManifestacoes(client,{tenantId,empresaId:companyId,...(filtros?{filtros}:{})}),pagina:filtros?.pagina??1};
    });
    return result;
  }

  async decidirManifestacao(tenantId:string,userId:string,companyId:string,correlationId:string,roles:readonly string[],body:Readonly<{documentId:string;analysisId:string;chaveAcesso:string;tipo:'210200'|'210220'|'210240';rejeitada:boolean;motivoTroca:string|null;categoria:string|null;nota:string|null;xJust:string|null}>){
    if(!permitidoConfigurar(roles))throw erroRisco(CODIGOS_DE_ERRO.FISCAL_RISK_ACCESS_DENIED,'Somente contador ou administrador do escritório aprova manifestação.');
    if(body.rejeitada&&(!body.categoria||(body.categoria==='OUTRO'&&!body.nota)))throw erroRisco(CODIGOS_DE_ERRO.FISCAL_RISK_CONFIGURATION_INVALID,'Informe a categoria e a nota obrigatória para OUTRO.');
    const xJust=body.tipo==='210240'?validarJustificativaManifestacao(body.xJust):null;
    if(body.tipo==='210240'&&!xJust)throw erroRisco(CODIGOS_DE_ERRO.FISCAL_RISK_CONFIGURATION_INVALID,'A justificativa deve ter de 15 a 255 caracteres.');
    if(body.tipo!=='210240'&&body.xJust)throw erroRisco(CODIGOS_DE_ERRO.FISCAL_RISK_CONFIGURATION_INVALID,'Justificativa só é aceita para 210240.');
    const result=await comContextoHumano(this.pool.instancia,{tenantId,usuarioId:userId,correlationId},async(client)=>{
      const company=await getDfeCaptureCompany(client,companyId);if(!company||company.tenantId!==tenantId)throw erroRisco(CODIGOS_DE_ERRO.EMPRESA_NAO_ENCONTRADA,'Empresa não encontrada.');
      const doc=await client.query(`select d.total,d.chave_acesso,a.tipo_manifestacao,x.classifier_version,x.estado estado_analise from app.fiscal_document d join app.fiscal_risk_analysis a on a.id=$3 and a.document_id=d.id and a.tenant_id=d.tenant_id and a.empresa_id=d.empresa_id join app.fiscal_risk_execution x on x.id=a.execution_id and x.tenant_id=a.tenant_id and x.empresa_id=a.empresa_id where d.id=$2 and d.tenant_id=$1 and d.empresa_id=$4 and d.especie='NFE_55' and d.modelo='55' and d.estado='PROCESSADO' and d.emitido_em::date>=current_date-90 and a.id=(select a2.id from app.fiscal_risk_analysis a2 where a2.tenant_id=d.tenant_id and a2.empresa_id=d.empresa_id and a2.document_id=d.id order by a2.criado_em desc,a2.id desc limit 1) and exists(select 1 from app.fiscal_document_party p where p.document_id=d.id and p.papel='DESTINATARIO' and p.parser_version=d.parser_version and p.identificador=$5) and not exists(select 1 from app.fiscal_document_event ev where ev.tenant_id=d.tenant_id and ev.empresa_id=d.empresa_id and ev.document_id=d.id and ev.tipo in ('CONFLITO','FALHA','XML_INVALIDO')) and not exists(select 1 from app.fiscal_manifestation m where m.tenant_id=d.tenant_id and m.empresa_id=d.empresa_id and m.chave_acesso=d.chave_acesso and m.estado not in ('REJEITADA_PELO_HUMANO','REJEITADA_SEFAZ')) and not exists(select 1 from app.fiscal_acknowledgement ack where ack.tenant_id=d.tenant_id and ack.empresa_id=d.empresa_id and ack.chave_acesso=d.chave_acesso and ack.estado in ('JA_MANIFESTADO','CIENCIA_REGISTRADA')) for update of d`,[tenantId,body.documentId,body.analysisId,companyId,company.cnpj]);
      const row=doc.rows[0];if(!row)throw erroRisco(CODIGOS_DE_ERRO.FISCAL_RISK_DOCUMENT_NOT_ELIGIBLE,'Proposta não encontrada ou desatualizada.');
      if(!['CONCLUIDA','ABSTER_SE'].includes(String(row.estado_analise)))throw erroRisco(CODIGOS_DE_ERRO.FISCAL_RISK_DOCUMENT_NOT_ELIGIBLE,'A análise não está concluída para decisão humana.');
      if(!['210200','210220','210240'].includes(String(row.tipo_manifestacao)))throw erroRisco(CODIGOS_DE_ERRO.FISCAL_RISK_DOCUMENT_NOT_ELIGIBLE,'A proposta não recomenda manifestação conclusiva.');
      if(row.chave_acesso!==body.chaveAcesso)throw erroRisco(CODIGOS_DE_ERRO.FISCAL_RISK_DOCUMENT_NOT_ELIGIBLE,'A chave de acesso não corresponde ao documento selecionado.');
      const latest=await client.query(`select id from app.fiscal_risk_analysis where tenant_id=$1 and empresa_id=$2 and document_id=$3 order by criado_em desc,id desc limit 1`,[tenantId,companyId,body.documentId]);if(latest.rows[0]?.id!==body.analysisId)throw erroRisco(CODIGOS_DE_ERRO.FISCAL_RISK_DOCUMENT_NOT_ELIGIBLE,'A proposta não é mais a versão vigente. Atualize a inbox.');
      if(body.rejeitada){
        const payload={documentId:body.documentId,analysisId:body.analysisId,category:body.categoria,note:body.nota,at: new Date().toISOString()};
        const hash=hashPayloadManifestacao(payload);
        await client.query(`insert into app.fiscal_manifestation(tenant_id,empresa_id,document_id,analysis_id,chave_acesso,tipo,estado,motivo_troca,decisao_original,aprovador_id,payload,payload_sha256,chave_idempotente,correlation_id)
          values($1,$2,$3,$4,$5,$6,'REJEITADA_PELO_HUMANO',$7,$6,$8,$9::jsonb,$10,$11,$12)`,[tenantId,companyId,body.documentId,body.analysisId,body.chaveAcesso,String(row.tipo_manifestacao),`${body.categoria}: ${body.nota??''}`,userId,JSON.stringify(payload),hash,`reject:${body.analysisId}:${hash.slice(0,16)}`,correlationId]);
        const id=(await client.query<{id:string}>(`select id from app.fiscal_manifestation where tenant_id=$1 and empresa_id=$2 and chave_idempotente=$3`,[tenantId,companyId,`reject:${body.analysisId}:${hash.slice(0,16)}`])).rows[0]?.id;
        if(id)await client.query(`insert into app.fiscal_manifestation_event(tenant_id,empresa_id,manifestation_id,estado,detalhe_sanitizado,correlation_id) values($1,$2,$3,'REJEITADA_PELO_HUMANO',$4,$5)`,[tenantId,companyId,id,`Proposta rejeitada: ${body.categoria}`,correlationId]);
        return {documentId:body.documentId,estado:'REJEITADA_PELO_HUMANO'};
      }
      if(body.tipo!==row.tipo_manifestacao&&!body.motivoTroca)throw erroRisco(CODIGOS_DE_ERRO.FISCAL_RISK_CONFIGURATION_INVALID,'A troca de tipo exige motivo.');
      const payload={tenantId,empresaId:companyId,chaveAcesso:body.chaveAcesso,tipo:body.tipo,tipoOriginal:String(row.tipo_manifestacao),sequencia:1,ambiente:'HOMOLOGACAO',xJust,
        analysisId:body.analysisId,versaoProposta:String(row.classifier_version),motivoTroca:body.motivoTroca,aprovadorId:userId,aprovadoEm:new Date().toISOString()};
      const hash=hashPayloadManifestacao(payload);
      try {
        const saved=await registrarDecisaoManifestacao(client,{tenantId,empresaId:companyId,documentId:body.documentId,analysisId:body.analysisId,chaveAcesso:body.chaveAcesso,
          tipo:body.tipo,tipoOriginal:String(row.tipo_manifestacao),justificativa:xJust,motivoTroca:body.motivoTroca,aprovadorId:userId,payload,payloadSha256:hash,
          chaveIdempotente:chaveIdempotenteManifestacao({empresaId:companyId,chaveAcesso:body.chaveAcesso,tipo:body.tipo,sequencia:1}),correlationId});
        return {manifestationId:saved.id,estado:'APROVADA',payloadSha256:hash,reutilizada:saved.reused};
      } catch(error) { throw erroRisco(CODIGOS_DE_ERRO.FISCAL_RISK_DOCUMENT_NOT_ELIGIBLE,error instanceof Error&&error.message==='FISCAL_MANIFESTATION_DUPLICATE'?'Esta manifestação já foi aprovada.':'A elegibilidade mudou; atualize a inbox.'); }
    });
    if(!result.manifestationId)return result;
    if(!this.manifestationQueue)return {...result,estado:'APROVADA' as const,publicacao:'PENDENTE'};
    const command=ManifestacaoConclusivaCommandSchema.parse({tenantId,companyId,manifestationId:result.manifestationId,correlationId});
    try{
      await this.manifestationQueue.add(MANIFESTATION_CONCLUSIVA_JOB,command,{jobId:`fiscal-manifestation-${result.manifestationId}`,attempts:1,removeOnComplete:{count:100},removeOnFail:false});
      await comContextoHumano(this.pool.instancia,{tenantId,usuarioId:userId,correlationId},client=>client.query("update app.fiscal_manifestation_outbox set estado='PUBLICADO',publicado_em=now() where manifestation_id=$1 and empresa_id=$2 and tenant_id=$3",[result.manifestationId,companyId,tenantId]));
      await comContextoHumano(this.pool.instancia,{tenantId,usuarioId:userId,correlationId},client=>client.query("update app.fiscal_manifestation set estado='ENFILEIRADA',atualizado_em=now() where id=$1 and empresa_id=$2 and tenant_id=$3 and estado='APROVADA'",[result.manifestationId,companyId,tenantId]));
      return {...result,estado:'ENFILEIRADA' as const,publicacao:'PUBLICADO'};
    }catch{return {...result,estado:'APROVADA' as const,publicacao:'PENDENTE'};}
  }

  async decidirManifestacoesEmLote(tenantId:string,userId:string,companyId:string,correlationId:string,roles:readonly string[],items:readonly Readonly<{documentId:string;analysisId:string;chaveAcesso:string;tipo:'210200'}>[]){
    if(!permitidoConfigurar(roles))throw erroRisco(CODIGOS_DE_ERRO.FISCAL_RISK_ACCESS_DENIED,'Somente contador ou administrador do escritório pode aprovar lote de manifestações.');
    if(items.length<1||items.length>200)throw erroRisco(CODIGOS_DE_ERRO.FISCAL_RISK_CONFIGURATION_INVALID,'O lote deve conter de 1 a 200 itens.');
    if(items.some(item=>item.tipo!=='210200')||new Set(items.map(item=>item.documentId)).size!==items.length)throw erroRisco(CODIGOS_DE_ERRO.FISCAL_RISK_CONFIGURATION_INVALID,'O lote aceita somente itens 210200 sem repetição.');
    const results:Readonly<{documentId:string;estado:string;codigo?:string}>[]=[];const totalCentavos=await comContextoHumano(this.pool.instancia,{tenantId,usuarioId:userId,correlationId},async client=>{const company=await getDfeCaptureCompany(client,companyId);if(!company||company.tenantId!==tenantId)throw erroRisco(CODIGOS_DE_ERRO.EMPRESA_NAO_ENCONTRADA,'Empresa não encontrada.');const result=await client.query<{total_centavos:string}>(`select coalesce(sum(round(d.total*100)::bigint),0)::text total_centavos from app.fiscal_document d where d.tenant_id=$1 and d.empresa_id=$2 and d.id=any($3::uuid[])`,[tenantId,companyId,items.map(item=>item.documentId)]);return result.rows[0]?.total_centavos??'0';});
    for(const item of items){try{const decision=await this.decidirManifestacao(tenantId,userId,companyId,correlationId,roles,{...item,rejeitada:false,motivoTroca:null,categoria:null,nota:null,xJust:null});results.push({documentId:item.documentId,estado:decision.estado});}catch(error){results.push({documentId:item.documentId,estado:'INELEGIVEL',codigo:error instanceof ErroDeDominio?error.codigo:'FISCAL_MANIFESTATION_DECISION_FAILED'});}}
    return {empresaId:companyId,quantidade:results.length,totalCentavos,aceitas:results.filter(item=>item.estado==='ENFILEIRADA').length,incertas:results.filter(item=>item.estado==='RESULTADO_INCERTO').length,inelegiveis:results.filter(item=>item.estado==='INELEGIVEL').length,itens:results};
  }

  async historicoManifestacoes(tenantId:string,userId:string,companyId:string,correlationId:string,pagina=1){
    return comContextoHumano(this.pool.instancia,{tenantId,usuarioId:userId,correlationId},async client=>{const company=await getDfeCaptureCompany(client,companyId);if(!company||company.tenantId!==tenantId)throw erroRisco(CODIGOS_DE_ERRO.EMPRESA_NAO_ENCONTRADA,'Empresa não encontrada.');const result=await client.query(`select m.id,m.document_id,m.chave_acesso,m.tipo,m.estado,m.aprovador_id,m.criado_em,m.atualizado_em,e.estado evento_estado,e.codigo,e.detalhe_sanitizado,e.protocolo,e.ocorrido_em from app.fiscal_manifestation m left join lateral(select ev.* from app.fiscal_manifestation_event ev where ev.manifestation_id=m.id and ev.tenant_id=m.tenant_id and ev.empresa_id=m.empresa_id order by ev.ocorrido_em desc,ev.id desc limit 1)e on true where m.tenant_id=$1 and m.empresa_id=$2 order by m.atualizado_em desc,m.id limit 200 offset $3`,[tenantId,companyId,(pagina-1)*200]);return{itens:result.rows,pagina};});
  }

  async reconciliarManifestacao(tenantId:string,userId:string,companyId:string,correlationId:string,roles:readonly string[],manifestationId:string){
    if(!permitidoConfigurar(roles))throw erroRisco(CODIGOS_DE_ERRO.FISCAL_RISK_ACCESS_DENIED,'Somente contador ou administrador do escritório pode solicitar reconciliação.');
    if(!this.manifestationQueue)throw erroRisco(CODIGOS_DE_ERRO.FISCAL_RISK_PROVIDER_UNAVAILABLE,'Fila de manifestação indisponível.');
    const status=await comContextoHumano(this.pool.instancia,{tenantId,usuarioId:userId,correlationId},async client=>{const result=await client.query(`select estado from app.fiscal_manifestation where id=$1 and tenant_id=$2 and empresa_id=$3`,[manifestationId,tenantId,companyId]);return result.rows[0]?.estado as string|undefined;});
    if(status!=='RESULTADO_INCERTO')throw erroRisco(CODIGOS_DE_ERRO.FISCAL_RISK_DOCUMENT_NOT_ELIGIBLE,'Somente manifestações com resultado incerto podem ser reconciliadas.');
    const command=ManifestacaoConclusivaCommandSchema.parse({tenantId,companyId,manifestationId,correlationId});await this.manifestationQueue.add('reconcile-manifestation',command,{jobId:`fiscal-manifestation-reconcile-${manifestationId}-${correlationId}`,attempts:1,removeOnFail:false});return{manifestationId,estado:'RESULTADO_INCERTO',reconciliacao:'ENFILEIRADA'};
  }

  async transmitirPendentesDeManifestacao(tenantId:string,userId:string,companyId:string,correlationId:string,roles:readonly string[]){
    if(!permitidoConfigurar(roles))throw erroRisco(CODIGOS_DE_ERRO.FISCAL_RISK_ACCESS_DENIED,'Somente contador ou administrador do escritório pode retomar a outbox fiscal.');
    if(!this.manifestationQueue)return{publicados:0};const ids=await comContextoHumano(this.pool.instancia,{tenantId,usuarioId:userId,correlationId},async client=>(await client.query(`select m.id from app.fiscal_manifestation m join app.fiscal_manifestation_outbox o on o.manifestation_id=m.id and o.tenant_id=m.tenant_id and o.empresa_id=m.empresa_id where m.tenant_id=$1 and m.empresa_id=$2 and m.estado in ('APROVADA','ENFILEIRADA') and (o.estado='PENDENTE' or (o.estado='PUBLICADO' and coalesce(o.publicado_em,o.criado_em)<now()-interval '2 minutes') or (o.estado='PROCESSANDO' and o.claim_ate<now())) order by m.criado_em limit 100`,[tenantId,companyId])).rows.map(row=>String(row.id)));
    for(const manifestationId of ids){const command=ManifestacaoConclusivaCommandSchema.parse({tenantId,companyId,manifestationId,correlationId});await this.manifestationQueue.add('transmit-manifestation',command,{jobId:`fiscal-manifestation-${manifestationId}`,attempts:1,removeOnFail:false});}
    return{publicados:ids.length};
  }

  async configuracao(tenantId: string,userId: string,companyId: string,correlationId: string) {
    return comContextoHumano(this.pool.instancia,{tenantId,usuarioId:userId,correlationId},async(client)=>{
      const company=await getDfeCaptureCompany(client,companyId);
      if(!company||company.tenantId!==tenantId) throw erroRisco(CODIGOS_DE_ERRO.EMPRESA_NAO_ENCONTRADA,'Empresa não encontrada.');
      const [configuracao,historico]=await Promise.all([obterConfiguracaoDeRiscoFiscal(client,companyId,tenantId),listarHistoricoDeConfiguracoesDeRiscoFiscal(client,companyId,tenantId)]);
      return { configuracao,historico };
    });
  }

  async salvarConfiguracao(input: Readonly<{tenantId:string;userId:string;companyId:string;correlationId:string;roles:readonly string[];body:Readonly<{limite:string;motivo:string;fornecedores:readonly Readonly<{cnpj:string;nome_exibicao:string;situacao?:'ATIVO'|'ARQUIVADO';motivo:string}>[]}>}>) {
    if(!permitidoConfigurar(input.roles)) throw erroRisco(CODIGOS_DE_ERRO.FISCAL_RISK_ACCESS_DENIED,'Somente admin do escritório e contador podem manter a configuração.');
    const limit=valorMonetarioParaCentavos(input.body.limite);
    if(limit===null || limit.toString().length>18 || input.body.fornecedores.some((supplier)=>!ehCnpjValido(supplier.cnpj)))
      throw erroRisco(CODIGOS_DE_ERRO.FISCAL_RISK_CONFIGURATION_INVALID,'Limite ou CNPJ inválido.');
    const suppliers=input.body.fornecedores.map((supplier)=>({cnpj:normalizarCnpj(supplier.cnpj),nomeExibicao:supplier.nome_exibicao,
      ...(supplier.situacao?{situacao:supplier.situacao}:{}),motivo:supplier.motivo}));
    if(new Set(suppliers.map((supplier)=>supplier.cnpj)).size!==suppliers.length)
      throw erroRisco(CODIGOS_DE_ERRO.FISCAL_RISK_CONFIGURATION_INVALID,'A lista contém CNPJ repetido.');
    return comContextoHumano(this.pool.instancia,{tenantId:input.tenantId,usuarioId:input.userId,correlationId:input.correlationId},async(client)=>{
      const company=await getDfeCaptureCompany(client,input.companyId);
      if(!company||company.tenantId!==input.tenantId) throw erroRisco(CODIGOS_DE_ERRO.EMPRESA_NAO_ENCONTRADA,'Empresa não encontrada.');
      const configuracao=await publicarConfiguracaoDeRiscoFiscal(client,{tenantId:input.tenantId,empresaId:input.companyId,
        limiteCentavos:limit.toString(),motivo:input.body.motivo,atorId:input.userId,fornecedores:suppliers});
      return {configuracao};
    });
  }

  async analises(tenantId:string,userId:string,companyId:string,documentId:string,correlationId:string) {
    return comContextoHumano(this.pool.instancia,{tenantId,usuarioId:userId,correlationId},async(client)=>{
      const company=await getDfeCaptureCompany(client,companyId);
      if(!company||company.tenantId!==tenantId) throw erroRisco(CODIGOS_DE_ERRO.EMPRESA_NAO_ENCONTRADA,'Empresa não encontrada.');
      const document=await obterDocumentoParaRiscoFiscal(client,{tenantId,empresaId:companyId,documentId});
      if(!document) throw erroRisco(CODIGOS_DE_ERRO.FISCAL_RISK_DOCUMENT_NOT_ELIGIBLE,'Documento fiscal não encontrado ou inelegível.');
      return {documento:document,execucoes:await obterExecucoesDeRiscoFiscal(client,{tenantId,empresaId:companyId,documentId})};
    });
  }

  async analise(tenantId:string,userId:string,companyId:string,documentId:string,analysisId:string,correlationId:string) {
    return comContextoHumano(this.pool.instancia,{tenantId,usuarioId:userId,correlationId},async(client)=>{
      const company=await getDfeCaptureCompany(client,companyId);
      if(!company||company.tenantId!==tenantId) throw erroRisco(CODIGOS_DE_ERRO.EMPRESA_NAO_ENCONTRADA,'Empresa não encontrada.');
      const analysis=await obterAnaliseDeRiscoFiscal(client,{tenantId,empresaId:companyId,documentId,analysisId});
      if(!analysis) throw erroRisco(CODIGOS_DE_ERRO.FISCAL_RISK_DOCUMENT_NOT_ELIGIBLE,'Análise não encontrada.');
      return {analise:analysis};
    });
  }

  async reprocessar(tenantId:string,userId:string,companyId:string,documentId:string,correlationId:string,roles:readonly string[]) {
    if(!permitidoConfigurar(roles)) throw erroRisco(CODIGOS_DE_ERRO.FISCAL_RISK_ACCESS_DENIED,'Somente admin do escritório e contador podem solicitar reprocessamento técnico.');
    if(!this.queue) throw erroRisco(CODIGOS_DE_ERRO.FISCAL_RISK_PROVIDER_UNAVAILABLE,'Fila de análise indisponível.');
    const prepared=await comContextoHumano(this.pool.instancia,{tenantId,usuarioId:userId,correlationId},async(client)=>{
      const company=await getDfeCaptureCompany(client,companyId);
      if(!company||company.tenantId!==tenantId) throw erroRisco(CODIGOS_DE_ERRO.EMPRESA_NAO_ENCONTRADA,'Empresa não encontrada.');
      const document=await obterDocumentoParaRiscoFiscal(client,{tenantId,empresaId:companyId,documentId});
      const config=await obterConfiguracaoDeRiscoFiscal(client,companyId,tenantId);
      if(!document || document.especie!=='NFE_55' || document.modelo!=='55' || document.estado==='CONFLITO' || document.inconsistencia_aberta || document.ja_manifestado)
        throw erroRisco(CODIGOS_DE_ERRO.FISCAL_RISK_DOCUMENT_NOT_ELIGIBLE,'Documento não atende às condições verificáveis para reprocessamento.');
      if(!config) throw erroRisco(CODIGOS_DE_ERRO.FISCAL_RISK_CONFIGURATION_INVALID,'Configure o limite e os fornecedores antes de analisar.');
      const before=await obterExecucoesDeRiscoFiscal(client,{tenantId,empresaId:companyId,documentId});
      if(['AGUARDANDO','PROCESSANDO'].includes(String(before[0]?.['estado'])))
        throw erroRisco(CODIGOS_DE_ERRO.FISCAL_RISK_REPROCESS_ALREADY_QUEUED,'Esta NF-e já possui uma análise pendente.');
      const previous=before[0]?.['id'] as string | undefined;
      const classifierVersion=previous?`${versaoClassificador}-r${Number(before[0]?.['tentativas']??0)+1}-${previous.slice(0,8)}`:versaoClassificador;
      const execution=await criarExecucaoDeRiscoFiscal(client,{tenantId,empresaId:companyId,documentId,configurationId:config.id,
        parserVersion:document.parser_version,classifierVersion,correlationId,actorId:userId,
        ...(previous?{reprocessamentoDe:previous}:{})});
      if(!execution) throw erroRisco(CODIGOS_DE_ERRO.FISCAL_RISK_REPROCESS_ALREADY_QUEUED,'Execução idempotente já existe.');
      if(execution.estado!=='AGUARDANDO') throw erroRisco(CODIGOS_DE_ERRO.FISCAL_RISK_REPROCESS_ALREADY_QUEUED,'Esta versão já foi analisada ou está na fila.');
      await registrarEventoDeRiscoFiscal(client,{tenantId,empresaId:companyId,executionId:execution.id,state:'AGUARDANDO',code:'FISCAL_RISK_QUEUED',detail:null,correlationId});
      return {document,config,execution};
    });
    const jobId=`fiscal-risk-${prepared.execution.id}`;
    const existing=await this.queue.getJob(jobId);
    if(existing && ['waiting','active','delayed','waiting-children'].includes(await existing.getState()))
      throw erroRisco(CODIGOS_DE_ERRO.FISCAL_RISK_REPROCESS_ALREADY_QUEUED,'Esta análise já está na fila.');
    const command=FiscalRiskCommandSchema.parse({tenantId,companyId,documentId,configurationId:prepared.config.id,executionId:prepared.execution.id,correlationId});
    try{await this.queue.add(FISCAL_RISK_JOB,command,{...FISCAL_RISK_JOB_OPTIONS,jobId});}
    catch{
      await comContextoHumano(this.pool.instancia,{tenantId,usuarioId:userId,correlationId},async(client)=>{
        await atualizarEstadoDeRiscoFiscal(client,{tenantId,empresaId:companyId,executionId:prepared.execution.id,state:'FALHA',code:'FISCAL_RISK_PROVIDER_UNAVAILABLE',correlationId});
      });
      throw erroRisco(CODIGOS_DE_ERRO.FISCAL_RISK_PROVIDER_UNAVAILABLE,'Fila de análise indisponível. A solicitação pode ser retomada.');
    }
    return {documentId,executionId:prepared.execution.id,status:'QUEUED' as const};
  }
}
