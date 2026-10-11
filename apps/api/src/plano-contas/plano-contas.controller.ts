/**
 * Rotas da importação do plano de contas (SPEC-013 §3.12, §6.2). O controller valida a entrada e
 * delega; nenhuma regra aqui.
 *
 * Autorização: sessão, cadastro, a chave do catálogo POR MÉTODO (`@ExigePermissao` no método — na
 * classe ele seria sobrescrito) e a alçada da carteira para a empresa da rota. Confirmar e cancelar
 * exigem a permissão, não ser o iniciador (§3.8 "usuário autorizado"). Tenant e autor saem sempre
 * da sessão; a empresa, da rota; o caso de uso confere a tentativa contra essa empresa (id de outra
 * empresa ou de outro tenant → 404).
 *
 * Registrado ANTES de `EmpresaController`, como os demais controllers aninhados em `empresas/:empresaId`.
 */
import { pipeline } from 'node:stream/promises';

import { MODELO_CSV } from '@contaia/domain';
import { LIMITE_DE_IMPORTACAO_DO_PLANO_BYTES, tipoDeConteudoDoFormato } from '@contaia/shared';
import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';

import { ExigePermissao, GuardDeAcao } from '../auth/acao.guard';
import { GuardDeEscopoDeEmpresa } from '../auth/escopo';
import { GuardDeCadastro, GuardDeSessao, type RequisicaoAutenticada } from '../auth/sessao.guard';
import { analisar } from '../escritorio/escritorio.dto';
import { analisarCamposDePlanilha, analisarPedidoDeInspecao } from '../importacao/dto';
import {
  CSV_UTF8,
  InterceptorDoArquivoDeImportacao,
  comoAnexo as comoAnexoDeImportacao,
  contextoDa,
  exigirArquivo,
  type ArquivoMultipart,
} from '../importacao/http';
import { consultaDoModeloSchema, montarModelo } from '../importacao/modelos';
import { analisarEnvio, confirmacaoSchema, consultaDoPlanoSchema, idDaTentativa, paginaSchema } from './plano-contas.dto';
import { PlanoContasService } from './plano-contas.service';

const NOME_DO_MODELO = 'modelo-plano-de-contas';

/** Cabeçalho de download (ver `importacao/http.ts`), com o nome padrão do plano. */
export const comoAnexo = (resposta: Response, tipo: string, nome: string): Response =>
  comoAnexoDeImportacao(resposta, tipo, nome, 'plano-de-contas.csv');

export const InterceptorDoArquivoDoPlano = InterceptorDoArquivoDeImportacao(LIMITE_DE_IMPORTACAO_DO_PLANO_BYTES);

@Controller('empresas/:empresaId/plano-contas')
@UseGuards(GuardDeSessao, GuardDeCadastro, GuardDeAcao, GuardDeEscopoDeEmpresa)
export class PlanoContasDaEmpresaController {
  constructor(private readonly planoContas: PlanoContasService) {}

  /** Modelo oficial (§2; SPEC-015 §3.1): `?formato=csv|xlsx|ods`, padrão CSV com BOM. */
  @Get('modelo')
  @ExigePermissao('empresas.plano_contas.baixar_relatorio')
  modelo(@Query() consulta: unknown, @Res() resposta: Response): void {
    const modelo = montarModelo(MODELO_CSV, analisar(consultaDoModeloSchema, consulta).formato);

    comoAnexo(resposta, modelo.tipoConteudo, `${NOME_DO_MODELO}.${modelo.extensao}`).send(modelo.conteudo);
  }

  /**
   * Inspeção sem estado da planilha (SPEC-015 §3.3–§3.4): multipart com `arquivo` e, opcionais,
   * `aba` (posição) e `linhaCabecalho`. Nada é gravado; a permissão é a de importar.
   */
  @Post('planilhas/inspecao')
  @HttpCode(200)
  @ExigePermissao('empresas.plano_contas.importar')
  @UseInterceptors(InterceptorDoArquivoDoPlano)
  inspecionarPlanilha(
    @Req() requisicao: RequisicaoAutenticada,
    @UploadedFile() arquivo: ArquivoMultipart | undefined,
    @Body() corpo: unknown,
  ) {
    const pedido = analisarPedidoDeInspecao(corpo);

    return this.planoContas.inspecionarPlanilha(contextoDa(requisicao), exigirArquivo(arquivo), pedido);
  }

  /**
   * Envio: multipart com `arquivo` e `mapeamento` (JSON); na planilha, também `aba` e
   * `linhaCabecalho`, e o mapeamento aponta a LETRA da coluna. A validação é assíncrona: 202.
   */
  @Post('importacoes')
  @HttpCode(202)
  @ExigePermissao('empresas.plano_contas.importar')
  @UseInterceptors(InterceptorDoArquivoDoPlano)
  enviar(
    @Req() requisicao: RequisicaoAutenticada,
    @Param('empresaId') empresaId: string,
    @UploadedFile() arquivo: ArquivoMultipart | undefined,
    @Body() corpo: unknown,
  ) {
    const mapeamento = analisarEnvio(corpo);
    const planilha = analisarCamposDePlanilha(corpo);

    return this.planoContas.enviar(contextoDa(requisicao), empresaId, exigirArquivo(arquivo, planilha), mapeamento);
  }

