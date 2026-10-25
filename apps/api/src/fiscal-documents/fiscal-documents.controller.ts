import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, Res, UseGuards, UseInterceptors, UploadedFiles } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { CODIGOS_DE_ERRO, ErroDeDominio } from '@contaia/domain';
import { AcaoLivre, ExigePermissao, GuardDeAcao } from '../auth/acao.guard';
import { DfeAdminTenantScope, GuardDeEscopoDeEmpresa } from '../auth/escopo';
import { GuardDeCadastro, GuardDeSessao, type RequisicaoAutenticada } from '../auth/sessao.guard';
import { autorDa, tenantDa } from '../auth/contexto-da-sessao';
import { obterCorrelationId } from '../comum/problema';
import { analisar } from '../escritorio/escritorio.dto';
import { paginaSchema } from '../empregados/empregados.dto';
import { FiscalDocumentsService } from './fiscal-documents.service';
import { IcmsStSettlementsService } from './icms-st-settlements.service';
import { IcmsStHistoryService } from './icms-st-history.service';
import type { IcmsStLegalAccrualRule } from '@contaia/domain';
import { IcmsStLegalAccrualsService } from './icms-st-legal-accruals.service';
import { FilesInterceptor } from '@nestjs/platform-express';
import { z as zod } from 'zod';
import { IcmsStDossiersService } from './icms-st-dossiers.service';

const uuid = z.string().uuid();
const persistedUuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu);
const consultaFiscalSchema = paginaSchema.extend({
  estado: z.enum(['PENDENTE','PROCESSANDO','PROCESSADO','PENDENTE_LAYOUT','PENDENTE_IBS_CBS','XML_INVALIDO','CONFLITO','FALHA']).optional(),
});
const resolucaoTributariaSchema = z.strictObject({
  expectedDocumentRevision: z.string().min(1).max(100),
  packageId: uuid.optional(),
  resaleItemNumbers: z.array(z.number().int().positive()).max(1000).refine((items) => new Set(items).size === items.length, 'Itens duplicados não são permitidos.'),
  idempotencyKey: z.string().uuid(),
  reprocessingReason: z.string().trim().min(10).max(500).optional(),
});
const revisionSchema = z.coerce.number().int().positive();
const historicalLiabilitySchema=z.enum(['ICMS_ST_RECIPIENT_DUE','ICMS_ENTRY_ADVANCE','ICMS_ST_JOINT_LIABILITY']);
const historicalDecisionSchema=z.strictObject({
  expectedVersion:z.number().int().positive(),action:z.enum(['APPROVED','REJECTED']),
  reason:z.string().trim().min(10).max(500).nullable().optional(),
}).superRefine((input,context)=>{
  if(input.action==='REJECTED'&&(input.reason===undefined||input.reason===null))
    context.addIssue({code:'custom',message:'Rejeição exige motivo.',path:['reason']});
});
const periodoHistoricoF33Schema=z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/u).refine(value=>value>='2016-10'&&value<='2018-02','Período fora da cobertura histórica F33.');
const dataCivilQuerySchema=z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine((value)=>{
  const date=new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.valueOf())&&date.toISOString().slice(0,10)===value;
},'Data civil inválida.');
const filaResolucaoSchema = paginaSchema.extend({
  de:dataCivilQuerySchema.optional(),
  ate:dataCivilQuerySchema.optional(),
  regime:z.enum(['SIMPLES_NACIONAL','LUCRO_PRESUMIDO']).optional(),
  estadoResolucao:z.enum(['SEM_PROCESSAMENTO','INDETERMINADO','RESOLVIDO']).optional(),
  indeterminados:z.enum(['true','false']).transform((value)=>value==='true').optional(),
}).refine((query)=>query.de===undefined||query.ate===undefined||query.de<=query.ate,'Período inválido.');

@Controller('companies/:companyId/fiscal-documents')
@DfeAdminTenantScope()
@UseGuards(GuardDeSessao, GuardDeCadastro, GuardDeAcao, GuardDeEscopoDeEmpresa)
export class FiscalDocumentsController {
  constructor(private readonly service: FiscalDocumentsService, private readonly icmsStService: IcmsStSettlementsService,
    private readonly icmsStHistory: IcmsStHistoryService,private readonly icmsStLegalAccruals:IcmsStLegalAccrualsService,private readonly icmsStDossiers:IcmsStDossiersService) {}

  @Get('icms-st-dossiers/destination-rules') @ExigePermissao('fiscal.motor_tributario.consultar')
  listarRegrasDeDestino(@Req() req:RequisicaoAutenticada,@Param('companyId') companyId:string){return this.icmsStDossiers.listarRegras(tenantDa(req),autorDa(req).usuarioId,analisar(persistedUuid,companyId),obterCorrelationId(req));}

  @Post('icms-st-dossiers/destination-rules') @HttpCode(201) @ExigePermissao('fiscal.motor_tributario.simular')
  @UseInterceptors(FilesInterceptor('source',1,{limits:{fileSize:20*1024*1024,files:1,fields:1}}))
  importarRegraDeDestino(@Req() req:RequisicaoAutenticada,@Param('companyId') companyId:string,@UploadedFiles() files:readonly Readonly<{originalname:string;mimetype:string;buffer:Buffer}>[]|undefined,@Body() body:unknown){
    const input=analisar(z.strictObject({version:z.string().trim().min(1).max(100),destination:z.enum(['APPROPRIATION','COMPENSATION','TRANSFER','REFUND_REQUEST','GUIDE_PAYMENT','RECTIFICATION_BOOKKEEPING','DISPUTE_ANALYSIS']),regime:z.enum(['SIMPLES_NACIONAL','LUCRO_PRESUMIDO']),validFrom:dataCivilQuerySchema,validThrough:dataCivilQuerySchema,officialBasis:z.string().trim().min(1).max(1000),sourceUrl:z.string().url().max(2000),consultedAt:dataCivilQuerySchema,conditions:z.preprocess(value=>{if(typeof value!=='string')return value;try{return JSON.parse(value) as unknown;}catch{return undefined;}},z.array(z.string().trim().min(1).max(500)).min(1).max(100))}).refine(v=>v.validFrom<=v.validThrough,'Vigência inválida.'),body);
    if(!(req.sessao?.papeis??[]).some(r=>(['contador','admin_escritorio'] as readonly string[]).includes(r)))throw new ErroDeDominio(CODIGOS_DE_ERRO.SEM_AUTORIZACAO,'Papel sem autorização para importar fundamento de destino.');const file=files?.[0];if(!file)throw new ErroDeDominio(CODIGOS_DE_ERRO.ARQUIVO_INVALIDO,'Documento oficial obrigatório.');return this.icmsStDossiers.importarRegra(tenantDa(req),autorDa(req).usuarioId,analisar(persistedUuid,companyId),input,file,obterCorrelationId(req));}

