import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, Res, UploadedFiles, UseGuards, UseInterceptors } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { FilesInterceptor } from '@nestjs/platform-express';
import {
  CorporateTaxDeclarationSchema, CorporateTaxRulePackageSchema, PrepareCorporateTaxAssessmentSchema,
  ReviewCorporateTaxAssessmentSchema, ReviewCorporateTaxRulePackageSchema,
} from '@contaia/shared';
import { ExigePermissao, GuardDeAcao, AcaoLivre } from '../auth/acao.guard';
import { GuardDeEscopoDeEmpresa } from '../auth/escopo';
import { GuardDeCadastro, GuardDeSessao, type RequisicaoAutenticada } from '../auth/sessao.guard';
import { autorDa, tenantDa } from '../auth/contexto-da-sessao';
import { obterCorrelationId } from '../comum/problema';
import { analisar } from '../escritorio/escritorio.dto';
import { CorporateTaxAssessmentsService } from './corporate-tax-assessments.service';

const idSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu);
const historySchema = z.strictObject({ quarter: z.enum(['2026-Q1', '2026-Q2', '2026-Q3', '2026-Q4']).optional() });
const formatSchema = z.strictObject({ format: z.enum(['PDF', 'CSV', 'JSON', 'IRPJ_DARF_DRAFT', 'CSLL_DARF_DRAFT']) });
const safeFileName = (value: string) => value.replace(/[\r\n"\\]/gu, '_');
const decodeJsonField = (body: unknown, key: string): unknown => {
  if (typeof body !== 'object' || body === null || !(key in body)) return undefined;
  const value = (body as Record<string, unknown>)[key];
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value) as unknown; } catch { return undefined; }
};

@Controller('companies/:companyId/fiscal-documents/corporate-tax-assessments')
@UseGuards(GuardDeSessao, GuardDeCadastro, GuardDeAcao, GuardDeEscopoDeEmpresa)
export class CorporateTaxAssessmentsController {
  constructor(private readonly service: CorporateTaxAssessmentsService) {}

  @Get('rule-packages')
  @ExigePermissao('fiscal.motor_tributario.consultar')
  listRulePackages(@Req() request: RequisicaoAutenticada, @Param('companyId') companyId: string) {
    return this.service.listRulePackages(tenantDa(request), autorDa(request).usuarioId, companyId, obterCorrelationId(request));
  }

  @Get('rule-packages/:packageId/source')
  @ExigePermissao('fiscal.motor_tributario.consultar')
  downloadPackageSource(@Req() request: RequisicaoAutenticada, @Param('companyId') companyId: string, @Param('packageId') packageId: string, @Res() response: Response) {
    return this.service.downloadPackageSource(tenantDa(request), autorDa(request).usuarioId, companyId, analisar(idSchema, packageId), obterCorrelationId(request))
      .then((file) => response.type(file.contentType).setHeader('Content-Disposition', `attachment; filename="${safeFileName(packageId)}.pdf"`)
        .setHeader('Cache-Control', 'private, no-store').setHeader('X-Content-SHA256', file.hash).send(file.bytes));
  }

  @Post('rule-packages')
  @HttpCode(201)
  @AcaoLivre()
  @UseInterceptors(FilesInterceptor('source', 1, { limits: { fileSize: 20 * 1024 * 1024, files: 1, fields: 2 } }))
  importRulePackage(@Req() request: RequisicaoAutenticada, @Param('companyId') companyId: string,
    @UploadedFiles() files: readonly Readonly<{ originalname: string; mimetype: string; buffer: Buffer }>[] | undefined, @Body() body: unknown) {
    return this.service.importRulePackage(tenantDa(request), autorDa(request).usuarioId, companyId, request.sessao?.papeis ?? [],
      analisar(CorporateTaxRulePackageSchema, decodeJsonField(body, 'package')), files?.[0], obterCorrelationId(request));
  }

  @Post('rule-packages/:packageId/review')
  @HttpCode(201)
  @AcaoLivre()
  reviewRulePackage(@Req() request: RequisicaoAutenticada, @Param('companyId') companyId: string, @Param('packageId') packageId: string, @Body() body: unknown) {
    return this.service.reviewRulePackage(tenantDa(request), autorDa(request).usuarioId, companyId, analisar(idSchema, packageId),
      request.sessao?.papeis ?? [], analisar(ReviewCorporateTaxRulePackageSchema, body), obterCorrelationId(request));
  }

  @Post('declarations')
  @HttpCode(201)
  @ExigePermissao('fiscal.motor_tributario.simular')
  @UseInterceptors(FilesInterceptor('evidence', 30, { limits: { fileSize: 20 * 1024 * 1024, files: 30, fields: 2 } }))
  declare(@Req() request: RequisicaoAutenticada, @Param('companyId') companyId: string,
    @UploadedFiles() files: readonly Readonly<{ originalname: string; mimetype: string; buffer: Buffer }>[] | undefined, @Body() body: unknown) {
    return this.service.declare(tenantDa(request), autorDa(request).usuarioId, companyId,
      analisar(CorporateTaxDeclarationSchema, decodeJsonField(body, 'declaration')), files ?? [], obterCorrelationId(request));
  }

