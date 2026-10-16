import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';

import {
  AutorizaCatalogo,
  GuardDoCatalogoTributario,
  type AtorDoCatalogo,
  type RequisicaoDoCatalogo,
} from '../auth/catalogo-tributario.guard';
import { obterCorrelationId } from '../comum/problema';
import { analisar } from '../escritorio/escritorio.dto';
import { ObligationsService } from './obligations.service';
import { coberturaCalendarioSchema, feriadoSchema, publicacaoSchema, regraSchema } from './obligations.dto';

const idSchema = z.object({ id: z.string().uuid() });

const ator = (req: RequisicaoDoCatalogo): AtorDoCatalogo => {
  if (req.atorDoCatalogo === undefined) throw new Error('ator do catálogo ausente');
  return req.atorDoCatalogo;
};

/** Catálogo global F22, separado da agenda sob tenant e carteira. */
@Controller('fiscal/obrigacoes/catalogo')
@UseGuards(GuardDoCatalogoTributario)
export class ObligationsCatalogController {
  constructor(private readonly service: ObligationsService) {}

  @Get('regras')
  @AutorizaCatalogo('CONSULTA')
  regras(@Req() req: RequisicaoDoCatalogo) {
    return this.service.regrasCatalogo(ator(req), obterCorrelationId(req));
  }

  @Post('regras')
  @AutorizaCatalogo('ADMINISTRACAO')
  criarRegra(@Req() req: RequisicaoDoCatalogo, @Body() body: unknown) {
    return this.service.criarRegra(ator(req), analisar(regraSchema, body), obterCorrelationId(req));
  }

  @Post('regras/:id/publicacao')
  @AutorizaCatalogo('ADMINISTRACAO')
  publicar(@Req() req: RequisicaoDoCatalogo, @Param() params: unknown, @Body() body: unknown) {
    const { id } = analisar(idSchema, params);
    const { versao } = analisar(publicacaoSchema, body);
    return this.service.publicar(ator(req), id, versao, obterCorrelationId(req));
  }

  @Post('regras/:id/arquivamento')
  @AutorizaCatalogo('ADMINISTRACAO')
  arquivar(@Req() req: RequisicaoDoCatalogo, @Param() params: unknown, @Body() body: unknown) {
    const { id } = analisar(idSchema, params);
    const { versao } = analisar(publicacaoSchema, body);
    return this.service.arquivar(ator(req), id, versao, obterCorrelationId(req));
  }

  @Post('calendario/feriados')
  @AutorizaCatalogo('ADMINISTRACAO')
  feriado(@Req() req: RequisicaoDoCatalogo, @Body() body: unknown) {
    return this.service.feriado(ator(req), analisar(feriadoSchema, body), obterCorrelationId(req));
  }

  @Post('calendario/cobertura')
  @AutorizaCatalogo('ADMINISTRACAO')
  cobertura(@Req() req: RequisicaoDoCatalogo, @Body() body: unknown) {
    return this.service.salvarCobertura(ator(req), analisar(coberturaCalendarioSchema, body), obterCorrelationId(req));
  }
}