  @Post('icms-st-dossiers/destination-rules/:packageId/review') @HttpCode(201) @AcaoLivre()
  decidirRegraDeDestino(@Req() req:RequisicaoAutenticada,@Param('companyId') companyId:string,@Param('packageId') id:string,@Body() body:unknown){if(!(req.sessao?.papeis??[]).some(r=>(['contador','admin_escritorio'] as readonly string[]).includes(r)))throw new ErroDeDominio(CODIGOS_DE_ERRO.SEM_AUTORIZACAO,'Somente contador ou admin_escritorio decide fundamento de destino.');const input=analisar(z.strictObject({action:z.enum(['APPROVED','REJECTED']),reason:z.string().trim().min(10).max(500)}),body);return this.icmsStDossiers.decidirRegra(tenantDa(req),autorDa(req).usuarioId,analisar(persistedUuid,companyId),analisar(persistedUuid,id),input.action,input.reason,obterCorrelationId(req));}

  @Get('icms-st-dossiers') @ExigePermissao('fiscal.motor_tributario.consultar')
  listarDossies(@Req() req:RequisicaoAutenticada,@Param('companyId') companyId:string){return this.icmsStDossiers.listar(tenantDa(req),autorDa(req).usuarioId,analisar(persistedUuid,companyId),obterCorrelationId(req));}

  @Post('icms-st-dossiers') @HttpCode(201) @ExigePermissao('fiscal.motor_tributario.simular')
  criarDossie(@Req() req:RequisicaoAutenticada,@Param('companyId') companyId:string,@Body() body:unknown){const input=analisar(z.strictObject({sourcePackageId:persistedUuid,accrualResultId:persistedUuid}),body);return this.icmsStDossiers.criar(tenantDa(req),autorDa(req).usuarioId,analisar(persistedUuid,companyId),input,obterCorrelationId(req));}

  @Post('icms-st-dossiers/:dossierId/evidence') @HttpCode(201) @ExigePermissao('fiscal.motor_tributario.simular')
  @UseInterceptors(FilesInterceptor('evidence',1,{limits:{fileSize:20*1024*1024,files:1,fields:3}}))
  anexarEvidenciaDossie(@Req() req:RequisicaoAutenticada,@Param('companyId') companyId:string,@Param('dossierId') dossierId:string,@UploadedFiles() files:readonly Readonly<{originalname:string;mimetype:string;buffer:Buffer}>[]|undefined,@Body() body:unknown){const input=analisar(z.strictObject({track:z.enum(['RESTITUTION','COMPLEMENT']),kind:z.string().trim().min(1).max(100),description:z.string().trim().min(10).max(1000)}),body);const roles=req.sessao?.papeis??[];if(!roles.some(r=>(['admin_escritorio','contador','auxiliar'] as readonly string[]).includes(r)))throw new ErroDeDominio(CODIGOS_DE_ERRO.SEM_AUTORIZACAO,'Papel sem autorização para preparar evidência.');const file=files?.[0];if(!file)throw new ErroDeDominio(CODIGOS_DE_ERRO.ARQUIVO_INVALIDO,'Arquivo de evidência obrigatório.');return this.icmsStDossiers.anexarEvidencia(tenantDa(req),autorDa(req).usuarioId,analisar(persistedUuid,companyId),analisar(persistedUuid,dossierId),input.track,input.kind,input.description,file,obterCorrelationId(req));}

  @Get('icms-st-dossiers/:dossierId/evidence') @ExigePermissao('fiscal.motor_tributario.consultar')
  listarEvidenciasDossie(@Req() req:RequisicaoAutenticada,@Param('companyId') companyId:string,@Param('dossierId') dossierId:string){return this.icmsStDossiers.listarEvidencias(tenantDa(req),autorDa(req).usuarioId,analisar(persistedUuid,companyId),analisar(persistedUuid,dossierId),obterCorrelationId(req));}

  @Get('icms-st-dossiers/:dossierId/evidence/:evidenceId/download') @ExigePermissao('fiscal.motor_tributario.consultar')
  baixarEvidenciaDossie(@Req() req:RequisicaoAutenticada,@Param('companyId') companyId:string,@Param('dossierId') dossierId:string,@Param('evidenceId') evidenceId:string,@Res() response:Response){return this.icmsStDossiers.baixarEvidencia(tenantDa(req),autorDa(req).usuarioId,analisar(persistedUuid,companyId),analisar(persistedUuid,dossierId),analisar(persistedUuid,evidenceId),obterCorrelationId(req)).then(file=>response.type(file.contentType).setHeader('Content-Disposition',`attachment; filename="${file.nome.replace(/[\r\n"\\]/gu,'_')}"`).setHeader('Cache-Control','private, no-store').setHeader('X-Content-SHA256',file.hash).send(file.conteudo));}

  @Post('icms-st-dossiers/:dossierId/:track/decision') @HttpCode(201) @AcaoLivre()
  decidirTrilhaDossie(@Req() req:RequisicaoAutenticada,@Param('companyId') companyId:string,@Param('dossierId') dossierId:string,@Param('track') track:string,@Body() body:unknown){const input=analisar(z.strictObject({action:z.enum(['APPROVED','REJECTED','RETURNED_FOR_EVIDENCE']),reason:z.string().trim().min(10).max(500),evidenceIds:z.array(z.string().trim().min(1).max(200)).min(1).max(100),conditionConfirmations:z.array(z.number().int().nonnegative()).max(100),destination:z.enum(['APPROPRIATION','COMPENSATION','TRANSFER','REFUND_REQUEST','GUIDE_PAYMENT','RECTIFICATION_BOOKKEEPING','DISPUTE_ANALYSIS']).nullable(),rulePackageId:persistedUuid.nullable()}),body);if(track!=='RESTITUTION'&&track!=='COMPLEMENT')throw new ErroDeDominio(CODIGOS_DE_ERRO.ARQUIVO_INVALIDO,'Trilha inválida.');return this.icmsStDossiers.decidir(tenantDa(req),autorDa(req).usuarioId,analisar(persistedUuid,companyId),analisar(persistedUuid,dossierId),track,input,req.sessao?.papeis??[],obterCorrelationId(req));}

