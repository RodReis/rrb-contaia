import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ExigePermissao, GuardDeAcao } from '../auth/acao.guard';
import { autorDa, tenantDa } from '../auth/contexto-da-sessao';
import { GuardDeEscopoDeEmpresa } from '../auth/escopo';
import { GuardDeCadastro, GuardDeSessao, type RequisicaoAutenticada } from '../auth/sessao.guard';
import { obterCorrelationId } from '../comum/problema';
import { analisar } from '../escritorio/escritorio.dto';
import { consultaPlanoReferencialSchema, criarRascunhoReferencialSchema } from './plano-referencial.dto';
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
}
