/**
 * Tradução de erro de domínio para `application/problem+json`
 * (CLAUDE.md, convenções de código; FRONTEND.md §14).
 */
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

import { CODIGOS_DE_ERRO, ErroDeConflito, ErroDeDominio } from '@contaia/domain';
import type { CampoInvalido, CodigoDeErro, CorrelationId } from '@contaia/domain';

export type CorpoDoProblema = Readonly<{
  type: string;
  title: string;
  status: number;
  code: string;
  correlationId: CorrelationId;
  detail?: string;
  campos?: readonly CampoInvalido[];
}>;

const TIPO_BASE = 'https://contaia.local/erros';

/** O `correlationId` acompanha a requisição inteira e é o que o suporte pede. */
export const obterCorrelationId = (requisicao: Request): CorrelationId => {
  const cabecalho = requisicao.header('x-correlation-id');

  return (cabecalho !== undefined && cabecalho.length > 0
    ? cabecalho
    : randomUUID()) as CorrelationId;
};

const statusPorCodigo: Partial<Record<CodigoDeErro, number>> = {
  [CODIGOS_DE_ERRO.CNPJ_JA_UTILIZADO]: HttpStatus.CONFLICT,
  [CODIGOS_DE_ERRO.CONFLITO_DE_VERSAO]: HttpStatus.CONFLICT,
  [CODIGOS_DE_ERRO.TENANT_NAO_ENCONTRADO]: HttpStatus.NOT_FOUND,
  [CODIGOS_DE_ERRO.TENANT_DIVERGENTE]: HttpStatus.FORBIDDEN,
  [CODIGOS_DE_ERRO.CADASTRO_INCOMPLETO]: HttpStatus.FORBIDDEN,
};

export const statusDoErro = (erro: ErroDeDominio): number =>
  statusPorCodigo[erro.codigo] ??
  (erro instanceof ErroDeConflito ? HttpStatus.CONFLICT : HttpStatus.UNPROCESSABLE_ENTITY);

export const montarProblema = (
  erro: ErroDeDominio,
  correlationId: CorrelationId,
): CorpoDoProblema => {
  const status = statusDoErro(erro);

  return {
    type: `${TIPO_BASE}/${erro.codigo.toLowerCase().replace(/_/g, '-')}`,
    title: erro.message,
    status,
    code: erro.codigo,
    correlationId,
    ...(erro.campos.length > 0 ? { campos: erro.campos } : {}),
  };
};

@Catch()
export class FiltroDeProblema implements ExceptionFilter {
  private readonly logger = new Logger(FiltroDeProblema.name);

  catch(excecao: unknown, host: ArgumentsHost): void {
    const contexto = host.switchToHttp();
    const resposta = contexto.getResponse<Response>();
    const requisicao = contexto.getRequest<Request>();
    const correlationId = obterCorrelationId(requisicao);

    if (excecao instanceof ErroDeDominio) {
      const problema = montarProblema(excecao, correlationId);

      resposta.status(problema.status).type('application/problem+json').json(problema);

      return;
    }

    if (excecao instanceof HttpException) {
      const status = excecao.getStatus();

      resposta
        .status(status)
        .type('application/problem+json')
        .json({
          type: `${TIPO_BASE}/http-${status}`,
          title: excecao.message,
          status,
          code: `HTTP_${status}`,
          correlationId,
        } satisfies CorpoDoProblema);

      return;
    }

    // Falha não prevista: o detalhe fica no log do servidor, nunca na resposta.
    this.logger.error(
      `falha não tratada [${correlationId}]`,
      excecao instanceof Error ? excecao.stack : String(excecao),
    );

    resposta
      .status(HttpStatus.INTERNAL_SERVER_ERROR)
      .type('application/problem+json')
      .json({
        type: `${TIPO_BASE}/interno`,
        title: 'Não foi possível concluir a operação.',
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        code: 'ERRO_INTERNO',
        correlationId,
      } satisfies CorpoDoProblema);
  }
}