  @Get('icms-st-dossiers/:dossierId/export') @ExigePermissao('fiscal.motor_tributario.consultar')
  exportarDossie(@Req() req:RequisicaoAutenticada,@Param('companyId') companyId:string,@Param('dossierId') id:string,@Query() query:unknown,@Res() response:Response){const input=analisar(z.strictObject({format:z.enum(['PDF','CSV','JSON'])}),query);return this.icmsStDossiers.exportar(tenantDa(req),autorDa(req).usuarioId,analisar(persistedUuid,companyId),analisar(persistedUuid,id),input.format,obterCorrelationId(req)).then(file=>response.type(file.contentType).setHeader('Content-Disposition',`attachment; filename="${file.nome}"`).setHeader('X-Content-SHA256',file.hash).send(file.conteudo));}

  @Post('icms-st-history-packages')
  @HttpCode(201)
  @ExigePermissao('fiscal.motor_tributario.simular')
  gerarPacoteHistoricoIcmsSt(@Req() request:RequisicaoAutenticada,@Param('companyId') companyId:string,@Body() body:unknown){
    const input=analisar(z.strictObject({regime:z.enum(['SIMPLES_NACIONAL','LUCRO_PRESUMIDO']),periodStart:periodoHistoricoF33Schema,
      periodEnd:periodoHistoricoF33Schema}).refine(value=>value.periodStart<=value.periodEnd,'Período inválido.'),body);
    return this.icmsStHistory.gerar(tenantDa(request),autorDa(request).usuarioId,analisar(persistedUuid,companyId),input.regime,input.periodStart,input.periodEnd,obterCorrelationId(request));
  }

  @Get('icms-st-history-packages/:packageId')
  @ExigePermissao('fiscal.motor_tributario.consultar')
  baixarPacoteHistoricoIcmsSt(@Req() request:RequisicaoAutenticada,@Param('companyId') companyId:string,@Param('packageId') packageId:string,
    @Query() query:unknown,@Res() response:Response){
    const input=analisar(z.strictObject({format:z.enum(['PDF','CSV','JSON'])}),query);
    return this.icmsStHistory.baixar(tenantDa(request),autorDa(request).usuarioId,analisar(persistedUuid,companyId),analisar(persistedUuid,packageId),input.format,obterCorrelationId(request))
      .then(file=>response.type(file.contentType).setHeader('Content-Disposition',`attachment; filename="${file.nome}"`).setHeader('X-Content-SHA256',file.hash).send(file.conteudo));
  }

  @Get('icms-st-legal-accrual-sources')
  @ExigePermissao('fiscal.motor_tributario.consultar')
  listarFontesDeAcrescimos(@Req() request:RequisicaoAutenticada,@Param('companyId') companyId:string){
    return this.icmsStLegalAccruals.listarFontes(tenantDa(request),autorDa(request).usuarioId,analisar(persistedUuid,companyId),obterCorrelationId(request));
  }

  @Get('icms-st-legal-rule-packages')
  @ExigePermissao('fiscal.motor_tributario.consultar')
  listarPacotesNormativosF34(@Req() request:RequisicaoAutenticada,@Param('companyId') companyId:string){
    return this.icmsStLegalAccruals.listarPacotesNormativos(tenantDa(request),autorDa(request).usuarioId,analisar(persistedUuid,companyId),obterCorrelationId(request));
  }

  @Get('icms-st-legal-accruals')
  @ExigePermissao('fiscal.motor_tributario.consultar')
  listarResultadosF34(@Req() request:RequisicaoAutenticada,@Param('companyId') companyId:string,@Query() query:unknown){
    const input=analisar(z.strictObject({sourcePackageId:persistedUuid}),query);
    return this.icmsStLegalAccruals.listarResultados(tenantDa(request),autorDa(request).usuarioId,analisar(persistedUuid,companyId),input.sourcePackageId,obterCorrelationId(request));
  }

  @Post('icms-st-history-packages/:packageId/legal-approval')
  @HttpCode(201)
  @AcaoLivre()
  aprovarFonteHistoricaF34(@Req() request:RequisicaoAutenticada,@Param('companyId') companyId:string,@Param('packageId') packageId:string,@Body() body:unknown){
    analisar(z.strictObject({}),body);
    if(!(request.sessao?.papeis??[]).some(role=>(['admin_escritorio','contador'] as readonly string[]).includes(role)))
      throw new ErroDeDominio(CODIGOS_DE_ERRO.SEM_AUTORIZACAO,'Somente contador ou admin_escritorio aprova fonte F33.');
    return this.icmsStLegalAccruals.aprovarFonte(tenantDa(request),autorDa(request).usuarioId,analisar(persistedUuid,companyId),analisar(persistedUuid,packageId),obterCorrelationId(request));
  }

