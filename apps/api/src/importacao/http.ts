/**
 * Peças HTTP comuns das rotas de importação por arquivo: contexto da sessão, cabeçalho de download,
 * multipart com corte no limite e a exigência do arquivo. Nenhuma regra de negócio aqui.
 */
import { CODIGOS_DE_ERRO, ErroDeDominio } from '@contaia/domain';
import {
  Injectable,
  PayloadTooLargeException,
  mixin,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
  type Type,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import type { Observable } from 'rxjs';

import { autorDa, tenantDa } from '../auth/contexto-da-sessao';
import type { RequisicaoAutenticada } from '../auth/sessao.guard';
import { nomeSeguro } from '../comum/nome-seguro';
import { obterCorrelationId } from '../comum/problema';
import type { ArquivoEnviado, ContextoDaImportacao } from './orquestrador';
import type { CamposDePlanilhaInformados } from './planilha';

export type ArquivoMultipart = Readonly<{ originalname: string; mimetype: string; buffer: Buffer }>;

export const CSV_UTF8 = 'text/csv; charset=utf-8';
/** BOM UTF-8: sem ele o Excel pt-BR abre o arquivo como Windows-1252 e estraga os acentos. */
export const MARCA_DE_ORDEM = String.fromCharCode(0xfeff);

/** Tenant e autor saem sempre da sessão; a correlação, do cabeçalho da requisição. */
export const contextoDa = (requisicao: RequisicaoAutenticada): ContextoDaImportacao => ({
  tenantId: tenantDa(requisicao),
  usuarioId: autorDa(requisicao).usuarioId,
  correlationId: obterCorrelationId(requisicao),
});

/**
 * Cabeçalho de download: nome saneado (vem do usuário), sem inferência de tipo pelo navegador e
 * sem cache (`no-store`: base, relatório e original de um cliente não ficam no navegador nem em
 * proxy intermediário; o proxy do web repassa este cabeçalho).
 */
export const comoAnexo = (resposta: Response, tipo: string, nome: string, nomePadrao: string): Response =>
  resposta
    .status(200)
    .setHeader('Content-Type', tipo)
    .setHeader('Content-Disposition', `attachment; filename="${nomeSeguro(nome, nomePadrao)}"`)
    .setHeader('X-Content-Type-Options', 'nosniff')
    .setHeader('Cache-Control', 'no-store');

/**
 * Multipart com `arquivo` e até três campos de texto (o mapeamento; na planilha, `aba` e
 * `linhaCabecalho`; na inspeção, só os dois últimos). O multer corta o upload no limite, antes de o processo
 * carregar o excedente (o caso de uso refaz a conferência, que é a fronteira real); o corte sai
 * como `ARQUIVO_ACIMA_DO_LIMITE` (413), o mesmo código do caso de uso.
 */
export const InterceptorDoArquivoDeImportacao = (limiteBytes: number): Type<NestInterceptor> => {
  const Multipart = FileInterceptor('arquivo', {
    limits: { fileSize: limiteBytes, files: 1, fields: 3, fieldSize: 16 * 1024 },
  });

  @Injectable()
  class InterceptorDoArquivo implements NestInterceptor {
    private readonly multipart: NestInterceptor = new Multipart();

    async intercept(contexto: ExecutionContext, proximo: CallHandler): Promise<Observable<unknown>> {
      try {
        return await this.multipart.intercept(contexto, proximo);
      } catch (erro) {
        if (erro instanceof PayloadTooLargeException) {
          throw new ErroDeDominio(
            CODIGOS_DE_ERRO.ARQUIVO_ACIMA_DO_LIMITE,
            `Arquivo acima do limite de ${limiteBytes / (1024 * 1024)} MB.`,
          );
        }

        throw erro;
      }
    }
  }

  return mixin(InterceptorDoArquivo);
};

/** O arquivo do multipart; a configuração da planilha (`aba`, `linhaCabecalho`) vai junto quando veio. */
export const exigirArquivo = (
  arquivo: ArquivoMultipart | undefined,
  planilha?: CamposDePlanilhaInformados | undefined,
): ArquivoEnviado => {
  if (arquivo === undefined) {
    throw new ErroDeDominio(CODIGOS_DE_ERRO.ARQUIVO_INVALIDO, 'Nenhum arquivo foi enviado.', [
      { campo: 'arquivo', codigo: CODIGOS_DE_ERRO.ARQUIVO_INVALIDO },
    ]);
  }

  return {
    buffer: arquivo.buffer,
    nome: arquivo.originalname,
    mimetype: arquivo.mimetype,
    ...(planilha === undefined ? {} : { planilha }),
  };
};
