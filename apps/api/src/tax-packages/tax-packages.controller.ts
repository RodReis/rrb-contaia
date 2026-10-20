import { CuratedTaxPackageSchema } from '@contaia/shared';
import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';

import { AutorizaCatalogo, GuardDoCatalogoTributario, type RequisicaoDoCatalogo, type AtorDoCatalogo } from '../auth/catalogo-tributario.guard';
import { obterCorrelationId } from '../comum/problema';
import { analisar } from '../escritorio/escritorio.dto';
import { TaxPackagesService } from './tax-packages.service';

const idSchema = z.object({ id: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu) });
const reviewSchema = z.strictObject({ declaration: z.string().trim().min(20).max(1000) });
const actor = (request: RequisicaoDoCatalogo): AtorDoCatalogo => {
  if (request.atorDoCatalogo === undefined) throw new Error('ator do catálogo ausente');
  return request.atorDoCatalogo;
};

@Controller('tax-packages')
@UseGuards(GuardDoCatalogoTributario)
export class TaxPackagesController {
  constructor(private readonly packages: TaxPackagesService) {}

  @Get()
  @AutorizaCatalogo('CONSULTA')
  list(@Req() request: RequisicaoDoCatalogo) {
    return this.packages.list(actor(request), obterCorrelationId(request));
  }

  @Get(':id')
  @AutorizaCatalogo('CONSULTA')
  get(@Req() request: RequisicaoDoCatalogo, @Param() params: unknown) {
    return this.packages.get(actor(request), analisar(idSchema, params).id, obterCorrelationId(request));
  }

  @Post()
  @AutorizaCatalogo('ADMINISTRACAO')
  import(@Req() request: RequisicaoDoCatalogo, @Body() body: unknown) {
    return this.packages.import(actor(request), analisar(CuratedTaxPackageSchema, body), obterCorrelationId(request));
  }

  @Post(':id/validate')
  @AutorizaCatalogo('ADMINISTRACAO')
  validate(@Req() request: RequisicaoDoCatalogo, @Param() params: unknown) {
    return this.packages.validate(actor(request), analisar(idSchema, params).id, obterCorrelationId(request));
  }

  @Post(':id/review')
  @AutorizaCatalogo('ADMINISTRACAO')
  review(@Req() request: RequisicaoDoCatalogo, @Param() params: unknown, @Body() body: unknown) {
    return this.packages.review(actor(request), analisar(idSchema, params).id, analisar(reviewSchema, body).declaration, obterCorrelationId(request));
  }

  @Post(':id/publish')
  @AutorizaCatalogo('ADMINISTRACAO')
  publish(@Req() request: RequisicaoDoCatalogo, @Param() params: unknown) {
    return this.packages.publish(actor(request), analisar(idSchema, params).id, obterCorrelationId(request));
  }

  @Post(':id/archive')
  @AutorizaCatalogo('ADMINISTRACAO')
  archive(@Req() request: RequisicaoDoCatalogo, @Param() params: unknown) {
    return this.packages.archive(actor(request), analisar(idSchema, params).id, obterCorrelationId(request));
  }
}