  @Post('icms-st-legal-rule-packages')
  @HttpCode(201)
  @ExigePermissao('fiscal.motor_tributario.simular')
  @UseInterceptors(FilesInterceptor('sources',20,{limits:{fileSize:20*1024*1024,files:20,fields:1}}))
  importarPacoteLegalF34(@Req() request:RequisicaoAutenticada,@Param('companyId') companyId:string,
    @UploadedFiles() files:readonly Readonly<{originalname:string;mimetype:string;buffer:Buffer}>[]|undefined,@Body() body:unknown){
    const manifest=analisar(z.strictObject({manifest:z.string().max(2_000_000)}),body);
    let decoded:unknown;try{decoded=JSON.parse(manifest.manifest) as unknown;}catch{throw new ErroDeDominio(CODIGOS_DE_ERRO.ARQUIVO_INVALIDO,'Manifesto JSON inválido.');}
    const legalRule=z.strictObject({id:z.string().min(1).max(200),version:z.string().min(1).max(100),component:z.enum(['MONETARY_UPDATE','LATE_INTEREST','LATE_PAYMENT_FINE','INFRACTION_PENALTY']),
      tracks:z.array(z.enum(['RESTITUTION','COMPLEMENT'])).min(1),validFrom:dataCivilQuerySchema,validThrough:dataCivilQuerySchema,formula:z.enum(['SIMPLE_DAILY_PPM','FIXED_PERCENT_PPM']),
      ratePpm:z.number().int().nonnegative().max(1_000_000_000),annualizationDays:z.number().int().positive(),termStartBasis:z.enum(['SOURCE_FACT_DATE','COMPETENCE_START','COMPETENCE_END']),
      termStartOffsetDays:z.number().int().min(-366).max(366),rounding:z.enum(['HALF_UP','DOWN']),officialBasis:z.string().trim().min(1).max(1000),sourceSha256:z.string().regex(/^[0-9a-f]{64}$/u),formalActId:persistedUuid.optional()});
    const input=analisar(z.strictObject({version:z.string().trim().min(1).max(100),coverageThrough:dataCivilQuerySchema,
      requiredComponents:z.strictObject({RESTITUTION:z.array(z.enum(['MONETARY_UPDATE','LATE_INTEREST','LATE_PAYMENT_FINE','INFRACTION_PENALTY']),).max(4),COMPLEMENT:z.array(z.enum(['MONETARY_UPDATE','LATE_INTEREST','LATE_PAYMENT_FINE','INFRACTION_PENALTY'])).max(4)}),
      rules:z.array(legalRule).min(1).max(5000),sources:z.array(z.strictObject({name:z.string().min(1).max(255),sha256:z.string().regex(/^[0-9a-f]{64}$/u),officialBasis:z.string().trim().min(1).max(1000),consultedAt:dataCivilQuerySchema})).min(1).max(20)}),decoded);
    return this.icmsStLegalAccruals.importarPacoteNormativo(tenantDa(request),autorDa(request).usuarioId,analisar(persistedUuid,companyId),
      {...input,rules:input.rules as readonly IcmsStLegalAccrualRule[]},files??[],obterCorrelationId(request));
  }

  @Post('icms-st-legal-rule-packages/:packageId/review')
  @HttpCode(201)
  @AcaoLivre()
  decidirPacoteLegalF34(@Req() request:RequisicaoAutenticada,@Param('companyId') companyId:string,@Param('packageId') packageId:string,@Body() body:unknown){
    if(!(request.sessao?.papeis??[]).some(role=>(['admin_escritorio','contador'] as readonly string[]).includes(role)))
      throw new ErroDeDominio(CODIGOS_DE_ERRO.SEM_AUTORIZACAO,'Somente contador ou admin_escritorio decide pacote normativo.');
    const input=analisar(z.strictObject({action:z.enum(['APPROVED','REJECTED']),reason:z.string().trim().min(10).max(500).nullable().optional()}).superRefine((value,ctx)=>{
      if(value.action==='REJECTED'&&!value.reason)ctx.addIssue({code:'custom',message:'Rejeição exige motivo.',path:['reason']});}),body);
    return this.icmsStLegalAccruals.decidirPacoteNormativo(tenantDa(request),autorDa(request).usuarioId,analisar(persistedUuid,companyId),analisar(persistedUuid,packageId),input.action,input.reason??null,obterCorrelationId(request));
  }

  @Post('icms-st-history-packages/:packageId/legal-acts')
  @HttpCode(201)
  @ExigePermissao('fiscal.motor_tributario.simular')
  @UseInterceptors(FilesInterceptor('arquivo',1,{limits:{fileSize:10*1024*1024,files:1,fields:16}}))
  importarAtoFormalF34(@Req() request:RequisicaoAutenticada,@Param('companyId') companyId:string,@Param('packageId') packageId:string,
    @UploadedFiles() files:readonly Readonly<{originalname:string;mimetype:string;buffer:Buffer}>[]|undefined,@Body() body:unknown){
    const input=analisar(z.strictObject({issuer:z.string().trim().min(1).max(200),actNumber:z.string().trim().min(1).max(120),
      actType:z.enum(['ASSESSMENT_NOTICE','SUMMONS','DECISION','OTHER']),actDate:dataCivilQuerySchema,periodStart:dataCivilQuerySchema,periodEnd:dataCivilQuerySchema,
      officialBasis:z.string().trim().min(1).max(1000),canonicalFacts:z.string().max(1_000_000)}),body);
    let canonicalFacts:unknown;try{canonicalFacts=JSON.parse(input.canonicalFacts) as unknown;}catch{throw new ErroDeDominio(CODIGOS_DE_ERRO.ARQUIVO_INVALIDO,'Fatos do ato formal em JSON inválido.');}
    const facts=analisar(z.record(z.string(),z.unknown()),canonicalFacts);const file=files?.[0];
    if(!file)throw new ErroDeDominio(CODIGOS_DE_ERRO.ARQUIVO_INVALIDO,'Arquivo do ato formal obrigatório.');
    return this.icmsStLegalAccruals.importarAtoFormal(tenantDa(request),autorDa(request).usuarioId,analisar(persistedUuid,companyId),
      {sourcePackageId:analisar(persistedUuid,packageId),...input,canonicalFacts:facts},file,obterCorrelationId(request));
  }

  @Get('icms-st-history-packages/:packageId/legal-acts')
  @ExigePermissao('fiscal.motor_tributario.consultar')
  listarAtosFormaisF34(@Req() request:RequisicaoAutenticada,@Param('companyId') companyId:string,@Param('packageId') packageId:string){
    return this.icmsStLegalAccruals.listarAtos(tenantDa(request),autorDa(request).usuarioId,analisar(persistedUuid,companyId),analisar(persistedUuid,packageId),obterCorrelationId(request));
  }

