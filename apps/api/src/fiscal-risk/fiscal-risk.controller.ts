import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { CODIGOS_DE_ERRO, ErroDeDominio } from '@contaia/domain';
import { AcaoLivre, ExigePermissao, GuardDeAcao } from '../auth/acao.guard';
import { DfeAdminTenantScope, GuardDeEscopoDeEmpresa } from '../auth/escopo';
import { GuardDeCadastro, GuardDeSessao, type RequisicaoAutenticada } from '../auth/sessao.guard';
import { autorDa, tenantDa } from '../auth/contexto-da-sessao';
import { obterCorrelationId } from '../comum/problema';
import { analisar } from '../escritorio/escritorio.dto';
import { FiscalRiskService } from './fiscal-risk.service';

const uuid=z.string().uuid();
const fornecedorSchema=z.strictObject({
  cnpj:z.string().trim().min(14).max(18), nome_exibicao:z.string().trim().min(1).max(200),
  situacao:z.enum(['ATIVO','ARQUIVADO']), motivo:z.string().trim().min(3).max(500),
});
const configSchema=z.strictObject({
  limite:z.string().trim().min(1).max(32), motivo:z.string().trim().min(3).max(500),
  fornecedores:z.array(fornecedorSchema).max(500),
});
const bodyVazio=z.strictObject({});

@Controller('companies/:companyId')
@DfeAdminTenantScope()
@UseGuards(GuardDeSessao,GuardDeCadastro,GuardDeAcao,GuardDeEscopoDeEmpresa)
export class FiscalRiskController {
  constructor(private readonly service:FiscalRiskService){}

  @Get('fiscal-risk-settings')
  @ExigePermissao('empresas.cadastro.consultar')
  configuracao(@Req() request:RequisicaoAutenticada,@Param('companyId') companyId:string){
    return this.service.configuracao(tenantDa(request),autorDa(request).usuarioId,analisar(uuid,companyId),obterCorrelationId(request));
  }

  @Put('fiscal-risk-settings')
  @HttpCode(200)
  @AcaoLivre()
  salvarConfiguracao(@Req() request:RequisicaoAutenticada,@Param('companyId') companyId:string,@Body() body:unknown){
    const entrada=analisar(configSchema,body);
    return this.service.salvarConfiguracao({tenantId:tenantDa(request),userId:autorDa(request).usuarioId,companyId:analisar(uuid,companyId),
      correlationId:obterCorrelationId(request),roles:request.sessao?.papeis??[],body:entrada});
  }

  @Get('approved-suppliers')
  @ExigePermissao('empresas.cadastro.consultar')
  fornecedores(@Req() request:RequisicaoAutenticada,@Param('companyId') companyId:string){
    return this.service.configuracao(tenantDa(request),autorDa(request).usuarioId,analisar(uuid,companyId),obterCorrelationId(request));
  }

  @Post('approved-suppliers')
  @HttpCode(200)
  @AcaoLivre()
  incluirFornecedor(@Req() request:RequisicaoAutenticada,@Param('companyId') companyId:string,@Body() body:unknown){
    const supplier=analisar(fornecedorSchema,body);
    return this.salvarFornecedor(request,companyId,supplier);
  }

  @Patch('approved-suppliers/:supplierId')
  @HttpCode(200)
  @AcaoLivre()
  atualizarFornecedor(@Req() request:RequisicaoAutenticada,@Param('companyId') companyId:string,@Param('supplierId') supplierId:string,@Body() body:unknown){
    const id=analisar(uuid,supplierId);const supplier=analisar(fornecedorSchema,body);
    return this.salvarFornecedor(request,companyId,supplier,id);
  }

