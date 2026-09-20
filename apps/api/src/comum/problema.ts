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
  [CODIGOS_DE_ERRO.CNPJ_JA_CADASTRADO_NO_TENANT]: HttpStatus.CONFLICT,
  [CODIGOS_DE_ERRO.CONFLITO_DE_VERSAO]: HttpStatus.CONFLICT,
  [CODIGOS_DE_ERRO.TENANT_NAO_ENCONTRADO]: HttpStatus.NOT_FOUND,
  // Empresa de outro escritório responde igual a empresa inexistente: 404 sem
  // distinguir os dois casos, para não revelar a existência de dado alheio.
  [CODIGOS_DE_ERRO.EMPRESA_NAO_ENCONTRADA]: HttpStatus.NOT_FOUND,
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

/**
 * Violação de constraint do PostgreSQL traduzida para erro de domínio.
 *
 * As checagens de unicidade acontecem antes da escrita, mas não são atômicas:
 * duas requisições simultâneas passam pela checagem e só a constraint separa
 * as duas. Sem esta tradução a perdedora receberia 500 — falha de
 * infraestrutura — no lugar do 409 que a SPEC-001 §6 define como contrato.
 */
const PG_VIOLACAO_DE_UNICIDADE = '23505';
const PG_VIOLACAO_DE_CHECK = '23514';

type ErroDoPostgres = Readonly<{ code?: unknown; constraint?: unknown }>;

const ehErroDoPostgres = (erro: unknown): erro is ErroDoPostgres =>
  typeof erro === 'object' && erro !== null && 'code' in erro;

const traduzirErroDoBanco = (erro: unknown): ErroDeDominio | null => {
  if (!ehErroDoPostgres(erro) || typeof erro.code !== 'string') {
    return null;
  }

  const constraint = typeof erro.constraint === 'string' ? erro.constraint : '';

  if (erro.code === PG_VIOLACAO_DE_UNICIDADE) {
    // A unicidade da empresa cliente é por tenant (SPEC-002 §4.5), não global:
    // a mensagem do escritório diria "outro escritório" e mentiria — aqui a
    // colisão é dentro do próprio escritório, com empresa que o usuário pode ver.
    if (constraint.includes('empresa_cnpj_por_tenant')) {
      return new ErroDeConflito(
        CODIGOS_DE_ERRO.CNPJ_JA_CADASTRADO_NO_TENANT,
        'Esta empresa já está cadastrada neste escritório.',
      );
    }

    if (constraint.includes('cnpj')) {
      return new ErroDeConflito(
        CODIGOS_DE_ERRO.CNPJ_JA_UTILIZADO,
        'Este CNPJ já está em uso por outro escritório.',
      );
    }

    if (constraint.includes('endereco_principal')) {
      return new ErroDeConflito(
        CODIGOS_DE_ERRO.CONFLITO_DE_VERSAO,
        'O endereço principal foi alterado por outra operação. Recarregue e tente de novo.',
      );
    }

    return new ErroDeConflito(
      CODIGOS_DE_ERRO.CONFLITO_DE_VERSAO,
      'Este registro foi alterado por outra operação. Recarregue e tente de novo.',
    );
  }

  if (erro.code === PG_VIOLACAO_DE_CHECK) {
    return new ErroDeDominio(
      CODIGOS_DE_ERRO.CAMPO_OBRIGATORIO,
      'Há campos inválidos nesta etapa.',
    );
  }

  return null;
};

@Catch()
export class FiltroDeProblema implements ExceptionFilter {
  private readonly logger = new Logger(FiltroDeProblema.name);

  catch(excecao: unknown, host: ArgumentsHost): void {
    const contexto = host.switchToHttp();
    const resposta = contexto.getResponse<Response>();
    const requisicao = contexto.getRequest<Request>();
    const correlationId = obterCorrelationId(requisicao);

    const erroDeDominio =
      excecao instanceof ErroDeDominio ? excecao : traduzirErroDoBanco(excecao);

    if (erroDeDominio !== null) {
      const problema = montarProblema(erroDeDominio, correlationId);

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
