/**
 * Endpoints dos documentos da empresa (SPEC-004). O controller valida a
 * entrada e delega; nenhuma regra aqui.
 *
 * `tenantId` e autor saem sempre da sessão, nunca do corpo: um corpo que
 * escolhe o próprio escritório é o caminho mais curto para dado cruzado.
 */
import { CODIGOS_DE_ERRO, ErroDeDominio } from '@contaia/domain';
import type { EventoDocumentalNaLista } from '@contaia/db';
import { LIMITE_DE_DOCUMENTO_DA_EMPRESA_BYTES } from '@contaia/shared';
import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';

import { GuardDeCadastro, GuardDeSessao, type RequisicaoAutenticada } from '../auth/sessao.guard';
import { analisar } from '../escritorio/escritorio.dto';
import {
  analiseComJustificativaSchema,
  analiseSchema,
  envioDeDocumentoSchema,
  exigenciaEspecificaSchema,
  paginacaoDoHistoricoSchema,
} from './empresa.dto';
import {
  type Autor,
  DocumentosDaEmpresaService,
  type VisaoDosDocumentos,
} from './documentos.service';

type ArquivoMultipart = Readonly<{
  originalname: string;
  mimetype: string;
  buffer: Buffer;
}>;

const tenantDa = (requisicao: RequisicaoAutenticada): string => {
  const tenantId = requisicao.sessao?.tenantId;

  if (tenantId === undefined) {
    throw new ErroDeDominio(
      CODIGOS_DE_ERRO.TENANT_DIVERGENTE,
      'Sessão sem escritório associado.',
    );
  }

  return tenantId;
};

/** Autor do evento documental: vem da sessão, nunca do corpo da requisição. */
const autorDa = (requisicao: RequisicaoAutenticada): Autor => {
  const usuarioId = requisicao.sessao?.usuarioId;

  if (usuarioId === undefined) {
    throw new ErroDeDominio(
      CODIGOS_DE_ERRO.TENANT_DIVERGENTE,
      'Sessão sem usuário associado.',
    );
  }

  return { usuarioId };
};

const exigirArquivo = (arquivo: ArquivoMultipart | undefined) => {
  if (arquivo === undefined) {
    throw new ErroDeDominio(CODIGOS_DE_ERRO.ARQUIVO_INVALIDO, 'Nenhum arquivo foi enviado.');
  }

  return {
    nomeOriginal: arquivo.originalname,
    tipoConteudo: arquivo.mimetype,
    conteudo: arquivo.buffer,
  };
};

@Controller('empresas/:empresaId/documentos')
@UseGuards(GuardDeSessao, GuardDeCadastro)
export class DocumentosDaEmpresaController {
  constructor(private readonly documentos: DocumentosDaEmpresaService) {}

  @Get()
  async consultar(
    @Req() requisicao: RequisicaoAutenticada,
    @Param('empresaId') empresaId: string,
  ): Promise<VisaoDosDocumentos> {
    return this.documentos.consultar(
      tenantDa(requisicao),
      empresaId,
      autorDa(requisicao),
    );
  }

  @Post('exigencias')
  async criarExigencia(
    @Req() requisicao: RequisicaoAutenticada,
    @Param('empresaId') empresaId: string,
    @Body() corpo: unknown,
  ): Promise<VisaoDosDocumentos> {
    return this.documentos.criarExigencia(
      tenantDa(requisicao),
      empresaId,
      autorDa(requisicao),
      analisar(exigenciaEspecificaSchema, corpo),
    );
  }

  /**
   * Envio e substituição. O `limits` do interceptor corta o upload no limite
   * antes de o processo carregar 20 MB de corpo desnecessário; a validação de
   * tipo e tamanho é refeita no caso de uso, que é a fronteira real.
   */
  @Post('exigencias/:exigenciaId/versoes')
  @UseInterceptors(
    FileInterceptor('arquivo', { limits: { fileSize: LIMITE_DE_DOCUMENTO_DA_EMPRESA_BYTES } }),
  )
  async enviarArquivo(
    @Req() requisicao: RequisicaoAutenticada,
    @Param('empresaId') empresaId: string,
    @Param('exigenciaId') exigenciaId: string,
    @UploadedFile() arquivo: ArquivoMultipart | undefined,
    @Body() corpo: unknown,
  ): Promise<VisaoDosDocumentos> {
    const entrada = analisar(envioDeDocumentoSchema, corpo);

    return this.documentos.enviarArquivo(
      tenantDa(requisicao),
      empresaId,
      exigenciaId,
      autorDa(requisicao),
      exigirArquivo(arquivo),
      entrada.validade,
    );
  }

