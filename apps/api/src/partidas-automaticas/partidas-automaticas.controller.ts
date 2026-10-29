import { Body, Controller, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ExigePermissao, GuardDeAcao } from '../auth/acao.guard';
import { autorDa, tenantDa } from '../auth/contexto-da-sessao';
import { GuardDeEscopoDeEmpresa } from '../auth/escopo';
import { GuardDeCadastro, GuardDeSessao, type RequisicaoAutenticada } from '../auth/sessao.guard';
import { obterCorrelationId } from '../comum/problema';
import { analisar } from '../escritorio/escritorio.dto';
import { gerarOrigemSchema, idRegraSchema, consultaRegraSchema, regraSchema, simularRegraSchema, familiaOrigemSchema } from './partidas-automaticas.dto';
import { PartidasAutomaticasService } from './partidas-automaticas.service';

@Controller('empresas/:empresaId/automatizacao-contabil')
@UseGuards(GuardDeSessao,GuardDeCadastro,GuardDeAcao,GuardDeEscopoDeEmpresa)
export class PartidasAutomaticasController {
  constructor(private readonly service:PartidasAutomaticasService){}
  private actor(req:RequisicaoAutenticada){return{tenantId:tenantDa(req),usuarioId:autorDa(req).usuarioId};}
  @Get('regras') @ExigePermissao('contabil.automatizacao.consultar')
  listar(@Req() req:RequisicaoAutenticada,@Param('empresaId') companyId:string,@Query() query:unknown){return this.service.listar(this.actor(req),companyId,obterCorrelationId(req),analisar(consultaRegraSchema,query));}
  @Get('origens') @ExigePermissao('contabil.automatizacao.consultar')
  origens(@Req() req:RequisicaoAutenticada,@Param('empresaId') companyId:string,@Query('familia') familia:unknown){return this.service.listarOrigens(this.actor(req),companyId,obterCorrelationId(req),analisar(familiaOrigemSchema,familia));}
  @Post('regras') @ExigePermissao('contabil.automatizacao.manter_regras')
  criar(@Req() req:RequisicaoAutenticada,@Param('empresaId') companyId:string,@Body() body:unknown){return this.service.criar(this.actor(req),companyId,obterCorrelationId(req),analisar(regraSchema,body));}
  @Put('regras/:id') @ExigePermissao('contabil.automatizacao.manter_regras')
  editar(@Req() req:RequisicaoAutenticada,@Param('empresaId') companyId:string,@Param('id') id:string,@Body() body:unknown){analisar(idRegraSchema,{id});return this.service.editarRascunho(this.actor(req),companyId,obterCorrelationId(req),id,analisar(regraSchema,body));}
  @Get('regras/:id') @ExigePermissao('contabil.automatizacao.consultar')
  obter(@Req() req:RequisicaoAutenticada,@Param('empresaId') companyId:string,@Param('id') id:string){analisar(idRegraSchema,{id});return this.service.obter(this.actor(req),companyId,obterCorrelationId(req),id);}
  @Put('regras/:id/versoes') @ExigePermissao('contabil.automatizacao.manter_regras')
  versao(@Req() req:RequisicaoAutenticada,@Param('empresaId') companyId:string,@Param('id') id:string,@Body() body:unknown){analisar(idRegraSchema,{id});return this.service.novaVersao(this.actor(req),companyId,obterCorrelationId(req),id,analisar(regraSchema,body));}
  @Post('regras/:id/versoes/:versionId/publicar') @ExigePermissao('contabil.automatizacao.publicar')
  publicar(@Req() req:RequisicaoAutenticada,@Param('empresaId') companyId:string,@Param('id') id:string,@Param('versionId') versionId:string){analisar(idRegraSchema,{id:versionId});return this.service.publicar(this.actor(req),companyId,obterCorrelationId(req),id,versionId);}
  @Post('regras/:id/arquivar') @ExigePermissao('contabil.automatizacao.publicar')
  arquivar(@Req() req:RequisicaoAutenticada,@Param('empresaId') companyId:string,@Param('id') id:string){analisar(idRegraSchema,{id});return this.service.arquivar(this.actor(req),companyId,obterCorrelationId(req),id);}
  @Post('simulacoes') @ExigePermissao('contabil.automatizacao.simular')
  simular(@Req() req:RequisicaoAutenticada,@Param('empresaId') companyId:string,@Body() body:unknown){const b=analisar(simularRegraSchema,body);return this.service.simular(this.actor(req),companyId,obterCorrelationId(req),b.sourceType,b.sourceId);}
  @Get('geracoes') @ExigePermissao('contabil.automatizacao.consultar')
  geracoes(@Req() req:RequisicaoAutenticada,@Param('empresaId') companyId:string){return this.service.listarGeracoes(this.actor(req),companyId,obterCorrelationId(req));}
  @Post('geracoes') @ExigePermissao('contabil.automatizacao.processar_origens')
  gerar(@Req() req:RequisicaoAutenticada,@Param('empresaId') companyId:string,@Body() body:unknown){const b=analisar(gerarOrigemSchema,body);return this.service.gerar(this.actor(req),companyId,obterCorrelationId(req),b.sourceType,b.sourceId);}
  @Get('pendencias') @ExigePermissao('contabil.automatizacao.consultar')
  pendencias(@Req() req:RequisicaoAutenticada,@Param('empresaId') companyId:string){return this.service.listarPendencias(this.actor(req),companyId,obterCorrelationId(req));}
  @Post('pendencias/:id/reprocessar') @ExigePermissao('contabil.automatizacao.processar_origens')
  reprocessar(@Req() req:RequisicaoAutenticada,@Param('empresaId') companyId:string,@Param('id') id:string){analisar(idRegraSchema,{id});return this.service.reprocessar(this.actor(req),companyId,obterCorrelationId(req),id);}
}
