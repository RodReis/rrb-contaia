import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
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

  @Post('exportacoes')
  exportar(@Req() req: RequisicaoAutenticada, @Query() consulta: unknown, @Body() body: unknown) {
    const filtros = analisar(filtrosSchema, consulta);
    const formato = analisar(z.object({ formato: z.enum(['JSON','CSV']) }), body).formato;
    return this.service.exportar(tenantDa(req), autorDa(req).usuarioId, obterCorrelationId(req), req.sessao?.papeis ?? [], formato, filtros);
  }
}
