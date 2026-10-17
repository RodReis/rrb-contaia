import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { GuardDeAcao, ExigePermissao } from '../auth/acao.guard';
import { GuardDeCadastro, GuardDeSessao, type RequisicaoAutenticada } from '../auth/sessao.guard';
import { autorDa, tenantDa } from '../auth/contexto-da-sessao';
import { analisar } from '../escritorio/escritorio.dto';
import { DashboardService } from './dashboard.service';

const filtroSchema = z.object({ busca: z.string().max(160).optional(), cor: z.enum(['VERMELHO','AMARELO','VERDE']).optional(), regime: z.enum(['SIMPLES_NACIONAL','LUCRO_PRESUMIDO','LUCRO_REAL']).optional(), fonte: z.enum(['PENDENCIAS','CERTIFICADOS','CAPTURA','MANIFESTACOES','OBRIGACOES']).optional(), codigo: z.string().regex(/^[A-Z0-9_]{2,80}$/u).optional(), ordem: z.enum(['URGENCIA','NOME']).default('URGENCIA'), limite: z.coerce.number().int().min(1).max(100).default(25), deslocamento: z.coerce.number().int().min(0).default(0) });

@Controller('dashboard')
@UseGuards(GuardDeSessao, GuardDeCadastro, GuardDeAcao)
@ExigePermissao('empresas.cadastro.consultar')
export class DashboardController {
  constructor(private readonly service: DashboardService) {}
  @Get() consultar(@Req() req: RequisicaoAutenticada, @Query() query: unknown) {
    const filtro = analisar(filtroSchema, query);
    return this.service.consultar(tenantDa(req), autorDa(req).usuarioId, { busca: filtro.busca ?? null, cor: filtro.cor ?? null,
      regime: filtro.regime ?? null, fonte: filtro.fonte ?? null, codigo: filtro.codigo ?? null, ordem: filtro.ordem,
      limite: filtro.limite, deslocamento: filtro.deslocamento });
  }
  @Get(':empresaId/motivos') motivos(@Req() req: RequisicaoAutenticada, @Param('empresaId') empresaId: string) {
    return this.service.motivos(tenantDa(req), autorDa(req).usuarioId, analisar(z.string().uuid(), empresaId));
  }
}