  @Get('importacoes')
  @ExigePermissao('empresas.plano_contas.consultar')
  historico(@Req() requisicao: RequisicaoAutenticada, @Param('empresaId') empresaId: string, @Query() consulta: unknown) {
    return this.planoContas.historico(contextoDa(requisicao), empresaId, analisar(paginaSchema, consulta).pagina);
  }

  @Get('importacoes/:tentativaId')
  @ExigePermissao('empresas.plano_contas.consultar')
  previa(
    @Req() requisicao: RequisicaoAutenticada,
    @Param('empresaId') empresaId: string,
    @Param('tentativaId') tentativaId: string,
  ) {
    return this.planoContas.previa(contextoDa(requisicao), empresaId, idDaTentativa(tentativaId));
  }

  @Get('importacoes/:tentativaId/rejeicoes')
  @ExigePermissao('empresas.plano_contas.consultar')
  rejeicoes(
    @Req() requisicao: RequisicaoAutenticada,
    @Param('empresaId') empresaId: string,
    @Param('tentativaId') tentativaId: string,
    @Query() consulta: unknown,
  ) {
    return this.planoContas.rejeicoes(
      contextoDa(requisicao),
      empresaId,
      idDaTentativa(tentativaId),
      analisar(paginaSchema, consulta).pagina,
    );
  }

  /**
   * Relatório completo em CSV, em fluxo. Erro antes do primeiro byte (tentativa inexistente, sem
   * resultado) vira problem+json; depois, o cliente que desiste encerra o fluxo e o cursor.
   */
  @Get('importacoes/:tentativaId/relatorio')
  @ExigePermissao('empresas.plano_contas.baixar_relatorio')
  @Header('X-Content-Type-Options', 'nosniff')
  async relatorio(
    @Req() requisicao: RequisicaoAutenticada,
    @Param('empresaId') empresaId: string,
    @Param('tentativaId') tentativaId: string,
    @Res() resposta: Response,
  ): Promise<void> {
    const { nomeDoArquivo, conteudo } = await this.planoContas.relatorio(
      contextoDa(requisicao),
      empresaId,
      idDaTentativa(tentativaId),
    );

    comoAnexo(resposta, CSV_UTF8, nomeDoArquivo);

    // O cabeçalho já saiu: falha daqui em diante só corta o download (o serviço registra a causa).
    await pipeline(conteudo, resposta).catch(() => undefined);
  }

  /**
   * Arquivo original como foi enviado (§3.9), com o tipo do formato da tentativa (CSV sem charset,
   * porque a codificação é a do usuário).
   */
  @Get('importacoes/:tentativaId/arquivo')
  @ExigePermissao('empresas.plano_contas.baixar_relatorio')
  @Header('X-Content-Type-Options', 'nosniff')
  async arquivoOriginal(
    @Req() requisicao: RequisicaoAutenticada,
    @Param('empresaId') empresaId: string,
    @Param('tentativaId') tentativaId: string,
    @Res() resposta: Response,
  ): Promise<void> {
    const original = await this.planoContas.arquivoOriginal(contextoDa(requisicao), empresaId, idDaTentativa(tentativaId));

    comoAnexo(resposta, tipoDeConteudoDoFormato(original.formato), original.nome).send(original.conteudo);
  }

  @Post('importacoes/:tentativaId/confirmar')
  @HttpCode(200)
  @ExigePermissao('empresas.plano_contas.confirmar_importacao')
  confirmar(
    @Req() requisicao: RequisicaoAutenticada,
    @Param('empresaId') empresaId: string,
    @Param('tentativaId') tentativaId: string,
    @Body() corpo: unknown,
  ) {
    const { versaoDaPrevia } = analisar(confirmacaoSchema, corpo);

    return this.planoContas.confirmar(contextoDa(requisicao), empresaId, idDaTentativa(tentativaId), versaoDaPrevia);
  }

  @Post('importacoes/:tentativaId/cancelar')
  @HttpCode(200)
  @ExigePermissao('empresas.plano_contas.confirmar_importacao')
  cancelar(
    @Req() requisicao: RequisicaoAutenticada,
    @Param('empresaId') empresaId: string,
    @Param('tentativaId') tentativaId: string,
  ) {
    return this.planoContas.cancelar(contextoDa(requisicao), empresaId, idDaTentativa(tentativaId));
  }

  @Get('contas')
  @ExigePermissao('empresas.plano_contas.consultar')
  contas(@Req() requisicao: RequisicaoAutenticada, @Param('empresaId') empresaId: string, @Query() consulta: unknown) {
    const { pagina, busca } = analisar(consultaDoPlanoSchema, consulta);

    return this.planoContas.plano(contextoDa(requisicao), empresaId, pagina, busca);
  }
}