  private async salvarFornecedor(request:RequisicaoAutenticada,companyId:string,supplier:z.infer<typeof fornecedorSchema>,_id?:string){
    const context={tenantId:tenantDa(request),userId:autorDa(request).usuarioId,companyId:analisar(uuid,companyId),correlationId:obterCorrelationId(request),roles:request.sessao?.papeis??[]};
    const current=await this.service.configuracao(context.tenantId,context.userId,context.companyId,context.correlationId);
    if(!current.configuracao) throw new ErroDeDominio(CODIGOS_DE_ERRO.FISCAL_RISK_CONFIGURATION_INVALID,'Salve uma configuração de limite antes de manter fornecedores.');
    if(_id&&!current.configuracao.fornecedores.some((item)=>item.id===_id)) throw new ErroDeDominio(CODIGOS_DE_ERRO.FISCAL_RISK_SUPPLIER_NOT_FOUND,'Fornecedor aprovado não encontrado nesta empresa.');
    const suppliers=(current.configuracao?.fornecedores.filter((item)=>item.id!==_id)??[])
      .map((item)=>({cnpj:item.cnpj,nome_exibicao:item.nome_exibicao,situacao:item.situacao,motivo:item.motivo}));
    suppliers.push({cnpj:supplier.cnpj,nome_exibicao:supplier.nome_exibicao,situacao:supplier.situacao,motivo:supplier.motivo});
    return this.service.salvarConfiguracao({...context,body:{limite:current.configuracao?.limite_centavos ? `${current.configuracao.limite_centavos.slice(0,-2)}.${current.configuracao.limite_centavos.slice(-2)}` : '0.00',motivo:supplier.motivo,fornecedores:suppliers}});
  }

  @Get('fiscal-documents/:documentId/risk-analyses')
  @ExigePermissao('empresas.cadastro.consultar')
  analises(@Req() request:RequisicaoAutenticada,@Param('companyId') companyId:string,@Param('documentId') documentId:string){
    return this.service.analises(tenantDa(request),autorDa(request).usuarioId,analisar(uuid,companyId),analisar(uuid,documentId),obterCorrelationId(request));
  }

  @Get('fiscal-documents/:documentId/risk-analyses/:analysisId')
  @ExigePermissao('empresas.cadastro.consultar')
  analise(@Req() request:RequisicaoAutenticada,@Param('companyId') companyId:string,@Param('documentId') documentId:string,@Param('analysisId') analysisId:string){
    return this.service.analise(tenantDa(request),autorDa(request).usuarioId,analisar(uuid,companyId),analisar(uuid,documentId),analisar(uuid,analysisId),obterCorrelationId(request));
  }

  @Post('fiscal-documents/:documentId/risk-analyses/reprocessing')
  @HttpCode(202)
  @AcaoLivre()
  reprocessar(@Req() request:RequisicaoAutenticada,@Param('companyId') companyId:string,@Param('documentId') documentId:string,@Body() body:unknown){
    analisar(bodyVazio,body);
    return this.service.reprocessar(tenantDa(request),autorDa(request).usuarioId,analisar(uuid,companyId),analisar(uuid,documentId),obterCorrelationId(request),request.sessao?.papeis??[]);
  }

  @Get('fiscal-manifestations/inbox')
  @ExigePermissao('empresas.cadastro.consultar')
  inbox(@Req() request:RequisicaoAutenticada,@Param('companyId') companyId:string,@Req() req:RequisicaoAutenticada & {query?:unknown}){
    const query=z.object({estado:z.enum(['PENDENTE','RESULTADO_INCERTO','DLQ']).optional(),tipo:z.enum(['210200','210220','210240']).optional(),confianca:z.enum(['ALTA','MEDIA','BAIXA']).optional(),risco:z.enum(['ALTO','NORMAL']).optional(),prazo:z.enum(['7','30','MAIS_30']).optional(),emitente:z.string().max(100).optional(),valor:z.enum(['ATE_1000','1000_10000','ACIMA_10000']).optional(),busca:z.string().max(100).optional(),pagina:z.coerce.number().int().min(1).max(100).optional(),ordenacao:z.enum(['PRAZO','RISCO','VALOR']).optional()}).parse(req.query??{});
    return this.service.inbox(tenantDa(request),autorDa(request).usuarioId,analisar(uuid,companyId),obterCorrelationId(request),{...(query.estado?{estado:query.estado}:{}),...(query.tipo?{tipo:query.tipo}:{}),...(query.confianca?{confianca:query.confianca}:{}),...(query.risco?{risco:query.risco}:{}),...(query.prazo?{prazo:query.prazo}:{}),...(query.emitente?{emitente:query.emitente}:{}),...(query.valor?{valor:query.valor}:{}),...(query.busca?{busca:query.busca}:{}),...(query.pagina?{pagina:query.pagina}:{}),...(query.ordenacao?{ordenacao:query.ordenacao}:{})});
  }

