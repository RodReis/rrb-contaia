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
  /** Dados do erro que o cliente pode mostrar (ex.: empresa fora da carteira). */
  detalhes?: Readonly<Record<string, unknown>>;
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
  [CODIGOS_DE_ERRO.SEM_AUTORIZACAO]: HttpStatus.FORBIDDEN,
  // SPEC-007: o papel permite a ação, mas ainda não há carteira que a alcance.
  [CODIGOS_DE_ERRO.SEM_ALCADA]: HttpStatus.FORBIDDEN,
  [CODIGOS_DE_ERRO.EMPRESA_FORA_DA_CARTEIRA]: HttpStatus.FORBIDDEN,
  [CODIGOS_DE_ERRO.CONTEXTO_DE_ACESSO_INVALIDO]: HttpStatus.FORBIDDEN,
  // Usuário de outro escritório e convite inexistente, usado, invalidado ou
  // vencido respondem como inexistentes: 404 não revela dado alheio nem o motivo.
  [CODIGOS_DE_ERRO.USUARIO_NAO_ENCONTRADO]: HttpStatus.NOT_FOUND,
  [CODIGOS_DE_ERRO.CONVITE_INVALIDO]: HttpStatus.NOT_FOUND,
  // Conflito de estado: a requisição está bem formada e o usuário é que não aceita a operação.
  [CODIGOS_DE_ERRO.EMAIL_JA_UTILIZADO]: HttpStatus.CONFLICT,
  [CODIGOS_DE_ERRO.ULTIMO_ADMIN]: HttpStatus.CONFLICT,
  [CODIGOS_DE_ERRO.USUARIO_ARQUIVADO_USE_NOVO_CONVITE]: HttpStatus.CONFLICT,
  [CODIGOS_DE_ERRO.TRANSICAO_DE_USUARIO_INVALIDA]: HttpStatus.CONFLICT,
  // Keycloak fora do ar é falha de dependência, não entrada inválida: 503 com `correlationId`.
  [CODIGOS_DE_ERRO.IDENTIDADE_INDISPONIVEL]: HttpStatus.SERVICE_UNAVAILABLE,
  // SPEC-003. Endereço inexistente responde como a empresa inexistente.
  // Finalidade duplicada, empresa arquivada e CNPJ imutável são conflito de
  // estado, não entrada malformada: a requisição está bem formada e o recurso
  // é que não aceita a operação agora — daí 409 em vez do 422 padrão.
  [CODIGOS_DE_ERRO.ENDERECO_NAO_ENCONTRADO]: HttpStatus.NOT_FOUND,
  [CODIGOS_DE_ERRO.FINALIDADE_DUPLICADA]: HttpStatus.CONFLICT,
  [CODIGOS_DE_ERRO.EMPRESA_ARQUIVADA]: HttpStatus.CONFLICT,
  [CODIGOS_DE_ERRO.EMPRESA_NAO_ARQUIVADA]: HttpStatus.CONFLICT,
  [CODIGOS_DE_ERRO.CNPJ_IMUTAVEL]: HttpStatus.CONFLICT,
  // SPEC-004. Exigência e versão de outro escritório respondem como
  // inexistentes, pela mesma razão da empresa: 404 não revela dado alheio.
  [CODIGOS_DE_ERRO.EXIGENCIA_NAO_ENCONTRADA]: HttpStatus.NOT_FOUND,
  [CODIGOS_DE_ERRO.VERSAO_NAO_ENCONTRADA]: HttpStatus.NOT_FOUND,
  // Transição recusada e exigência já atendida são conflito de estado: a
  // requisição está bem formada e o documento é que não aceita a operação.
  [CODIGOS_DE_ERRO.TRANSICAO_DOCUMENTAL_INVALIDA]: HttpStatus.CONFLICT,
  [CODIGOS_DE_ERRO.EXIGENCIA_DUPLICADA]: HttpStatus.CONFLICT,
  [CODIGOS_DE_ERRO.EXIGENCIA_NAO_APLICAVEL]: HttpStatus.CONFLICT,
  [CODIGOS_DE_ERRO.VERSAO_NAO_VIGENTE]: HttpStatus.CONFLICT,
  [CODIGOS_DE_ERRO.DOCUMENTO_SEM_ARQUIVO]: HttpStatus.CONFLICT,
  // Arquivo ausente no storage é falha de infraestrutura, não entrada inválida:
  // a tela precisa distinguir "não existe" de "não consegui buscar agora".
  [CODIGOS_DE_ERRO.ARQUIVO_INDISPONIVEL]: HttpStatus.BAD_GATEWAY,
  // SPEC-006. Notificação de outro tenant responde como inexistente — mesma
  // razão de empresa/exigência: 404 não revela dado alheio.
  [CODIGOS_DE_ERRO.NOTIFICACAO_NAO_ENCONTRADA]: HttpStatus.NOT_FOUND,
  // SPEC-008 §6. Papel de outro escritório responde como inexistente (404). Chave
  // exclusiva é concessão proibida (403); chave livre e matriz vazia ficam no 422 padrão.
  [CODIGOS_DE_ERRO.PAPEL_NAO_ENCONTRADO]: HttpStatus.NOT_FOUND,
  [CODIGOS_DE_ERRO.PERMISSAO_EXCLUSIVA]: HttpStatus.FORBIDDEN,
  // Nome duplicado, papel em uso, estado e revisão são conflitos de estado: a
  // requisição está bem formada e o papel é que não aceita a operação agora.
  [CODIGOS_DE_ERRO.PAPEL_NOME_DUPLICADO]: HttpStatus.CONFLICT,
  [CODIGOS_DE_ERRO.PAPEL_EM_USO]: HttpStatus.CONFLICT,
  [CODIGOS_DE_ERRO.PAPEL_ARQUIVADO]: HttpStatus.CONFLICT,
  [CODIGOS_DE_ERRO.TRANSICAO_DE_PAPEL_INVALIDA]: HttpStatus.CONFLICT,
  [CODIGOS_DE_ERRO.REDUCAO_NAO_CONFIRMADA]: HttpStatus.CONFLICT,
  [CODIGOS_DE_ERRO.REVISAO_NAO_CONFIRMADA]: HttpStatus.CONFLICT,
  // SPEC-011 §7. Ticket inválido (forjado, vencido ou já usado) é 403 sem dizer qual; o tamanho
  // vira 413; o cofre fora do ar é falha de dependência (503) com `correlationId`. As demais
  // recusas de arquivo (senha, tipo, CNPJ, validade) são regra de negócio: 422 padrão.
  [CODIGOS_DE_ERRO.CERTIFICADO_TICKET_INVALIDO]: HttpStatus.FORBIDDEN,
  [CODIGOS_DE_ERRO.CERTIFICADO_TAMANHO_EXCEDIDO]: HttpStatus.PAYLOAD_TOO_LARGE,
  [CODIGOS_DE_ERRO.COFRE_INDISPONIVEL]: HttpStatus.SERVICE_UNAVAILABLE,
  // Estado do cofre da empresa que não aceita a operação: a requisição está bem formada.
  [CODIGOS_DE_ERRO.CERTIFICADO_JA_VIGENTE]: HttpStatus.CONFLICT,
  [CODIGOS_DE_ERRO.CERTIFICADO_VIGENTE_INEXISTENTE]: HttpStatus.CONFLICT,
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
    ...(Object.keys(erro.detalhes).length > 0 ? { detalhes: erro.detalhes } : {}),
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
    // E-mail é único entre escritórios (SPEC-007 §3.2): a mensagem não diz de quem é.
    if (constraint.includes('usuario_email_unico')) {
      return new ErroDeConflito(CODIGOS_DE_ERRO.EMAIL_JA_UTILIZADO, 'Este e-mail já está em uso.');
    }

    // Corrida entre dois papéis com o mesmo nome: o caso de uso já checa antes de
    // gravar, e a constraint separa as duas requisições simultâneas (SPEC-008 §3.1).
    if (constraint.includes('papel_personalizado_nome_unico')) {
      return new ErroDeConflito(
        CODIGOS_DE_ERRO.PAPEL_NOME_DUPLICADO,
        'Já existe um papel com este nome neste escritório.',
      );
    }

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

    // Corrida entre dois salvamentos de endereço: o caso de uso já checa a
    // finalidade antes de inserir, então chegar aqui significa que outra
    // operação ocupou a finalidade no intervalo (SPEC-003 §3.4).
    if (constraint.includes('empresa_endereco_finalidade_unica')) {
      return new ErroDeConflito(
        CODIGOS_DE_ERRO.FINALIDADE_DUPLICADA,
        'Já existe um endereço ativo com essa finalidade.',
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
