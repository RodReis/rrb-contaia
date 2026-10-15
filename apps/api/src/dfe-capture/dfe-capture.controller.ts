import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { AcaoLivre, ExigePermissao, GuardDeAcao } from '../auth/acao.guard';
import { DfeAdminTenantScope, GuardDeEscopoDeEmpresa } from '../auth/escopo';
import { GuardDeCadastro, GuardDeSessao, type RequisicaoAutenticada } from '../auth/sessao.guard';
import { autorDa, tenantDa } from '../auth/contexto-da-sessao';
import { Body, Headers, HttpCode, Post } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { obterCorrelationId } from '../comum/problema';
import { CODIGOS_DE_ERRO, ErroDeDominio } from '@contaia/domain';
import { analisar } from '../escritorio/escritorio.dto';
import { paginaSchema } from '../empregados/empregados.dto';
import { z } from 'zod';
import { DfeCaptureService } from './dfe-capture.service';

@Controller('companies/:companyId/dfe-capture')
@DfeAdminTenantScope()
@UseGuards(GuardDeSessao, GuardDeCadastro, GuardDeAcao, GuardDeEscopoDeEmpresa)
export class DfeCaptureController {
  constructor(private readonly service: DfeCaptureService) {}

  @Get()
  @ExigePermissao('empresas.cadastro.consultar')
  status(@Req() request: RequisicaoAutenticada, @Param('companyId') companyId: string) {
    return this.service.status(tenantDa(request), autorDa(request).usuarioId, companyId, obterCorrelationId(request));
  }

  @Get('runs')
  @ExigePermissao('empresas.cadastro.consultar')
  runs(@Req() request: RequisicaoAutenticada, @Param('companyId') companyId: string, @Query() query: unknown) {
    return this.service.runs(tenantDa(request), autorDa(request).usuarioId, companyId, analisar(paginaSchema, query).pagina, obterCorrelationId(request));
  }

  @Post('queries')
  @HttpCode(202)
  @AcaoLivre()
  consultar(@Req() request: RequisicaoAutenticada, @Param('companyId') companyId: string, @Headers('idempotency-key') requestKey: string | undefined, @Body() body: unknown) {
    analisar(z.strictObject({}), body);
    const papeis = request.sessao?.papeis ?? [];
    if (!papeis.some((papel) => (['admin_escritorio', 'contador', 'auxiliar'] as readonly string[]).includes(papel))) {
      throw new ErroDeDominio(CODIGOS_DE_ERRO.SEM_AUTORIZACAO, 'Sem autorização para consultar captura DF-e.');
    }
    const correlationId = obterCorrelationId(request);
    return this.service.enfileirar(tenantDa(request), autorDa(request).usuarioId, companyId, correlationId, requestKey ?? randomUUID());
  }

  @Post('runs/:runId/reprocess')
  @HttpCode(202)
  @AcaoLivre()
  reprocessar(@Req() request: RequisicaoAutenticada, @Param('companyId') companyId: string, @Param('runId') runId: string, @Body() body: unknown) {
    analisar(z.strictObject({}), body);
    if (!(request.sessao?.papeis ?? []).includes('admin_escritorio')) {
      throw new ErroDeDominio(CODIGOS_DE_ERRO.SEM_AUTORIZACAO, 'Somente admin_escritorio pode reprocessar a DLQ.');
    }
    const idValidado = analisar(z.uuid(), runId);
    return this.service.reprocessar(tenantDa(request), autorDa(request).usuarioId, companyId, idValidado, obterCorrelationId(request));
  }
}
