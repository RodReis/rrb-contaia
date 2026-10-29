import { Body, Controller, Get, Headers, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ExigePermissao, GuardDeAcao } from '../auth/acao.guard';
import { autorDa, tenantDa } from '../auth/contexto-da-sessao';
import { GuardDeEscopoDeEmpresa } from '../auth/escopo';
import { GuardDeCadastro, GuardDeSessao, type RequisicaoAutenticada } from '../auth/sessao.guard';
import { obterCorrelationId } from '../comum/problema';
import { CODIGOS_DE_ERRO, ErroDeDominio } from '@contaia/domain';
import { analisar } from '../escritorio/escritorio.dto';
import { consultaBalanceteSchema, consultaFechamentosSchema, consultaRazaoSchema, fecharCompetenciaSchema, movementIdSchema, reabrirCompetenciaSchema, resultadoReconstrucaoSchema } from './razao-contabil.dto';
import { RazaoContabilService } from './razao-contabil.service';

@Controller('empresas/:empresaId/razao')
@UseGuards(GuardDeSessao, GuardDeCadastro, GuardDeAcao, GuardDeEscopoDeEmpresa)
export class RazaoContabilController {
  constructor(private readonly service: RazaoContabilService) {}

  @Get('fechamentos') @ExigePermissao('contabil.fechamento.consultar')
  consultarFechamentos(@Req() req: RequisicaoAutenticada,@Param('empresaId') companyId: string,@Query() query: unknown){
    const q=analisar(consultaFechamentosSchema,query);return this.service.consultarFechamentos({tenantId:tenantDa(req),usuarioId:autorDa(req).usuarioId},companyId,q.de,q.ate,obterCorrelationId(req));
  }

  @Post('fechamentos') @ExigePermissao('contabil.fechamento.fechar_competencia')
  fechar(@Req() req:RequisicaoAutenticada,@Param('empresaId') companyId:string,@Headers('idempotency-key') key:string|undefined,@Body() body:unknown){
    const b=analisar(fecharCompetenciaSchema,body);const idempotencyKey=key??b['idempotencyKey'];if(!idempotencyKey)throw new ErroDeDominio(CODIGOS_DE_ERRO.ACCOUNTING_PERIOD_INVALID,'Informe Idempotency-Key.');return this.service.fecharCompetencia({tenantId:tenantDa(req),usuarioId:autorDa(req).usuarioId},companyId,b['competence'],b['expectedVersion'],idempotencyKey,b['confirmEmpty'],req.sessao?.permissoes??[],obterCorrelationId(req));
  }

  @Post('fechamentos/:competence/reabrir') @ExigePermissao('contabil.fechamento.reabrir')
  reabrir(@Req() req:RequisicaoAutenticada,@Param('empresaId') companyId:string,@Param('competence') competence:string,@Headers('idempotency-key') key:string|undefined,@Body() body:unknown){
    const b=analisar(reabrirCompetenciaSchema,body);if(b['competence']!==competence)throw new ErroDeDominio(CODIGOS_DE_ERRO.ACCOUNTING_PERIOD_INVALID,'Competência da rota e comando divergem.');const idempotencyKey=key??b['idempotencyKey'];if(!idempotencyKey)throw new ErroDeDominio(CODIGOS_DE_ERRO.ACCOUNTING_PERIOD_INVALID,'Informe Idempotency-Key.');return this.service.reabrirCompetencia({tenantId:tenantDa(req),usuarioId:autorDa(req).usuarioId},companyId,b['competence'],b['expectedVersion'],idempotencyKey,b['reason'],req.sessao?.permissoes??[],obterCorrelationId(req));
  }

  @Get() @ExigePermissao('contabil.razao.consultar')
  listar(@Req() req: RequisicaoAutenticada, @Param('empresaId') companyId: string, @Query() query: unknown) {
    return this.service.listar({ tenantId: tenantDa(req), usuarioId: autorDa(req).usuarioId }, companyId, analisar(consultaRazaoSchema, query), obterCorrelationId(req));
  }

  @Get('balancete') @ExigePermissao('contabil.razao.consultar')
  balancete(@Req() req: RequisicaoAutenticada, @Param('empresaId') companyId: string, @Query() query: unknown) {
    return this.service.balancete({ tenantId: tenantDa(req), usuarioId: autorDa(req).usuarioId }, companyId, analisar(consultaBalanceteSchema, query), obterCorrelationId(req));
  }

  @Post('verificar') @ExigePermissao('contabil.razao.verificar_integridade')
  verificar(@Req() req: RequisicaoAutenticada, @Param('empresaId') companyId: string) {
    return this.service.verificar({ tenantId: tenantDa(req), usuarioId: autorDa(req).usuarioId }, companyId, obterCorrelationId(req));
  }

  @Post('reconstruir') @ExigePermissao('contabil.razao.reconstruir_projecao')
  reconstruir(@Req() req: RequisicaoAutenticada, @Param('empresaId') companyId: string, @Body() body: unknown) {
    const confirmation = analisar(resultadoReconstrucaoSchema, body);
    return this.service.reconstruir({ tenantId: tenantDa(req), usuarioId: autorDa(req).usuarioId }, companyId, confirmation.confirmacaoPeriodoDe, confirmation.confirmacaoPeriodoAte, confirmation.confirmacaoEmpresa, obterCorrelationId(req));
  }

  @Get(':movementId') @ExigePermissao('contabil.razao.consultar')
  detalhe(@Req() req: RequisicaoAutenticada, @Param('empresaId') companyId: string, @Param('movementId') movementId: string) {
    analisar(movementIdSchema, { movementId });
    return this.service.detalhe({ tenantId: tenantDa(req), usuarioId: autorDa(req).usuarioId }, companyId, movementId, obterCorrelationId(req));
  }
}
