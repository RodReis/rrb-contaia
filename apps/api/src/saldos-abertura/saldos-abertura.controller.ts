import { Body, Controller, Delete, Headers, Param, Post, Get, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ExigePermissao, GuardDeAcao } from '../auth/acao.guard';
import { GuardDeEscopoDeEmpresa } from '../auth/escopo';
import { autorDa, tenantDa } from '../auth/contexto-da-sessao';
import { GuardDeCadastro, GuardDeSessao, type RequisicaoAutenticada } from '../auth/sessao.guard';
import { obterCorrelationId } from '../comum/problema';
import { analisar } from '../escritorio/escritorio.dto';
import { CODIGOS_DE_ERRO, ErroDeDominio } from '@contaia/domain';
import { openingApproveInitialSchema, openingApproveReplacementSchema, openingCreateSchema, openingCsvConfirmSchema, openingDraftSchema, openingIdSchema } from './saldos-abertura.dto';
import { SaldosAberturaService } from './saldos-abertura.service';

@Controller('empresas/:empresaId/saldos-abertura')
@UseGuards(GuardDeSessao,GuardDeCadastro,GuardDeAcao,GuardDeEscopoDeEmpresa)
export class SaldosAberturaController{
 constructor(private readonly service:SaldosAberturaService){}
 private actor(req:RequisicaoAutenticada){return {tenantId:tenantDa(req),usuarioId:autorDa(req).usuarioId};}
 @Get() @ExigePermissao('contabil.saldos_abertura.consultar') consultar(@Req() req:RequisicaoAutenticada,@Param('empresaId') company:string){return this.service.consultar(this.actor(req),company);}
 @Post() @ExigePermissao('contabil.saldos_abertura.preparar') criar(@Req() req:RequisicaoAutenticada,@Param('empresaId') company:string,@Headers('idempotency-key') key:string|undefined,@Body() body:unknown){const data=analisar(openingCreateSchema,body);if(!key)throw new ErroDeDominio(CODIGOS_DE_ERRO.OPENING_BALANCE_CONFLICT,'Informe Idempotency-Key.');return this.service.criar(this.actor(req),company,data,key,obterCorrelationId(req));}
 @Post(':id/editar') @ExigePermissao('contabil.saldos_abertura.preparar') editar(@Req() req:RequisicaoAutenticada,@Param('empresaId') company:string,@Param('id') id:string,@Headers('idempotency-key') key:string|undefined,@Body() body:unknown){analisar(openingIdSchema,{id});const data=analisar(openingDraftSchema,body);if(!key)throw new ErroDeDominio(CODIGOS_DE_ERRO.OPENING_BALANCE_CONFLICT,'Informe Idempotency-Key.');return this.service.editar(this.actor(req),company,id,data,key,obterCorrelationId(req));}
 @Delete(':id/linhas/:line') @ExigePermissao('contabil.saldos_abertura.preparar') excluirLinha(@Req() req:RequisicaoAutenticada,@Param('empresaId') company:string,@Param('id') id:string,@Param('line') line:string,@Body() body:unknown){analisar(openingIdSchema,{id});const data=analisar(openingDraftSchema.pick({expectedRevision:true}),body);return this.service.excluirLinha(this.actor(req),company,id,Number(line),data.expectedRevision!,obterCorrelationId(req));}
 @Post(':id/csv/previsualizar') @ExigePermissao('contabil.saldos_abertura.preparar') @UseInterceptors(FileInterceptor('arquivo',{limits:{fileSize:10*1024*1024,files:1}})) preview(@Req() req:RequisicaoAutenticada,@Param('empresaId') company:string,@Param('id') id:string,@Headers('idempotency-key') key:string|undefined,@UploadedFile() file?:{buffer:Buffer}){analisar(openingIdSchema,{id});if(!key)throw new ErroDeDominio(CODIGOS_DE_ERRO.OPENING_BALANCE_CONFLICT,'Informe Idempotency-Key.');if(!file)throw new ErroDeDominio(CODIGOS_DE_ERRO.OPENING_BALANCE_CSV_INVALID,'Selecione um arquivo CSV.');return this.service.previsualizarCsv(this.actor(req),company,id,file.buffer,key,obterCorrelationId(req));}
 @Post(':id/csv/confirmar') @ExigePermissao('contabil.saldos_abertura.preparar') confirmar(@Req() req:RequisicaoAutenticada,@Param('empresaId') company:string,@Param('id') id:string,@Headers('idempotency-key') key:string|undefined,@Body() body:unknown){analisar(openingIdSchema,{id});const data=analisar(openingCsvConfirmSchema,body);if(!key)throw new ErroDeDominio(CODIGOS_DE_ERRO.OPENING_BALANCE_CONFLICT,'Informe Idempotency-Key.');return this.service.confirmarCsv(this.actor(req),company,id,data,key,obterCorrelationId(req));}
 @Post(':id/aprovar') @ExigePermissao('contabil.saldos_abertura.aprovar') aprovar(@Req() req:RequisicaoAutenticada,@Param('empresaId') company:string,@Param('id') id:string,@Headers('idempotency-key') key:string|undefined,@Body() body:unknown){analisar(openingIdSchema,{id});const data=body&&typeof body==='object'&&'expectedActiveVersion'in body&&typeof (body as {expectedActiveVersion?:unknown}).expectedActiveVersion==='number'?openingApproveReplacementSchema.parse(body):openingApproveInitialSchema.parse(body);if(!key)throw new ErroDeDominio(CODIGOS_DE_ERRO.OPENING_BALANCE_CONFLICT,'Informe Idempotency-Key.');return this.service.aprovar(this.actor(req),company,id,data,key,obterCorrelationId(req));}
}
