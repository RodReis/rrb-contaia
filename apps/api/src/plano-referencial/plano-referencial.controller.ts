import { Body, Controller, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ExigePermissao, GuardDeAcao } from '../auth/acao.guard';
import { autorDa, tenantDa } from '../auth/contexto-da-sessao';
import { GuardDeEscopoDeEmpresa } from '../auth/escopo';
import { GuardDeCadastro, GuardDeSessao, type RequisicaoAutenticada } from '../auth/sessao.guard';
import { obterCorrelationId } from '../comum/problema';
import { analisar } from '../escritorio/escritorio.dto';
import { atualizarDecisoesReferencialSchema, consultaPlanoReferencialSchema, criarRascunhoReferencialSchema, publicarReferencialSchema } from './plano-referencial.dto';
import { PlanoReferencialService } from './plano-referencial.service';

@Controller('empresas/:empresaId/plano-referencial')
@UseGuards(GuardDeSessao, GuardDeCadastro, GuardDeAcao, GuardDeEscopoDeEmpresa)
export class PlanoReferencialController {
  constructor(private readonly plano: PlanoReferencialService) {}

  @Get()
  @ExigePermissao('contabil.estrutura_contabil.consultar')
  consultar(@Req() req: RequisicaoAutenticada, @Param('empresaId') empresaId: string, @Query() query: unknown) {
    const filtro = analisar(consultaPlanoReferencialSchema, query);
    return this.plano.consultar({ tenantId: tenantDa(req), usuarioId: autorDa(req).usuarioId }, empresaId,
      filtro.calendarYear, filtro.taxRegime, filtro.specialSituation ?? null);
  }

  @Post('rascunhos')
  @ExigePermissao('contabil.estrutura_contabil.manter_plano_contas')
  criarRascunho(@Req() req: RequisicaoAutenticada, @Param('empresaId') empresaId: string, @Body() body: unknown) {
    const dados = analisar(criarRascunhoReferencialSchema, body);
    return this.plano.criarRascunho({ tenantId: tenantDa(req), usuarioId: autorDa(req).usuarioId }, empresaId,
      dados, obterCorrelationId(req));
  }

  @Put('rascunhos/:mappingId/decisoes')
  @ExigePermissao('contabil.estrutura_contabil.manter_plano_contas')
  atualizarDecisoes(@Req() req: RequisicaoAutenticada, @Param('empresaId') empresaId: string,
    @Param('mappingId') mappingId: string, @Body() body: unknown) {
    const dados = analisar(atualizarDecisoesReferencialSchema, body);
    return this.plano.atualizarDecisoes({ tenantId: tenantDa(req), usuarioId: autorDa(req).usuarioId }, empresaId,
      mappingId, dados.expectedRevision, dados.decisions, obterCorrelationId(req));
  }

  @Post('rascunhos/:mappingId/publicacao')
  @ExigePermissao('contabil.estrutura_contabil.manter_plano_contas')
  publicar(@Req() req: RequisicaoAutenticada, @Param('empresaId') empresaId: string,
    @Param('mappingId') mappingId: string, @Body() body: unknown) {
    const dados = analisar(publicarReferencialSchema, body);
    return this.plano.publicar({ tenantId: tenantDa(req), usuarioId: autorDa(req).usuarioId }, empresaId,
      mappingId, dados.expectedRevision, obterCorrelationId(req));
  }
}
