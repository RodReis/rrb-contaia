import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, Res, UploadedFiles, UseGuards, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { z } from 'zod';
import { MonthlyAssessmentListQuerySchema, MonthlyRulePackageKindSchema, MonthlyDeclarationSchema, MonthlyRulePackageSchema,
  PrepareMonthlyAssessmentSchema, ReviewMonthlyAssessmentSchema } from '@contaia/shared';
import { ExigePermissao, GuardDeAcao, AcaoLivre } from '../auth/acao.guard';
import { DfeAdminTenantScope, GuardDeEscopoDeEmpresa } from '../auth/escopo';
import { GuardDeCadastro, GuardDeSessao, type RequisicaoAutenticada } from '../auth/sessao.guard';
import { autorDa, tenantDa } from '../auth/contexto-da-sessao';
import { obterCorrelationId } from '../comum/problema';
import { analisar } from '../escritorio/escritorio.dto';
import { MonthlyAssessmentsService } from './monthly-assessments.service';

const idSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu);
const formatSchema = z.strictObject({ format: z.enum(['PDF', 'CSV', 'JSON', 'PIS_DARF_DRAFT', 'COFINS_DARF_DRAFT']) });
const kindSchema = z.strictObject({ kind: MonthlyRulePackageKindSchema.optional() });
const decodeJsonField = (body: unknown, key: string): unknown => {
  if (typeof body !== 'object' || body === null || !(key in body)) return undefined;
  const value = (body as Record<string, unknown>)[key];
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value) as unknown; } catch { return undefined; }
};
const attachmentName = (value: string) => value.replace(/[\r\n"\\]/gu, '_');
const parametrosDaUrl = (originalUrl: string): Record<string, string | string[]> => {
  const parametros: Record<string, string | string[]> = {};
  for (const [chave, valor] of new URL(originalUrl, 'http://contaia.local').searchParams) {
    const anterior = parametros[chave];
    parametros[chave] = anterior === undefined ? valor : Array.isArray(anterior) ? [...anterior, valor] : [anterior, valor];
  }
  return parametros;
};

@Controller('companies/:companyId/fiscal-documents/monthly-assessments')
@DfeAdminTenantScope()
@UseGuards(GuardDeSessao, GuardDeCadastro, GuardDeAcao, GuardDeEscopoDeEmpresa)
export class MonthlyAssessmentsController {
  constructor(private readonly service: MonthlyAssessmentsService) {}

  @Get('rule-packages')
  @ExigePermissao('fiscal.motor_tributario.consultar')
  listRulePackages(@Req() request: RequisicaoAutenticada, @Param('companyId') companyId: string, @Query() query: unknown) {
    const filters = analisar(kindSchema, query);
    return this.service.listRulePackages(tenantDa(request), autorDa(request).usuarioId, companyId, obterCorrelationId(request), filters.kind);
  }

  @Post('rule-packages')
  @HttpCode(201)
  @ExigePermissao('fiscal.motor_tributario.simular')
  @UseInterceptors(FilesInterceptor('source', 1, { limits: { fileSize: 20 * 1024 * 1024, files: 1, fields: 2 } }))
  importRulePackage(@Req() request: RequisicaoAutenticada, @Param('companyId') companyId: string,
    @UploadedFiles() files: readonly Readonly<{ originalname: string; mimetype: string; buffer: Buffer }>[] | undefined, @Body() body: unknown) {
    const input = analisar(MonthlyRulePackageSchema, decodeJsonField(body, 'package'));
    return this.service.importRulePackage(tenantDa(request), autorDa(request).usuarioId, companyId, request.sessao?.papeis ?? [], input,
      files?.[0], obterCorrelationId(request));
  }

  @Get('rule-packages/:packageId/source')
  @ExigePermissao('fiscal.motor_tributario.consultar')
  downloadRuleSource(@Req() request: RequisicaoAutenticada, @Param('companyId') companyId: string, @Param('packageId') packageId: string, @Res() response: Response) {
    return this.service.downloadRuleSource(tenantDa(request), autorDa(request).usuarioId, companyId, analisar(idSchema, packageId), obterCorrelationId(request))
      .then((file) => response.type(file.contentType).setHeader('Content-Disposition', `attachment; filename="${attachmentName(file.filename)}"`)
        .setHeader('Cache-Control', 'private, no-store').send(file.bytes));
  }

  @Post('rule-packages/:packageId/review')
  @HttpCode(201)
  @AcaoLivre()
  reviewRulePackage(@Req() request: RequisicaoAutenticada, @Param('companyId') companyId: string, @Param('packageId') packageId: string, @Body() body: unknown) {
    return this.service.reviewRulePackage(tenantDa(request), autorDa(request).usuarioId, companyId, analisar(idSchema, packageId),
      request.sessao?.papeis ?? [], body, obterCorrelationId(request));
  }

  @Post('declarations')
  @HttpCode(201)
  @ExigePermissao('fiscal.motor_tributario.simular')
  @UseInterceptors(FilesInterceptor('evidence', 10, { limits: { fileSize: 20 * 1024 * 1024, files: 10, fields: 2 } }))
  declare(@Req() request: RequisicaoAutenticada, @Param('companyId') companyId: string,
    @UploadedFiles() files: readonly Readonly<{ originalname: string; mimetype: string; buffer: Buffer }>[] | undefined, @Body() body: unknown) {
    const input = analisar(MonthlyDeclarationSchema, decodeJsonField(body, 'declaration'));
    return this.service.declare(tenantDa(request), autorDa(request).usuarioId, companyId, input, files ?? [], obterCorrelationId(request));
  }

  @Get('declarations/:declarationId/evidence/:evidenceId/download')
  @ExigePermissao('fiscal.motor_tributario.consultar')
  downloadEvidence(@Req() request: RequisicaoAutenticada, @Param('companyId') companyId: string, @Param('declarationId') declarationId: string,
    @Param('evidenceId') evidenceId: string, @Res() response: Response) {
    return this.service.downloadEvidence(tenantDa(request), autorDa(request).usuarioId, companyId, analisar(idSchema, declarationId), analisar(idSchema, evidenceId), obterCorrelationId(request))
      .then((file) => response.type(file.contentType).setHeader('Content-Disposition', `attachment; filename="${attachmentName(file.filename)}"`)
        .setHeader('Cache-Control', 'private, no-store').send(file.bytes));
  }

  @Get('history')
  @ExigePermissao('fiscal.motor_tributario.consultar')
  list(@Req() request: RequisicaoAutenticada, @Param('companyId') companyId: string) {
    const filters = analisar(MonthlyAssessmentListQuerySchema, parametrosDaUrl(request.originalUrl));
    return this.service.list(tenantDa(request), autorDa(request).usuarioId, companyId, obterCorrelationId(request), {
      page: filters.page, pageSize: filters.pageSize, ...(filters.competence ? { competence: filters.competence } : {}), ...(filters.kind ? { kind: filters.kind } : {}),
    });
  }

  @Post()
  @HttpCode(201)
  @ExigePermissao('fiscal.motor_tributario.simular')
  prepare(@Req() request: RequisicaoAutenticada, @Param('companyId') companyId: string, @Body() body: unknown) {
    const input = analisar(PrepareMonthlyAssessmentSchema, body);
    return this.service.prepare(tenantDa(request), autorDa(request).usuarioId, companyId, input, obterCorrelationId(request));
  }

  @Get(':assessmentId')
  @ExigePermissao('fiscal.motor_tributario.consultar')
  get(@Req() request: RequisicaoAutenticada, @Param('companyId') companyId: string, @Param('assessmentId') assessmentId: string) {
    return this.service.get(tenantDa(request), autorDa(request).usuarioId, companyId, analisar(idSchema, assessmentId), obterCorrelationId(request));
  }

  @Post(':assessmentId/review')
  @HttpCode(201)
  @AcaoLivre()
  review(@Req() request: RequisicaoAutenticada, @Param('companyId') companyId: string, @Param('assessmentId') assessmentId: string, @Body() body: unknown) {
    const input = analisar(ReviewMonthlyAssessmentSchema, body);
    return this.service.review(tenantDa(request), autorDa(request).usuarioId, companyId, analisar(idSchema, assessmentId), request.sessao?.papeis ?? [], input, obterCorrelationId(request));
  }

  @Get(':assessmentId/export')
  @ExigePermissao('fiscal.motor_tributario.consultar')
  export(@Req() request: RequisicaoAutenticada, @Param('companyId') companyId: string, @Param('assessmentId') assessmentId: string,
    @Query() query: unknown, @Res() response: Response) {
    const { format } = analisar(formatSchema, query);
    return this.service.export(tenantDa(request), autorDa(request).usuarioId, companyId, analisar(idSchema, assessmentId), format, obterCorrelationId(request))
      .then((file) => response.type(file.contentType).setHeader('Content-Disposition', `attachment; filename="${attachmentName(file.filename)}"`)
        .setHeader('Cache-Control', 'private, no-store').setHeader('X-Content-SHA256', file.hash)
        .setHeader('X-Canonical-JSON-SHA256', file.canonicalJsonHash).send(file.bytes));
  }
}
