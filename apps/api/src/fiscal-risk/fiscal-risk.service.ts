import { Inject, Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { atualizarEstadoDeRiscoFiscal, comContextoHumano, criarExecucaoDeRiscoFiscal, getDfeCaptureCompany, listarHistoricoDeConfiguracoesDeRiscoFiscal, obterAnaliseDeRiscoFiscal, obterConfiguracaoDeRiscoFiscal, obterDocumentoParaRiscoFiscal, obterExecucoesDeRiscoFiscal, publicarConfiguracaoDeRiscoFiscal, registrarEventoDeRiscoFiscal } from '@contaia/db';
import { ehCnpjValido, normalizarCnpj, valorMonetarioParaCentavos, CODIGOS_DE_ERRO, ErroDeDominio } from '@contaia/domain';
import { FISCAL_RISK_API_QUEUE, FISCAL_RISK_JOB, FISCAL_RISK_JOB_OPTIONS, FiscalRiskCommandSchema } from '@contaia/shared';
import { PoolDoBanco } from '../banco/pool.provider';

const versaoClassificador = 'f20-1.0.0';
const permitidoConfigurar = (roles: readonly string[]) => roles.some((role) => ['admin_escritorio','contador'].includes(role));
const erroRisco = (code: typeof CODIGOS_DE_ERRO[keyof typeof CODIGOS_DE_ERRO], message: string) => new ErroDeDominio(code,message);

@Injectable()
export class FiscalRiskService {
  constructor(private readonly pool: PoolDoBanco, @Inject(FISCAL_RISK_API_QUEUE) private readonly queue: Queue | null) {}

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
