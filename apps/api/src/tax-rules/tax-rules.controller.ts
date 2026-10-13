/**
 * Rotas do catálogo tributário global (SPEC-016 §6.2). O controller valida e delega; nenhuma regra
 * aqui. Autorização pelo `GuardDoCatalogoTributario`: consultar vale para o escritório com a chave
 * do catálogo e para o super_admin; criar, editar, publicar e arquivar são só do super_admin. O ator
 * e a correlação saem da sessão validada e do cabeçalho, nunca do corpo.
 */
import {
  CreateTaxRuleSchema,
  ListTaxRulesQuerySchema,
  TaxRuleCommandSchema,
  UpdateTaxRuleSchema,
} from '@contaia/shared';
import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';

import {
  AutorizaCatalogo,
  GuardDoCatalogoTributario,
  type AtorDoCatalogo,
  type RequisicaoDoCatalogo,
} from '../auth/catalogo-tributario.guard';
import { obterCorrelationId } from '../comum/problema';
import { analisar } from '../escritorio/escritorio.dto';
import { TaxRulesService } from './tax-rules.service';

const idDaRegraSchema = z.object({ id: z.uuid() });

const ator = (requisicao: RequisicaoDoCatalogo): AtorDoCatalogo => {
  if (requisicao.atorDoCatalogo === undefined) {
    // O guard sempre o preenche antes do método; sem ele a rota não passou pela autorização.
    throw new Error('ator do catálogo ausente: a rota não passou pelo GuardDoCatalogoTributario');
  }

  return requisicao.atorDoCatalogo;
};

@Controller('tax-rules')
@UseGuards(GuardDoCatalogoTributario)
export class TaxRulesController {
  constructor(private readonly taxRules: TaxRulesService) {}

  @Get()
  @AutorizaCatalogo('CONSULTA')
  list(@Req() requisicao: RequisicaoDoCatalogo, @Query() consulta: unknown) {
    return this.taxRules.list(ator(requisicao), analisar(ListTaxRulesQuerySchema, consulta), obterCorrelationId(requisicao));
  }

  @Post()
  @AutorizaCatalogo('ADMINISTRACAO')
  create(@Req() requisicao: RequisicaoDoCatalogo, @Body() corpo: unknown) {
    return this.taxRules.create(ator(requisicao), analisar(CreateTaxRuleSchema, corpo), obterCorrelationId(requisicao));
  }

  @Get(':id')
  @AutorizaCatalogo('CONSULTA')
  get(@Req() requisicao: RequisicaoDoCatalogo, @Param() parametros: unknown) {
    const { id } = analisar(idDaRegraSchema, parametros);

    return this.taxRules.get(ator(requisicao), id, obterCorrelationId(requisicao));
  }

  @Put(':id')
  @AutorizaCatalogo('ADMINISTRACAO')
  update(@Req() requisicao: RequisicaoDoCatalogo, @Param() parametros: unknown, @Body() corpo: unknown) {
    const { id } = analisar(idDaRegraSchema, parametros);

    return this.taxRules.update(ator(requisicao), id, analisar(UpdateTaxRuleSchema, corpo), obterCorrelationId(requisicao));
  }

  @Post(':id/publish')
  @HttpCode(200)
  @AutorizaCatalogo('ADMINISTRACAO')
  publish(@Req() requisicao: RequisicaoDoCatalogo, @Param() parametros: unknown, @Body() corpo: unknown) {
    const { id } = analisar(idDaRegraSchema, parametros);

    return this.taxRules.publish(ator(requisicao), id, analisar(TaxRuleCommandSchema, corpo), obterCorrelationId(requisicao));
  }

  @Post(':id/archive')
  @HttpCode(200)
  @AutorizaCatalogo('ADMINISTRACAO')
  archive(@Req() requisicao: RequisicaoDoCatalogo, @Param() parametros: unknown, @Body() corpo: unknown) {
    const { id } = analisar(idDaRegraSchema, parametros);

    return this.taxRules.archive(ator(requisicao), id, analisar(TaxRuleCommandSchema, corpo), obterCorrelationId(requisicao));
  }
}
