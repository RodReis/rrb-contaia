import { Body, Controller, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ExigePermissao, GuardDeAcao } from '../auth/acao.guard';
import { autorDa, tenantDa } from '../auth/contexto-da-sessao';
import { GuardDeEscopoDeEmpresa } from '../auth/escopo';
import { GuardDeCadastro, GuardDeSessao, type RequisicaoAutenticada } from '../auth/sessao.guard';
import { obterCorrelationId } from '../comum/problema';
import { analisar } from '../escritorio/escritorio.dto';
import { cancelamentoSchema, consultaLancamentosSchema, descarteSchema, efetivacaoSchema, estornoSchema, idSchema, motivoSchema, rascunhoSchema } from './lancamentos-contabeis.dto';
import { LancamentosContabeisService } from './lancamentos-contabeis.service';

@Controller('empresas/:empresaId/lancamentos-contabeis')
@UseGuards(GuardDeSessao, GuardDeCadastro, GuardDeAcao, GuardDeEscopoDeEmpresa)
export class LancamentosContabeisController {
  constructor(private readonly service: LancamentosContabeisService) {}
  @Get() @ExigePermissao('contabil.lancamentos.consultar')
  listar(@Req() req: RequisicaoAutenticada, @Param('empresaId') companyId: string, @Query() query: unknown) {
    const q = analisar(consultaLancamentosSchema, query); return this.service.listar({tenantId:tenantDa(req),usuarioId:autorDa(req).usuarioId},companyId,q.competence,q.status,q.limit);
  }
  @Get(':id') @ExigePermissao('contabil.lancamentos.consultar')
  detalhe(@Req() req: RequisicaoAutenticada, @Param('empresaId') companyId: string, @Param('id') id: string) {
    analisar(idSchema,{id}); return this.service.detalhe({tenantId:tenantDa(req),usuarioId:autorDa(req).usuarioId},companyId,id);
  }
  @Post() @ExigePermissao('contabil.lancamentos.preparar_rascunho')
  criar(@Req() req: RequisicaoAutenticada, @Param('empresaId') companyId: string, @Body() body: unknown) {
    return this.service.criar({tenantId:tenantDa(req),usuarioId:autorDa(req).usuarioId},companyId,analisar(rascunhoSchema,body),obterCorrelationId(req));
  }
  @Put(':id') @ExigePermissao('contabil.lancamentos.preparar_rascunho')
  editar(@Req() req: RequisicaoAutenticada,@Param('empresaId') companyId:string,@Param('id') id:string,@Body() body:unknown) {
    analisar(idSchema,{id}); return this.service.editar({tenantId:tenantDa(req),usuarioId:autorDa(req).usuarioId},companyId,id,analisar(rascunhoSchema,body),obterCorrelationId(req));
  }
  @Post(':id/descartar') @ExigePermissao('contabil.lancamentos.preparar_rascunho')
  descartar(@Req() req:RequisicaoAutenticada,@Param('empresaId') companyId:string,@Param('id') id:string,@Body() body:unknown) {
    const b=analisar(descarteSchema,body); return this.service.descartar({tenantId:tenantDa(req),usuarioId:autorDa(req).usuarioId},companyId,id,b.reason,b.version,obterCorrelationId(req));
  }
  @Post(':id/efetivar') @ExigePermissao('contabil.lancamentos.efetivar')
  efetivar(@Req() req:RequisicaoAutenticada,@Param('empresaId') companyId:string,@Param('id') id:string,@Body() body:unknown) {
    const b=analisar(efetivacaoSchema,body); return this.service.efetivar({tenantId:tenantDa(req),usuarioId:autorDa(req).usuarioId},companyId,id,b.version,obterCorrelationId(req));
  }
  @Post(':id/cancelar') @ExigePermissao('contabil.lancamentos.cancelar_estornar')
  cancelar(@Req() req:RequisicaoAutenticada,@Param('empresaId') companyId:string,@Param('id') id:string,@Body() body:unknown) {
    const b=analisar(cancelamentoSchema,body); return this.service.cancelar({tenantId:tenantDa(req),usuarioId:autorDa(req).usuarioId},companyId,id,b.reason,b.version,obterCorrelationId(req));
  }
  @Post(':id/estornar') @ExigePermissao('contabil.lancamentos.cancelar_estornar')
  estornar(@Req() req:RequisicaoAutenticada,@Param('empresaId') companyId:string,@Param('id') id:string,@Body() body:unknown) {
    const b=analisar(estornoSchema,body); return this.service.estornar({tenantId:tenantDa(req),usuarioId:autorDa(req).usuarioId},companyId,id,b.accountingDate,b.competence,b.reason,obterCorrelationId(req));
  }
}
