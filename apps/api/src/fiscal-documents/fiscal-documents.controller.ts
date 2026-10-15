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

  @Get(':documentId')
  @ExigePermissao('empresas.cadastro.consultar')
  obter(@Req() request: RequisicaoAutenticada, @Param('companyId') companyId: string, @Param('documentId') documentId: string) {
    return this.service.obter(tenantDa(request), autorDa(request).usuarioId, companyId, analisar(uuid, documentId), obterCorrelationId(request));
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
