/**
 * Rotas da simulação tributária (SPEC-016 §6.2). O controller valida o corpo estrito e delega. O
 * navegador nunca envia regra, alíquota, fórmula nem total: só data do fato, regime, tributo,
 * operação e a base em centavos. Autorização pelo guard do catálogo, nível de simulação.
 */
import { CODIGOS_DE_ERRO, ErroDeDominio, ErroDeValidacao } from '@contaia/domain';
import { LIMITE_DA_NFE_BYTES, ManualTaxSimulationSchema, NfeComplementSchema, type NfeComplement } from '@contaia/shared';
import { Body, Controller, HttpCode, Post, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { z } from 'zod';

import {
  AutorizaCatalogo,
  GuardDoCatalogoTributario,
  type AtorDoCatalogo,
  type RequisicaoDoCatalogo,
} from '../auth/catalogo-tributario.guard';
import { obterCorrelationId } from '../comum/problema';
import { analisar } from '../escritorio/escritorio.dto';
import { InterceptorDoArquivoDeImportacao, type ArquivoMultipart } from '../importacao/http';
import { TaxSimulationsService } from './tax-simulations.service';

/** Multipart em memória, cortado no limite explícito da NF-e antes de carregar o excedente (413). */
const InterceptorDaNfe = InterceptorDoArquivoDeImportacao(LIMITE_DA_NFE_BYTES);

const TAMANHO_MAXIMO_DO_COMPLEMENTO = 16 * 1024;
const corpoDoUploadSchema = z.strictObject({ complemento: z.string().max(TAMANHO_MAXIMO_DO_COMPLEMENTO).optional() });

/** O complemento chega como JSON em um campo de texto do multipart; ausente = só análise. */
const lerComplemento = (corpo: unknown): NfeComplement | null => {
  const { complemento } = analisar(corpoDoUploadSchema, corpo ?? {});
  if (complemento === undefined) {
    return null;
  }

  let bruto: unknown;
  try {
    bruto = JSON.parse(complemento);
  } catch {
    throw new ErroDeValidacao([{ campo: 'complemento', codigo: CODIGOS_DE_ERRO.CAMPO_OBRIGATORIO }]);
  }

  return analisar(NfeComplementSchema, bruto);
};

const exigirXml = (arquivo: ArquivoMultipart | undefined): Buffer => {
  if (arquivo === undefined) {
    throw new ErroDeDominio(CODIGOS_DE_ERRO.NFE_XML_INVALID, 'Nenhum arquivo foi enviado.', [
      { campo: 'arquivo', codigo: CODIGOS_DE_ERRO.NFE_XML_INVALID },
    ]);
  }

  return arquivo.buffer;
};

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

  /**
   * NF-e de teste como entrada alternativa (SPEC-016 §3.6): multipart com `arquivo` (XML) e, opcional,
   * `complemento` (JSON). O arquivo fica em memória durante a requisição e nunca é gravado.
   */
  @Post('nfe')
  @HttpCode(200)
  @AutorizaCatalogo('SIMULACAO')
  @UseInterceptors(InterceptorDaNfe)
  nfe(@Req() requisicao: RequisicaoDoCatalogo, @UploadedFile() arquivo: ArquivoMultipart | undefined, @Body() corpo: unknown) {
    return this.simulations.simulateNfe(
      ator(requisicao),
      exigirXml(arquivo),
      lerComplemento(corpo),
      obterCorrelationId(requisicao),
    );
  }
}
