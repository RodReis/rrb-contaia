import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
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

const uuid = z.string().uuid();
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

@Controller('companies/:companyId/fiscal-documents')
@DfeAdminTenantScope()
@UseGuards(GuardDeSessao, GuardDeCadastro, GuardDeAcao, GuardDeEscopoDeEmpresa)
export class FiscalDocumentsController {
  constructor(private readonly service: FiscalDocumentsService) {}

  @Get()
  @ExigePermissao('empresas.cadastro.consultar')
  listar(@Req() request: RequisicaoAutenticada, @Param('companyId') companyId: string, @Query() query: unknown) {
    const consulta = analisar(consultaFiscalSchema, query);
    return this.service.listar(tenantDa(request), autorDa(request).usuarioId, companyId, obterCorrelationId(request), consulta.pagina, consulta.estado ?? null);
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
