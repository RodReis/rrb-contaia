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

import { CODIGOS_DE_ERRO, ErroDeDominio, MODELO_CSV } from '@contaia/domain';
import { LIMITE_DE_IMPORTACAO_DO_PLANO_BYTES } from '@contaia/shared';
import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Injectable,
  Param,
  PayloadTooLargeException,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import type { Observable } from 'rxjs';

import { ExigePermissao, GuardDeAcao } from '../auth/acao.guard';
import { autorDa, tenantDa } from '../auth/contexto-da-sessao';
import { GuardDeEscopoDeEmpresa } from '../auth/escopo';
import { GuardDeCadastro, GuardDeSessao, type RequisicaoAutenticada } from '../auth/sessao.guard';
import { nomeSeguro } from '../comum/nome-seguro';
import { obterCorrelationId } from '../comum/problema';
import { analisar } from '../escritorio/escritorio.dto';
import { analisarEnvio, confirmacaoSchema, consultaDoPlanoSchema, idDaTentativa, paginaSchema } from './plano-contas.dto';
import { PlanoContasService, type ContextoDaImportacao } from './plano-contas.service';

type ArquivoMultipart = Readonly<{ originalname: string; mimetype: string; buffer: Buffer }>;

const CSV_UTF8 = 'text/csv; charset=utf-8';
const NOME_DO_MODELO = 'modelo-plano-de-contas.csv';
/** BOM UTF-8: sem ele o Excel pt-BR abre o arquivo como Windows-1252 e estraga os acentos. */
const MARCA_DE_ORDEM = String.fromCharCode(0xfeff);

const contextoDa = (requisicao: RequisicaoAutenticada): ContextoDaImportacao => ({
  tenantId: tenantDa(requisicao),
  usuarioId: autorDa(requisicao).usuarioId,
  correlationId: obterCorrelationId(requisicao),
});

/** Cabeçalho de download: nome saneado (vem do usuário) e sem inferência de tipo pelo navegador. */
export const comoAnexo = (resposta: Response, tipo: string, nome: string): Response =>
  resposta
    .status(200)
    .setHeader('Content-Type', tipo)
    .setHeader('Content-Disposition', `attachment; filename="${nomeSeguro(nome, 'plano-de-contas.csv')}"`)
    .setHeader('X-Content-Type-Options', 'nosniff');

const MultipartDoPlano = FileInterceptor('arquivo', {
  // O multer corta o upload no limite, antes de o processo carregar o excedente; o caso de uso
  // refaz a conferência de tamanho, que é a fronteira real.
  limits: { fileSize: LIMITE_DE_IMPORTACAO_DO_PLANO_BYTES, files: 1, fields: 2, fieldSize: 16 * 1024 },
});

/** O corte do multer sai como `ARQUIVO_ACIMA_DO_LIMITE` (413), o mesmo código do caso de uso. */
@Injectable()
export class InterceptorDoArquivoDoPlano implements NestInterceptor {
  private readonly multipart: NestInterceptor = new MultipartDoPlano();

  async intercept(contexto: ExecutionContext, proximo: CallHandler): Promise<Observable<unknown>> {
    try {
      return await this.multipart.intercept(contexto, proximo);
    } catch (erro) {
      if (erro instanceof PayloadTooLargeException) {
        throw new ErroDeDominio(CODIGOS_DE_ERRO.ARQUIVO_ACIMA_DO_LIMITE, 'Arquivo acima do limite de 10 MB.');
      }

      throw erro;
    }
  }
}

const exigirArquivo = (arquivo: ArquivoMultipart | undefined) => {
  if (arquivo === undefined) {
    throw new ErroDeDominio(CODIGOS_DE_ERRO.ARQUIVO_INVALIDO, 'Nenhum arquivo foi enviado.', [
      { campo: 'arquivo', codigo: CODIGOS_DE_ERRO.ARQUIVO_INVALIDO },
    ]);
  }

  return { buffer: arquivo.buffer, nome: arquivo.originalname, mimetype: arquivo.mimetype };
};

@Controller('empresas/:empresaId/plano-contas')
@UseGuards(GuardDeSessao, GuardDeCadastro, GuardDeAcao, GuardDeEscopoDeEmpresa)
export class PlanoContasDaEmpresaController {
  constructor(private readonly planoContas: PlanoContasService) {}

  /** Modelo oficial (§2): com BOM, para o Excel abrir em UTF-8. */
  @Get('modelo')
  @ExigePermissao('empresas.plano_contas.baixar_relatorio')
  modelo(@Res() resposta: Response): void {
    comoAnexo(resposta, CSV_UTF8, NOME_DO_MODELO).send(`${MARCA_DE_ORDEM}${MODELO_CSV}`);
  }

  /** Envio: multipart com `arquivo` e `mapeamento` (JSON). A validação é assíncrona: 202. */
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

    return this.planoContas.enviar(contextoDa(requisicao), empresaId, exigirArquivo(arquivo), mapeamento);
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

  /** Arquivo original como foi enviado (§3.9): sem charset, porque a codificação é a do usuário. */
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

    comoAnexo(resposta, 'text/csv', original.nome).send(original.conteudo);
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
