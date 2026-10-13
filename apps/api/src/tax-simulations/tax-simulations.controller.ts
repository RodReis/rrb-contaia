/**
 * Rotas da simulação tributária (SPEC-016 §6.2). O controller valida o corpo estrito e delega. O
 * navegador nunca envia regra, alíquota, fórmula nem total: só data do fato, regime, tributo,
 * operação e a base em centavos. Autorização pelo guard do catálogo, nível de simulação.
 */
import { ManualTaxSimulationSchema } from '@contaia/shared';
import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';

import {
  AutorizaCatalogo,
  GuardDoCatalogoTributario,
  type AtorDoCatalogo,
  type RequisicaoDoCatalogo,
} from '../auth/catalogo-tributario.guard';
import { obterCorrelationId } from '../comum/problema';
import { analisar } from '../escritorio/escritorio.dto';
import { TaxSimulationsService } from './tax-simulations.service';

const ator = (requisicao: RequisicaoDoCatalogo): AtorDoCatalogo => {
  if (requisicao.atorDoCatalogo === undefined) {
    // O guard sempre o preenche antes do método; sem ele a rota não passou pela autorização.
    throw new Error('ator do catálogo ausente: a rota não passou pelo GuardDoCatalogoTributario');
  }

  return requisicao.atorDoCatalogo;
};

@Controller('tax-simulations')
@UseGuards(GuardDoCatalogoTributario)
export class TaxSimulationsController {
  constructor(private readonly simulations: TaxSimulationsService) {}

  @Post('manual')
  @HttpCode(200)
  @AutorizaCatalogo('SIMULACAO')
  manual(@Req() requisicao: RequisicaoDoCatalogo, @Body() corpo: unknown) {
    return this.simulations.simulateManual(
      ator(requisicao),
      analisar(ManualTaxSimulationSchema, corpo),
      obterCorrelationId(requisicao),
    );
  }
}
