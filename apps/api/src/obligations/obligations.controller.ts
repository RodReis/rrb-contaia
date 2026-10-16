import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { GuardDeAcao, ExigePermissao } from '../auth/acao.guard';
import { GuardDeCadastro, GuardDeSessao, type RequisicaoAutenticada } from '../auth/sessao.guard';
import { tenantDa, autorDa } from '../auth/contexto-da-sessao';
import { obterCorrelationId } from '../comum/problema';
import { analisar } from '../escritorio/escritorio.dto';
import { ObligationsService } from './obligations.service';
import { baixaSchema, filtroAgendaSchema, geracaoSchema, reaberturaSchema } from './obligations.dto';

@Controller('fiscal/obrigacoes')
@UseGuards(GuardDeSessao,GuardDeCadastro,GuardDeAcao)
@ExigePermissao('obrigacoes.agenda.consultar')
export class ObligationsController {
  constructor(private readonly service:ObligationsService){}
  @Get() agenda(@Req() req:RequisicaoAutenticada,@Query() q:unknown){const f=analisar(filtroAgendaSchema,q);return this.service.agenda(tenantDa(req),autorDa(req).usuarioId,{limite:f.limite,deslocamento:f.deslocamento,...(f.empresaId===undefined?{}:{empresaId:f.empresaId}),...(f.codigo===undefined?{}:{codigo:f.codigo}),...(f.competencia===undefined?{}:{competencia:f.competencia}),...(f.estado===undefined?{}:{estado:f.estado}),...(f.prioridade===undefined?{}:{prioridade:f.prioridade})});}
  @Post('geracoes') @ExigePermissao('obrigacoes.agenda.reprocessar') gerar(@Req() req:RequisicaoAutenticada,@Body() body:unknown){const {competencia}=analisar(geracaoSchema,body);return this.service.gerar(tenantDa(req),autorDa(req).usuarioId,competencia);}
  @Get(':id') detalhe(@Req() req:RequisicaoAutenticada,@Param('id') id:string){return this.service.detalhe(tenantDa(req),autorDa(req).usuarioId,id);}
  @Post(':id/baixa') @ExigePermissao('obrigacoes.agenda.baixar') baixa(@Req() req:RequisicaoAutenticada,@Param('id') id:string,@Body() body:unknown){return this.service.baixa(tenantDa(req),autorDa(req).usuarioId,id,analisar(baixaSchema,body),obterCorrelationId(req));}
  @Post(':id/reabertura') @ExigePermissao('obrigacoes.agenda.reabrir') reabrir(@Req() req:RequisicaoAutenticada,@Param('id') id:string,@Body() body:unknown){return this.service.reabrir(tenantDa(req),autorDa(req).usuarioId,id,analisar(reaberturaSchema,body),obterCorrelationId(req));}
}