  @Post('icms-st-legal-acts/:actId/review')
  @HttpCode(201)
  @AcaoLivre()
  decidirAtoFormalF34(@Req() request:RequisicaoAutenticada,@Param('companyId') companyId:string,@Param('actId') actId:string,@Body() body:unknown){
    if(!(request.sessao?.papeis??[]).some(role=>(['admin_escritorio','contador'] as readonly string[]).includes(role)))
      throw new ErroDeDominio(CODIGOS_DE_ERRO.SEM_AUTORIZACAO,'Somente contador ou admin_escritorio decide ato formal.');
    const input=analisar(z.strictObject({action:z.enum(['APPROVED','REJECTED']),reason:z.string().trim().min(10).max(500).nullable().optional()}).superRefine((value,ctx)=>{
      if(value.action==='REJECTED'&&!value.reason)ctx.addIssue({code:'custom',message:'Rejeição exige motivo.',path:['reason']});}),body);
    return this.icmsStLegalAccruals.decidirAtoFormal(tenantDa(request),autorDa(request).usuarioId,analisar(persistedUuid,companyId),analisar(persistedUuid,actId),input.action,input.reason??null,obterCorrelationId(request));
  }

  @Post('icms-st-legal-accruals')
  @HttpCode(201)
  @ExigePermissao('fiscal.motor_tributario.simular')
  calcularAcrescimosLegaisF34(@Req() request:RequisicaoAutenticada,@Param('companyId') companyId:string,@Body() body:unknown){
    const input=analisar(z.strictObject({sourcePackageId:persistedUuid,referenceDate:dataCivilQuerySchema,rulePackageId:persistedUuid.nullable(),formalActIds:z.array(persistedUuid).max(100)}),body);
    return this.icmsStLegalAccruals.calcular(tenantDa(request),autorDa(request).usuarioId,analisar(persistedUuid,companyId),input,obterCorrelationId(request));
  }

  @Post('icms-st-legal-accruals/:resultId/review')
  @HttpCode(201)
  @ExigePermissao('fiscal.motor_tributario.simular')
  revisarAcrescimosLegaisF34(@Req() request:RequisicaoAutenticada,@Param('companyId') companyId:string,@Param('resultId') resultId:string,@Body() body:unknown){
    const input=analisar(z.strictObject({reason:z.string().trim().min(1).max(500)}),body);
    return this.icmsStLegalAccruals.revisarResultado(tenantDa(request),autorDa(request).usuarioId,analisar(persistedUuid,companyId),analisar(persistedUuid,resultId),input.reason,obterCorrelationId(request));
  }

  @Get('icms-st-legal-accruals/:resultId/detail')
  @ExigePermissao('fiscal.motor_tributario.consultar')
  obterResultadoF34(@Req() request:RequisicaoAutenticada,@Param('companyId') companyId:string,@Param('resultId') resultId:string){
    return this.icmsStLegalAccruals.obterResultado(tenantDa(request),autorDa(request).usuarioId,analisar(persistedUuid,companyId),analisar(persistedUuid,resultId),obterCorrelationId(request));
  }

  @Get('icms-st-legal-accruals/:resultId')
  @ExigePermissao('fiscal.motor_tributario.consultar')
  exportarAcrescimosLegaisF34(@Req() request:RequisicaoAutenticada,@Param('companyId') companyId:string,@Param('resultId') resultId:string,@Query() query:unknown,@Res() response:Response){
    const input=analisar(z.strictObject({format:z.enum(['PDF','CSV','JSON'])}),query);
    return this.icmsStLegalAccruals.exportar(tenantDa(request),autorDa(request).usuarioId,analisar(persistedUuid,companyId),analisar(persistedUuid,resultId),input.format,obterCorrelationId(request))
      .then(file=>response.type(file.contentType).setHeader('Content-Disposition',`attachment; filename="${file.nome}"`).setHeader('X-Content-SHA256',file.hash).send(file.conteudo));
  }

