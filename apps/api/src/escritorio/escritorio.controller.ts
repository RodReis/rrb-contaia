/**
 * Endpoints do cadastro do escritório. O controller valida a entrada e delega:
 * nenhuma regra de negócio aqui (ARCHITECTURE.md §4).
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';


import { CODIGOS_DE_ERRO, ErroDeDominio } from '@contaia/domain';
import { LIMITE_DE_DOCUMENTO_BYTES } from '@contaia/shared';

import { ExigePermissao, GuardDeAcao } from '../auth/acao.guard';
import { autorDa } from '../auth/contexto-da-sessao';
import {
  GuardDeSessao,
  PermiteCadastroIncompleto,
  type RequisicaoAutenticada,
} from '../auth/sessao.guard';
import {
  analisar,
  enderecoSchema,
  identificacaoSchema,
  responsavelSchema,
} from './escritorio.dto';
import { EscritorioService, type VisaoDoCadastro } from './escritorio.service';

/** O que o interceptor de upload entrega e esta fatia realmente usa. */
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

@Controller('escritorio')
@UseGuards(GuardDeSessao, GuardDeAcao)
// O cadastro é justamente o que o tenant incompleto precisa acessar.
@PermiteCadastroIncompleto()
// Padrão da classe é a ação mais restrita; a leitura a relaxa explicitamente.
@ExigePermissao('escritorio.dados.editar')
export class EscritorioController {
  constructor(private readonly escritorioService: EscritorioService) {}

  @Get()
  @ExigePermissao('escritorio.dados.consultar')
  async obter(@Req() requisicao: RequisicaoAutenticada): Promise<VisaoDoCadastro> {
    return this.escritorioService.obterVisao(tenantDa(requisicao), autorDa(requisicao).usuarioId);
  }

  @Put('identificacao')
  async salvarIdentificacao(
    @Req() requisicao: RequisicaoAutenticada,
    @Body() corpo: unknown,
  ): Promise<VisaoDoCadastro> {
    return this.escritorioService.salvarEtapaIdentificacao(
      tenantDa(requisicao),
      autorDa(requisicao).usuarioId,
      analisar(identificacaoSchema, corpo),
    );
  }

  @Put('responsavel')
  async salvarResponsavel(
    @Req() requisicao: RequisicaoAutenticada,
    @Body() corpo: unknown,
  ): Promise<VisaoDoCadastro> {
    return this.escritorioService.salvarEtapaResponsavel(
      tenantDa(requisicao),
      autorDa(requisicao).usuarioId,
      analisar(responsavelSchema, corpo),
    );
  }

  @Put('endereco')
  async salvarEndereco(
    @Req() requisicao: RequisicaoAutenticada,
    @Body() corpo: unknown,
  ): Promise<VisaoDoCadastro> {
    return this.escritorioService.salvarEtapaEndereco(
      tenantDa(requisicao),
      autorDa(requisicao).usuarioId,
      analisar(enderecoSchema, corpo),
    );
  }

  @Post('logo')
  @UseInterceptors(FileInterceptor('arquivo', { limits: { fileSize: LIMITE_DE_DOCUMENTO_BYTES } }))
  async enviarLogo(
    @Req() requisicao: RequisicaoAutenticada,
    @UploadedFile() arquivo: ArquivoMultipart | undefined,
  ): Promise<VisaoDoCadastro> {
    return this.escritorioService.enviarArquivo(
      tenantDa(requisicao),
      autorDa(requisicao).usuarioId,
      'LOGO',
      exigir(arquivo),
    );
  }

  @Post('documentos')
  @UseInterceptors(FileInterceptor('arquivo', { limits: { fileSize: LIMITE_DE_DOCUMENTO_BYTES } }))
  async enviarDocumento(
    @Req() requisicao: RequisicaoAutenticada,
    @UploadedFile() arquivo: ArquivoMultipart | undefined,
  ): Promise<VisaoDoCadastro> {
    return this.escritorioService.enviarArquivo(
      tenantDa(requisicao),
      autorDa(requisicao).usuarioId,
      'DOCUMENTO',
      exigir(arquivo),
    );
  }

  @Delete('documentos/:id')
  async arquivarDocumento(
    @Req() requisicao: RequisicaoAutenticada,
    @Param('id') id: string,
  ): Promise<VisaoDoCadastro> {
    return this.escritorioService.arquivarDocumento(
      tenantDa(requisicao),
      autorDa(requisicao).usuarioId,
      id,
    );
  }

  @Post('conclusao')
  async concluir(@Req() requisicao: RequisicaoAutenticada): Promise<VisaoDoCadastro> {
    return this.escritorioService.concluir(tenantDa(requisicao), autorDa(requisicao).usuarioId);
  }
}

const exigir = (
  arquivo: ArquivoMultipart | undefined,
): Readonly<{ nomeOriginal: string; tipoConteudo: string; conteudo: Buffer }> => {
  if (arquivo === undefined) {
    throw new ErroDeDominio(CODIGOS_DE_ERRO.ARQUIVO_INVALIDO, 'Nenhum arquivo foi enviado.');
  }

  return {
    nomeOriginal: arquivo.originalname,
    tipoConteudo: arquivo.mimetype,
    conteudo: arquivo.buffer,
  };
};
