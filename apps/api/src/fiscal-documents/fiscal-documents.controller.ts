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
import { FilesInterceptor } from '@nestjs/platform-express';
import { z as zod } from 'zod';

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
  constructor(private readonly service: FiscalDocumentsService, private readonly icmsStService: IcmsStSettlementsService) {}

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

  @Get('icms-st-settlements/:snapshotId')
  @ExigePermissao('fiscal.motor_tributario.consultar')
  obterApuracaoIcmsSt(@Req() request: RequisicaoAutenticada, @Param('companyId') companyId: string,
    @Param('snapshotId') snapshotId: string, @Query() query: unknown) {
    const pagina = analisar(paginaSchema, query).pagina;
    return this.icmsStService.get(tenantDa(request), autorDa(request).usuarioId, companyId, analisar(persistedUuid, snapshotId), obterCorrelationId(request), pagina);
  }

  @Get('icms-st-settlements')
  @ExigePermissao('fiscal.motor_tributario.consultar')
  listarApuracoesIcmsSt(@Req() request: RequisicaoAutenticada, @Param('companyId') companyId: string) {
    return this.icmsStService.list(tenantDa(request),autorDa(request).usuarioId,companyId,obterCorrelationId(request));
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