  @Get('fiscal-manifestations/history')
  @ExigePermissao('empresas.cadastro.consultar')
  historicoManifestacoes(@Req() request:RequisicaoAutenticada,@Param('companyId') companyId:string,@Req() req:RequisicaoAutenticada & {query?:unknown}){const pagina=z.object({pagina:z.coerce.number().int().min(1).max(100)}).default({pagina:1}).parse(req.query??{});return this.service.historicoManifestacoes(tenantDa(request),autorDa(request).usuarioId,analisar(uuid,companyId),obterCorrelationId(request),pagina.pagina);}

  @Post('fiscal-manifestations/outbox-recovery')
  @HttpCode(202)
  @AcaoLivre()
  recuperarOutbox(@Req() request:RequisicaoAutenticada,@Param('companyId') companyId:string,@Body() body:unknown){analisar(bodyVazio,body);return this.service.transmitirPendentesDeManifestacao(tenantDa(request),autorDa(request).usuarioId,analisar(uuid,companyId),obterCorrelationId(request),request.sessao?.papeis??[]);}

  @Post('fiscal-manifestations/decisions')
  @HttpCode(202)
  @AcaoLivre()
  decidir(@Req() request:RequisicaoAutenticada,@Param('companyId') companyId:string,@Body() body:unknown){
    const parsed=analisar(z.strictObject({documentId:uuid,analysisId:uuid,chaveAcesso:z.string().regex(/^\d{44}$/u),tipo:z.enum(['210200','210220','210240']),
      rejeitada:z.boolean(),motivoTroca:z.string().trim().min(3).max(500).nullable(),categoria:z.enum(['TIPO_INCORRETO','DADOS_INSUFICIENTES','EXIGE_INVESTIGACAO','DOCUMENTO_NAO_ACIONAVEL','OUTRO']).nullable(),
      nota:z.string().trim().max(500).nullable(),xJust:z.string().max(255).nullable()}),body);
    return this.service.decidirManifestacao(tenantDa(request),autorDa(request).usuarioId,analisar(uuid,companyId),obterCorrelationId(request),request.sessao?.papeis??[],parsed);
  }

  @Post('fiscal-manifestations/batch-210200')
  @HttpCode(202)
  @AcaoLivre()
  lote(@Req() request:RequisicaoAutenticada,@Param('companyId') companyId:string,@Body() body:unknown){const parsed=analisar(z.strictObject({items:z.array(z.strictObject({documentId:uuid,analysisId:uuid,chaveAcesso:z.string().regex(/^\d{44}$/u),tipo:z.literal('210200')})).min(1).max(200)}),body);return this.service.decidirManifestacoesEmLote(tenantDa(request),autorDa(request).usuarioId,analisar(uuid,companyId),obterCorrelationId(request),request.sessao?.papeis??[],parsed.items);}

  @Post('fiscal-manifestations/:manifestationId/reconciliation')
  @HttpCode(202)
  @AcaoLivre()
  reconciliar(@Req() request:RequisicaoAutenticada,@Param('companyId') companyId:string,@Param('manifestationId') manifestationId:string,@Body() body:unknown){analisar(bodyVazio,body);return this.service.reconciliarManifestacao(tenantDa(request),autorDa(request).usuarioId,analisar(uuid,companyId),obterCorrelationId(request),request.sessao?.papeis??[],analisar(uuid,manifestationId));}
}