  @Get('declarations/:declarationId/evidence/:evidenceId/download')
  @ExigePermissao('fiscal.motor_tributario.consultar')
  downloadEvidence(@Req() request: RequisicaoAutenticada, @Param('companyId') companyId: string, @Param('declarationId') declarationId: string,
    @Param('evidenceId') evidenceId: string, @Res() response: Response) {
    return this.service.downloadEvidence(tenantDa(request), autorDa(request).usuarioId, companyId, analisar(idSchema, declarationId), analisar(idSchema, evidenceId), obterCorrelationId(request))
      .then((file) => response.type(file.contentType).setHeader('Content-Disposition', `attachment; filename="${safeFileName(file.fileName)}"`)
        .setHeader('Cache-Control', 'private, no-store').setHeader('X-Content-SHA256', file.hash).send(file.bytes));
  }

  @Get(':assessmentId/artifacts/:artifactId')
  @ExigePermissao('fiscal.motor_tributario.consultar')
  downloadArtifact(@Req() request: RequisicaoAutenticada, @Param('companyId') companyId: string, @Param('assessmentId') assessmentId: string,
    @Param('artifactId') artifactId: string, @Res() response: Response) {
    return this.service.downloadArtifact(tenantDa(request), autorDa(request).usuarioId, companyId, analisar(idSchema, assessmentId), analisar(idSchema, artifactId), obterCorrelationId(request))
      .then((file) => response.type(file.contentType).setHeader('Content-Disposition', `attachment; filename="artifact-${artifactId}.${file.contentType.includes('pdf') ? 'pdf' : file.contentType.includes('csv') ? 'csv' : file.contentType.includes('json') ? 'json' : 'bin'}"`)
        .setHeader('Cache-Control', 'private, no-store').setHeader('X-Content-SHA256', file.hash).setHeader('X-Canonical-JSON-SHA256', file.canonicalHash).send(file.bytes));
  }

  @Get('history')
  @ExigePermissao('fiscal.motor_tributario.consultar')
  history(@Req() request: RequisicaoAutenticada, @Param('companyId') companyId: string, @Query() query: unknown) {
    return this.service.history(tenantDa(request), autorDa(request).usuarioId, companyId, analisar(historySchema, query).quarter, obterCorrelationId(request));
  }

  @Post()
  @HttpCode(201)
  @ExigePermissao('fiscal.motor_tributario.simular')
  prepare(@Req() request: RequisicaoAutenticada, @Param('companyId') companyId: string, @Body() body: unknown) {
    return this.service.prepare(tenantDa(request), autorDa(request).usuarioId, companyId,
      analisar(PrepareCorporateTaxAssessmentSchema, body), obterCorrelationId(request));
  }

  @Get(':assessmentId')
  @ExigePermissao('fiscal.motor_tributario.consultar')
  get(@Req() request: RequisicaoAutenticada, @Param('companyId') companyId: string, @Param('assessmentId') assessmentId: string) {
    return this.service.get(tenantDa(request), autorDa(request).usuarioId, companyId, analisar(idSchema, assessmentId), obterCorrelationId(request));
  }

  @Get(':assessmentId/export')
  @ExigePermissao('fiscal.motor_tributario.consultar')
  export(@Req() request: RequisicaoAutenticada, @Param('companyId') companyId: string, @Param('assessmentId') assessmentId: string,
    @Query() query: unknown, @Res() response: Response) {
    const { format } = analisar(formatSchema, query);
    return this.service.export(tenantDa(request), autorDa(request).usuarioId, companyId, analisar(idSchema, assessmentId), format, obterCorrelationId(request))
      .then((file) => response.type(file.contentType).setHeader('Content-Disposition', `attachment; filename="${safeFileName(file.filename)}"`)
        .setHeader('Cache-Control', 'private, no-store').setHeader('X-Content-SHA256', file.hash)
        .setHeader('X-Canonical-JSON-SHA256', file.canonicalJsonHash).send(file.bytes));
  }

  @Post(':assessmentId/review')
  @HttpCode(201)
  @AcaoLivre()
  review(@Req() request: RequisicaoAutenticada, @Param('companyId') companyId: string, @Param('assessmentId') assessmentId: string, @Body() body: unknown) {
    return this.service.review(tenantDa(request), autorDa(request).usuarioId, companyId, analisar(idSchema, assessmentId),
      request.sessao?.papeis ?? [], analisar(ReviewCorporateTaxAssessmentSchema, body), obterCorrelationId(request));
  }
}