  @Post('icms-st-settlements')
  @HttpCode(201)
  @ExigePermissao('fiscal.motor_tributario.simular')
  processarApuracaoIcmsSt(@Req() request: RequisicaoAutenticada, @Param('companyId') companyId: string, @Body() body: unknown) {
    const input = analisar(z.strictObject({ competence: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/u), idempotencyKey: z.string().uuid(),
      reprocessingReason: z.string().trim().min(10).max(500).optional() }), body);
    return this.icmsStService.process(tenantDa(request), autorDa(request).usuarioId, companyId, input.competence,
      obterCorrelationId(request), input);
  }

  @Post('icms-st-settlements/:snapshotId/review')
  @HttpCode(201)
  @AcaoLivre()
  revisarApuracaoIcmsSt(@Req() request: RequisicaoAutenticada, @Param('companyId') companyId: string,
    @Param('snapshotId') snapshotId: string, @Body() body: unknown) {
    const input = analisar(z.strictObject({
      expectedRevision: z.number().int().positive(), action: z.enum(['SUBMITTED','APPROVED','REJECTED']),
      reason: z.string().trim().min(10).max(500).nullable().optional(),
    }).superRefine((value, context) => {
      const roles = request.sessao?.papeis ?? [];
      if (value.action === 'REJECTED' && (value.reason === undefined || value.reason === null)) {
        context.addIssue({ code: 'custom', message: 'Rejeição exige motivo.', path: ['reason'] });
      }
      if (value.action === 'SUBMITTED' && (!roles.some((role) => (['admin_escritorio','contador','auxiliar'] as readonly string[]).includes(role)) ||
          !request.sessao?.permissoes.includes('fiscal.motor_tributario.simular'))) {
        context.addIssue({ code: 'custom', message: 'Papel sem autorização para submeter apuração.', path: ['action'] });
      }
      if ((value.action === 'APPROVED' || value.action === 'REJECTED') && !roles.some((role) => (['admin_escritorio','contador'] as readonly string[]).includes(role))) {
        context.addIssue({ code: 'custom', message: 'Somente contador ou admin do escritório decide apuração.', path: ['action'] });
      }
    }), body);
    return this.icmsStService.review(tenantDa(request), autorDa(request).usuarioId, companyId, analisar(persistedUuid, snapshotId),
      input.expectedRevision, input.action, input.reason ?? null, obterCorrelationId(request));
  }

  @Post('icms-st-returns')
  @HttpCode(201)
  @AcaoLivre()
  @UseInterceptors(FilesInterceptor('arquivo',1,{limits:{fileSize:10*1024*1024,files:1,fields:32}}))
  registrarDevolucaoIcmsSt(@Req() request:RequisicaoAutenticada,@Param('companyId') companyId:string,
    @UploadedFiles() files:readonly Readonly<{originalname:string;mimetype:string;buffer:Buffer}>[]|undefined,@Body() body:unknown) {
    const roles=request.sessao?.papeis??[];
    if(!roles.some(role=>(['admin_escritorio','contador','auxiliar'] as readonly string[]).includes(role))||
       !request.sessao?.permissoes.includes('fiscal.motor_tributario.simular'))
      throw new ErroDeDominio(CODIGOS_DE_ERRO.SEM_AUTORIZACAO,'Registro de evidência exige papel autorizado e permissão para simular.');
    const input=analisar(z.strictObject({originalSnapshotId:persistedUuid,originalLineId:persistedUuid,
      returnDocumentIdentity:z.string().regex(/^\d{44}$/u),returnItemIdentity:z.string().regex(/^[1-9]\d{0,2}$/u),
      eventDate:dataCivilQuerySchema,unit:z.string().trim().min(1).max(20),returnedQuantityScaled:z.string().regex(/^\d{1,38}$/u),
      returnedQuantity:z.string().regex(/^\d+(?:[.,]\d{1,10})?$/u),returnDocumentNumber:z.string().regex(/^\d{1,20}$/u),
      returnAccessKey:z.string().regex(/^\d{44}$/u),returnModel:z.enum(['55','65']),returnSeries:z.string().trim().min(1).max(20),
      returnCfop:z.string().regex(/^\d{4}$/u),ncm:z.string().regex(/^\d{8}$/u).nullable().optional().default(null),productCode:z.string().trim().max(60).optional().default(''),
      productDescription:z.string().trim().max(120).optional().default(''),unitPrice:z.string().regex(/^\d+(?:[.,]\d{1,3})?$/u).or(z.literal('')),
      total:z.string().regex(/^\d+(?:[.,]\d{1,2})?$/u).or(z.literal('')),efdDate:dataCivilQuerySchema.nullable(),
      evidenceOrigin:z.enum(['MANUAL_DOCUMENT','EFD','NORMALIZED_NFE']).default('MANUAL_DOCUMENT'),
      idempotencyKey:uuid}),body);
    const file=files?.[0];
    if(!file)throw new ErroDeDominio(CODIGOS_DE_ERRO.ICMS_ST_EVENT_EVIDENCE_INVALID,'Anexo comprobatório obrigatório.');
    return this.icmsStService.registerManualReturn(tenantDa(request),autorDa(request).usuarioId,companyId,input,
      {nomeOriginal:file.originalname,tipoConteudo:file.mimetype,conteudo:file.buffer},obterCorrelationId(request));
  }

  @Post('icms-st-returns/:eventId/review')
  @HttpCode(201)
  @AcaoLivre()
  revisarDevolucaoIcmsSt(@Req() request:RequisicaoAutenticada,@Param('companyId') companyId:string,
    @Param('eventId') eventId:string,@Body() body:unknown) {
    const input=analisar(z.strictObject({action:z.enum(['APPROVED','REJECTED']),reason:z.string().trim().min(10).max(500).nullable().optional()})
      .superRefine((value,context)=>{
        const roles=request.sessao?.papeis??[];
        if(!roles.some(role=>(['admin_escritorio','contador'] as readonly string[]).includes(role)))
          context.addIssue({code:'custom',message:'Somente contador ou admin pode decidir devolução.',path:['action']});
        if(value.action==='REJECTED'&&(value.reason===undefined||value.reason===null))
          context.addIssue({code:'custom',message:'Rejeição exige motivo.',path:['reason']});
      }),body);
    return this.icmsStService.reviewManualReturn(tenantDa(request),autorDa(request).usuarioId,companyId,analisar(persistedUuid,eventId),
      input.action,input.reason??null,obterCorrelationId(request));
  }

  @Get('icms-st-settlements/:snapshotId')
  @ExigePermissao('fiscal.motor_tributario.consultar')
  obterApuracaoIcmsSt(@Req() request: RequisicaoAutenticada, @Param('companyId') companyId: string,
    @Param('snapshotId') snapshotId: string, @Query() query: unknown) {
    const input = analisar(paginaSchema.extend({ modelo: z.enum(['55','65']).optional() }), query);
    return this.icmsStService.get(tenantDa(request), autorDa(request).usuarioId, companyId, analisar(persistedUuid, snapshotId), obterCorrelationId(request), input.pagina, input.modelo);
  }

  @Get('icms-st-settlements')
  @ExigePermissao('fiscal.motor_tributario.consultar')
  listarApuracoesIcmsSt(@Req() request: RequisicaoAutenticada, @Param('companyId') companyId: string, @Query() query: unknown) {
    const input=analisar(z.strictObject({modelo:z.enum(['55','65']).optional()}),query);
    return this.icmsStService.list(tenantDa(request),autorDa(request).usuarioId,companyId,obterCorrelationId(request),input.modelo);
  }

  @Post('nfce-imports')
  @HttpCode(202)
  @AcaoLivre()
  @UseInterceptors(FilesInterceptor('arquivos',10,{limits:{fileSize:10*1024*1024,files:10,fields:1}}))
  importarNfce(@Req() request:RequisicaoAutenticada,@Param('companyId') companyId:string,@UploadedFiles() files:readonly Readonly<{originalname:string;mimetype:string;buffer:Buffer}>[]|undefined,@Body() body:unknown){
    const actor=autorDa(request);const roles=request.sessao?.papeis??[];
    if(!roles.some(role=>(['admin_escritorio','contador','auxiliar'] as readonly string[]).includes(role)))throw new ErroDeDominio(CODIGOS_DE_ERRO.SEM_AUTORIZACAO,'Papel sem autorização para importar NFC-e.');
    const input=analisar(zod.strictObject({origem:zod.enum(['PORTAL_GO','ERP','EMISSOR'])}),body);
    const received=(files??[]).map(file=>({nomeOriginal:file.originalname,tipoConteudo:file.mimetype,conteudo:file.buffer}));
    return this.service.importarNfce(tenantDa(request),actor.usuarioId,companyId,obterCorrelationId(request),input.origem,received);
  }

  @Get('nfce-imports/:batchId')
  @ExigePermissao('empresas.cadastro.consultar')
  obterLoteNfce(@Req() request:RequisicaoAutenticada,@Param('companyId') companyId:string,@Param('batchId') batchId:string){
    return this.service.obterLoteNfce(tenantDa(request),autorDa(request).usuarioId,companyId,analisar(uuid,batchId),obterCorrelationId(request));
  }

  @Get('nfce-imports/:batchId/report')
  @ExigePermissao('empresas.cadastro.consultar')
  async relatorioLoteNfce(@Req() request:RequisicaoAutenticada,@Param('companyId') companyId:string,@Param('batchId') batchId:string,@Res() response:Response){
    const csv=await this.service.relatorioLoteNfce(tenantDa(request),autorDa(request).usuarioId,companyId,analisar(uuid,batchId),obterCorrelationId(request));response.status(200).type('text/csv; charset=utf-8').setHeader('Content-Disposition','attachment; filename="nfce-importacao.csv"').setHeader('Cache-Control','private, no-store').send(csv);
  }

  @Get('nfce-imports/items/:itemId/original')
  @ExigePermissao('empresas.cadastro.consultar')
  async originalEventoNfce(@Req() request:RequisicaoAutenticada,@Param('companyId') companyId:string,@Param('itemId') itemId:string,@Res() response:Response){
    const file=await this.service.originalEventoNfce(tenantDa(request),autorDa(request).usuarioId,companyId,analisar(uuid,itemId),obterCorrelationId(request));response.status(200).type('application/xml').setHeader('Content-Disposition','attachment; filename="nfce-evento-original.xml"').setHeader('Cache-Control','private, no-store').send(file.conteudo);
  }

  @Get(':documentId/nfce-original')
  @ExigePermissao('empresas.cadastro.consultar')
  async originalNfce(@Req() request:RequisicaoAutenticada,@Param('companyId') companyId:string,@Param('documentId') documentId:string,@Res() response:Response){
    const file=await this.service.originalNfce(tenantDa(request),autorDa(request).usuarioId,companyId,analisar(uuid,documentId),obterCorrelationId(request));response.status(200).type('application/xml').setHeader('Content-Disposition','attachment; filename="nfce-original.xml"').setHeader('Cache-Control','private, no-store').send(file.conteudo);
  }

  @Get()
  @ExigePermissao('empresas.cadastro.consultar')
  listar(@Req() request: RequisicaoAutenticada, @Param('companyId') companyId: string, @Query() query: unknown) {
    const consulta = analisar(consultaFiscalSchema, query);
    return this.service.listar(tenantDa(request), autorDa(request).usuarioId, companyId, obterCorrelationId(request), consulta.pagina, consulta.estado ?? null);
  }

  @Get('tax-treatment-resolutions/queue')
  @ExigePermissao('fiscal.motor_tributario.consultar')
  listarFilaTributaria(@Req() request:RequisicaoAutenticada,@Param('companyId') companyId:string,@Query() query:unknown) {
    const filters=analisar(filaResolucaoSchema,query);
    return this.service.listarFilaTributaria(tenantDa(request),autorDa(request).usuarioId,companyId,obterCorrelationId(request),filters.pagina,{
      from:filters.de??null,to:filters.ate??null,regime:filters.regime??null,
      state:filters.estadoResolucao??null,hasIndeterminate:filters.indeterminados??null,
    });
  }

  @Get('acknowledgements')
  @ExigePermissao('empresas.cadastro.consultar')
  listarCiencias(@Req() request:RequisicaoAutenticada,@Param('companyId') companyId:string){
    return this.service.listarCiencias(tenantDa(request),autorDa(request).usuarioId,companyId,obterCorrelationId(request));
  }

  @Get('acknowledgements/:acknowledgementId')
  @ExigePermissao('empresas.cadastro.consultar')
  obterCiencia(@Req() request:RequisicaoAutenticada,@Param('companyId') companyId:string,@Param('acknowledgementId') id:string){
    return this.service.obterCiencia(tenantDa(request),autorDa(request).usuarioId,companyId,analisar(uuid,id),obterCorrelationId(request));
  }

  @Post('acknowledgements/:acknowledgementId/reprocessing')
  @HttpCode(202)
  @AcaoLivre()
  retomarCiencia(@Req() request:RequisicaoAutenticada,@Param('companyId') companyId:string,@Param('acknowledgementId') id:string,@Body() body:unknown){
    analisar(z.strictObject({}),body);
    const papeis=request.sessao?.papeis??[];
    if(!papeis.some((papel)=>(['admin_escritorio','contador','auxiliar'] as readonly string[]).includes(papel)))
      throw new ErroDeDominio(CODIGOS_DE_ERRO.FISCAL_DOCUMENT_ACCESS_DENIED,'Sem autorização para retomada técnica da Ciência.');
    return this.service.retomarCiencia(tenantDa(request),autorDa(request).usuarioId,companyId,analisar(uuid,id),obterCorrelationId(request));
  }

  @Get(':documentId')
  @ExigePermissao('empresas.cadastro.consultar')
  obter(@Req() request: RequisicaoAutenticada, @Param('companyId') companyId: string, @Param('documentId') documentId: string) {
    return this.service.obter(tenantDa(request), autorDa(request).usuarioId, companyId, analisar(uuid, documentId), obterCorrelationId(request));
  }

  @Post(':documentId/tax-treatment-resolutions')
  @HttpCode(201)
  @ExigePermissao('fiscal.motor_tributario.simular')
  resolverTratamentoTributario(@Req() request: RequisicaoAutenticada, @Param('companyId') companyId: string,
    @Param('documentId') documentId: string, @Body() body: unknown) {
    const input = analisar(resolucaoTributariaSchema, body);
    return this.service.resolverTratamentoTributario(tenantDa(request), autorDa(request).usuarioId, companyId,
      analisar(uuid,documentId), obterCorrelationId(request), input);
  }

  @Post(':documentId/tax-treatment-resolutions/:snapshotId/historical-reviews')
  @HttpCode(201)
  @ExigePermissao('fiscal.motor_tributario.simular')
  submeterRevisaoHistorica(@Req() request:RequisicaoAutenticada,@Param('companyId') companyId:string,
    @Param('snapshotId') snapshotId:string,@Body() body:unknown) {
    const input=analisar(z.strictObject({liabilityKind:historicalLiabilitySchema}),body);
    return this.service.submeterRevisaoHistorica(tenantDa(request),autorDa(request).usuarioId,companyId,
      analisar(uuid,snapshotId),input.liabilityKind,obterCorrelationId(request));
  }

  @Post('tax-treatment-resolutions/historical-reviews/:reviewId/decision')
  @HttpCode(200)
  @AcaoLivre()
  decidirRevisaoHistorica(@Req() request:RequisicaoAutenticada,@Param('companyId') companyId:string,
    @Param('reviewId') reviewId:string,@Body() body:unknown) {
    const papeis=request.sessao?.papeis??[];
    if(!papeis.some((papel)=>(['admin_escritorio','contador'] as readonly string[]).includes(papel)))
      throw new ErroDeDominio(CODIGOS_DE_ERRO.TAX_REVIEW_DECISION_FORBIDDEN,'Somente contador ou admin_escritorio decide resultado histórico.');
    const input=analisar(historicalDecisionSchema,body);
    return this.service.decidirRevisaoHistorica(tenantDa(request),autorDa(request).usuarioId,companyId,
      analisar(uuid,reviewId),{expectedVersion:input.expectedVersion,action:input.action,reason:input.reason??null},obterCorrelationId(request));
  }

  @Get(':documentId/tax-treatment-resolutions')
  @ExigePermissao('fiscal.motor_tributario.consultar')
  listarTratamentosTributarios(@Req() request: RequisicaoAutenticada, @Param('companyId') companyId: string,
    @Param('documentId') documentId: string) {
    return this.service.listarTratamentosTributarios(tenantDa(request), autorDa(request).usuarioId, companyId,
      analisar(uuid,documentId), obterCorrelationId(request));
  }

  @Get(':documentId/tax-treatment-resolutions/compare')
  @ExigePermissao('fiscal.motor_tributario.consultar')
  async compararTratamentosTributarios(@Req() request: RequisicaoAutenticada, @Param('companyId') companyId: string,
    @Param('documentId') documentId: string, @Query() query: unknown) {
    const input = analisar(z.strictObject({ fromRevision: revisionSchema, toRevision: revisionSchema }), query);
    const [from,to] = await Promise.all([
      this.service.listarTratamentosTributarios(tenantDa(request),autorDa(request).usuarioId,companyId,analisar(uuid,documentId),obterCorrelationId(request),input.fromRevision),
      this.service.listarTratamentosTributarios(tenantDa(request),autorDa(request).usuarioId,companyId,analisar(uuid,documentId),obterCorrelationId(request),input.toRevision),
    ]);
    const before = new Map(from.itens.map((row) => [Number(row['item_number']),row]));
    const after = new Map(to.itens.map((row) => [Number(row['item_number']),row]));
    const itemNumbers = [...new Set([...before.keys(),...after.keys()])].sort((a,b)=>a-b);
    const diff = itemNumbers.map((itemNumber) => {
      const oldRow = before.get(itemNumber);
      const newRow = after.get(itemNumber);
      return {
        itemNumber,
        changed: oldRow === undefined || newRow === undefined ||
          JSON.stringify(oldRow['facts']) !== JSON.stringify(newRow['facts']) ||
          JSON.stringify(oldRow['decisions']) !== JSON.stringify(newRow['decisions']),
        from: oldRow ?? null,
        to: newRow ?? null,
      };
    });
    return { fromRevision: input.fromRevision, toRevision: input.toRevision, diff, from: from.itens, to: to.itens };
  }

  @Get(':documentId/tax-treatment-resolutions/:revision')
  @ExigePermissao('fiscal.motor_tributario.consultar')
  listarRevisaoDeTratamentoTributario(@Req() request: RequisicaoAutenticada, @Param('companyId') companyId: string,
    @Param('documentId') documentId: string, @Param('revision') revision: string) {
    return this.service.listarTratamentosTributarios(tenantDa(request),autorDa(request).usuarioId,companyId,
      analisar(uuid,documentId),obterCorrelationId(request),analisar(revisionSchema,revision));
  }

  @Post(':documentId/integrity-checks')
  @HttpCode(200)
  @ExigePermissao('empresas.cadastro.consultar')
  verificar(@Req() request: RequisicaoAutenticada, @Param('companyId') companyId: string, @Param('documentId') documentId: string, @Body() body: unknown) {
    analisar(z.strictObject({}), body);
    return this.service.verificarIntegridade(tenantDa(request), autorDa(request).usuarioId, companyId, analisar(uuid, documentId), obterCorrelationId(request));
  }

  @Get(':documentId/original')
  @ExigePermissao('empresas.cadastro.consultar')
  async original(@Req() request: RequisicaoAutenticada, @Param('companyId') companyId: string,
    @Param('documentId') documentId: string, @Res() response: Response) {
    const file = await this.service.original(tenantDa(request), autorDa(request).usuarioId, companyId, analisar(uuid, documentId), obterCorrelationId(request));
    response.status(200).type('application/xml').setHeader('Content-Disposition', 'attachment; filename="documento-fiscal.xml"').setHeader('Cache-Control', 'private, no-store').send(file.conteudo);
  }

  @Post(':documentId/reprocessing')
  @HttpCode(202)
  @AcaoLivre()
  reprocessar(@Req() request: RequisicaoAutenticada, @Param('companyId') companyId: string,
    @Param('documentId') documentId: string, @Body() body: unknown) {
    analisar(z.strictObject({}), body);
    const papeis = request.sessao?.papeis ?? [];
    if (!papeis.some((papel) => (['admin_escritorio','contador','auxiliar'] as readonly string[]).includes(papel))) {
      throw new ErroDeDominio(CODIGOS_DE_ERRO.FISCAL_DOCUMENT_ACCESS_DENIED, 'Sem autorização para reprocessar documento fiscal.');
    }
    return this.service.reprocessar(tenantDa(request), autorDa(request).usuarioId, companyId, analisar(uuid, documentId), obterCorrelationId(request));
  }
}
