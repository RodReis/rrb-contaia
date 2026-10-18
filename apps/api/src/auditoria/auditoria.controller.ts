import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { GuardDeAcao, ExigePermissao } from '../auth/acao.guard';
import { autorDa, tenantDa } from '../auth/contexto-da-sessao';
import { GuardDeCadastro, GuardDeSessao, type RequisicaoAutenticada } from '../auth/sessao.guard';
import { obterCorrelationId } from '../comum/problema';
import { analisar } from '../escritorio/escritorio.dto';
import { AuditoriaService, type FiltrosDeAuditoria } from './auditoria.service';

const uuid = z.string().uuid();
const filtrosSchema = z.object({
  inicio: z.string().date().optional(), fim: z.string().date().optional(), empresaId: uuid.optional(),
  atorId: uuid.optional(), agente: z.string().trim().min(1).max(100).optional(),
  tipo: z.string().trim().min(1).max(150).optional(), estado: z.string().trim().min(1).max(100).optional(),
  integridade: z.enum(['VALIDA','INVALIDA','NAO_VERIFICAVEL']).optional(),
  correlationId: z.string().trim().min(1).max(200).optional(),
  pagina: z.coerce.number().int().min(1).max(100000).default(1),
  limite: z.coerce.number().int().min(1).max(100).default(25),
});

@Controller('fiscal/auditoria')
@UseGuards(GuardDeSessao, GuardDeCadastro, GuardDeAcao)
@ExigePermissao('historico.global.consultar')
export class AuditoriaController {
  constructor(private readonly service: AuditoriaService) {}

  @Get()
  listar(@Req() req: RequisicaoAutenticada, @Query() consulta: unknown) {
    const filtros: FiltrosDeAuditoria = analisar(filtrosSchema, consulta);
    return this.service.listar(tenantDa(req), autorDa(req).usuarioId, obterCorrelationId(req), req.sessao?.papeis ?? [], filtros);
  }

  @Get(':id')
  detalhe(@Req() req: RequisicaoAutenticada, @Param('id') id: string) {
    return this.service.detalhe(tenantDa(req), autorDa(req).usuarioId, obterCorrelationId(req), req.sessao?.papeis ?? [], analisar(uuid, id));
  }

  @Post(':id/revelacao')
  @ExigePermissao('usuarios.auditoria_payload.revelar')
  revelar(@Req() req: RequisicaoAutenticada, @Param('id') id: string, @Body() body: unknown) {
    const pedido = analisar(z.object({ justificativa: z.string().trim().min(10).max(500), confirmacao: z.literal(true) }), body);
    return this.service.revelar(tenantDa(req), autorDa(req).usuarioId, obterCorrelationId(req), req.sessao?.papeis ?? [], analisar(uuid, id), pedido.justificativa);
  }

  @Post('exportacoes')
  @HttpCode(202)
  exportar(@Req() req: RequisicaoAutenticada, @Query() consulta: unknown, @Body() body: unknown) {
    const filtros = analisar(filtrosSchema, consulta);
    const formato = analisar(z.object({ formato: z.enum(['JSON','CSV']) }), body).formato;
    return this.service.exportar(tenantDa(req), autorDa(req).usuarioId, obterCorrelationId(req), req.sessao?.papeis ?? [], formato, filtros);
  }

  @Get('exportacoes/:id')
  estadoDaExportacao(@Req() req: RequisicaoAutenticada, @Param('id') id: string) {
    return this.service.estadoDaExportacao(tenantDa(req), autorDa(req).usuarioId, obterCorrelationId(req), req.sessao?.papeis ?? [], analisar(uuid,id));
  }

  @Get('exportacoes/:id/download')
  async baixarExportacao(@Req() req: RequisicaoAutenticada, @Param('id') id: string, @Res() resposta: Response) {
    const arquivo = await this.service.baixarExportacao(tenantDa(req), autorDa(req).usuarioId, obterCorrelationId(req), req.sessao?.papeis ?? [], analisar(uuid,id));
    resposta.setHeader('content-type', arquivo.formato === 'JSON' ? 'application/json; charset=utf-8' : 'text/csv; charset=utf-8');
    resposta.setHeader('content-disposition', `attachment; filename="${arquivo.nome}"`);
    resposta.setHeader('cache-control', 'private, no-store');
    resposta.send(arquivo.conteudo);
  }
}