  @Put('exigencias/:exigenciaId/aprovacao')
  async aprovar(
    @Req() requisicao: RequisicaoAutenticada,
    @Param('empresaId') empresaId: string,
    @Param('exigenciaId') exigenciaId: string,
    @Body() corpo: unknown,
  ): Promise<VisaoDosDocumentos> {
    const entrada = analisar(analiseSchema, corpo);

    return this.documentos.aprovar(
      tenantDa(requisicao),
      empresaId,
      exigenciaId,
      autorDa(requisicao),
      entrada.versao,
    );
  }

  @Put('exigencias/:exigenciaId/rejeicao')
  async rejeitar(
    @Req() requisicao: RequisicaoAutenticada,
    @Param('empresaId') empresaId: string,
    @Param('exigenciaId') exigenciaId: string,
    @Body() corpo: unknown,
  ): Promise<VisaoDosDocumentos> {
    const entrada = analisar(analiseComJustificativaSchema, corpo);

    return this.documentos.rejeitar(
      tenantDa(requisicao),
      empresaId,
      exigenciaId,
      autorDa(requisicao),
      entrada.justificativa,
      entrada.versao,
    );
  }

  @Put('exigencias/:exigenciaId/dispensa')
  async dispensar(
    @Req() requisicao: RequisicaoAutenticada,
    @Param('empresaId') empresaId: string,
    @Param('exigenciaId') exigenciaId: string,
    @Body() corpo: unknown,
  ): Promise<VisaoDosDocumentos> {
    const entrada = analisar(analiseComJustificativaSchema, corpo);

    return this.documentos.dispensar(
      tenantDa(requisicao),
      empresaId,
      exigenciaId,
      autorDa(requisicao),
      entrada.justificativa,
      entrada.versao,
    );
  }

  /**
   * Visualização no navegador: `inline`, com o tipo gravado no banco.
   *
   * `nosniff` e `Content-Disposition` explícitos porque o arquivo é conteúdo
   * enviado por terceiro: sem eles, o navegador pode inferir outro tipo e
   * executar o que deveria apenas exibir.
   */
  @Get('exigencias/:exigenciaId/versoes/:versaoId/conteudo')
  @Header('X-Content-Type-Options', 'nosniff')
  async visualizar(
    @Req() requisicao: RequisicaoAutenticada,
    @Param('empresaId') empresaId: string,
    @Param('exigenciaId') exigenciaId: string,
    @Param('versaoId') versaoId: string,
    @Res() resposta: Response,
  ): Promise<void> {
    const arquivo = await this.documentos.obterArquivo(
      tenantDa(requisicao),
      empresaId,
      exigenciaId,
      versaoId,
      autorDa(requisicao),
      'VISUALIZACAO',
    );

    resposta
      .status(200)
      .setHeader('Content-Type', arquivo.tipoConteudo)
      .setHeader('Content-Disposition', `inline; filename="${nomeSeguro(arquivo.nomeOriginal)}"`)
      .send(arquivo.conteudo);
  }

  /** Download no formato original (§2.3). */
  @Get('exigencias/:exigenciaId/versoes/:versaoId/download')
  @Header('X-Content-Type-Options', 'nosniff')
  async baixar(
    @Req() requisicao: RequisicaoAutenticada,
    @Param('empresaId') empresaId: string,
    @Param('exigenciaId') exigenciaId: string,
    @Param('versaoId') versaoId: string,
    @Res() resposta: Response,
  ): Promise<void> {
    const arquivo = await this.documentos.obterArquivo(
      tenantDa(requisicao),
      empresaId,
      exigenciaId,
      versaoId,
      autorDa(requisicao),
      'DOWNLOAD',
    );

    resposta
      .status(200)
      .setHeader('Content-Type', arquivo.tipoConteudo)
      .setHeader(
        'Content-Disposition',
        `attachment; filename="${nomeSeguro(arquivo.nomeOriginal)}"`,
      )
      .send(arquivo.conteudo);
  }

  @Get('historico')
  async consultarHistorico(
    @Req() requisicao: RequisicaoAutenticada,
    @Param('empresaId') empresaId: string,
    @Query() consulta: unknown,
  ): Promise<Readonly<{ eventos: readonly EventoDocumentalNaLista[]; total: number }>> {
    return this.documentos.consultarHistorico(
      tenantDa(requisicao),
      empresaId,
      analisar(paginacaoDoHistoricoSchema, consulta),
    );
  }
}

/**
 * O nome original vem do usuário e vai para um cabeçalho HTTP: aspas, quebra
 * de linha e caractere de controle nele permitiriam injetar cabeçalho. Só o
 * que é seguro sobrevive, e o nome nunca é usado como caminho.
 */
const nomeSeguro = (nome: string): string =>
  nome.replace(/[^\w.\- ]+/gu, '_').slice(0, 120) || 'documento';
