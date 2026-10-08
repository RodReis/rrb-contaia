import type { ComandoValidarImportacao } from '@contaia/shared';

/** Nomes de fila (SPEC-013 §6.4). */
export const FILA_DE_VALIDACAO_PLANO_CONTAS = 'plano-contas-validacao';
/** DLQ: o que esgotou as tentativas ou falhou de forma definitiva, para olhar e agir. */
export const FILA_DE_VALIDACAO_PLANO_CONTAS_MORTA = 'plano-contas-validacao-morta';
export const NOME_DO_JOB_DE_VALIDACAO = 'validar-importacao';

/** Opções de retry/backoff do job (SPEC-013 §6.4). */
export const OPCOES_DE_VALIDACAO_PLANO_CONTAS = {
  attempts: 5,
  backoff: { type: 'exponential' as const, delay: 2_000 },
  removeOnComplete: 100,
  removeOnFail: 50,
} as const;

/** Pacote legado (removido na Task 13): mesmo id do `@contaia/shared` (`validacao-<tentativa>`). */
export const idDoJobDeValidacao = (comando: ComandoValidarImportacao): string => `validacao-${comando.tentativaId}`;

export type ConexaoDoRedis = Readonly<{ host: string; port: number; password?: string; db?: number }>;

/** `REDIS_URL` → opções de conexão do BullMQ, sem depender de `ioredis` aqui. Falha fechada. */
export const conexaoDoRedis = (url: string): ConexaoDoRedis => {
  let analisada: URL;

  try {
    analisada = new URL(url);
  } catch {
    throw new Error('REDIS_URL inválida');
  }
  if (analisada.protocol !== 'redis:' || analisada.hostname === '') {
    throw new Error('REDIS_URL deve ser redis://host:porta');
  }

  const banco = analisada.pathname.replace(/^\//u, '');

  return {
    host: analisada.hostname,
    port: analisada.port === '' ? 6379 : Number(analisada.port),
    ...(analisada.password === '' ? {} : { password: decodeURIComponent(analisada.password) }),
    ...(banco === '' ? {} : { db: Number(banco) }),
  };
};

/** O que a API precisa de uma fila: só `add`. Estrutural para não acoplar ao BullMQ. */
export type FilaQueEnfileira = Readonly<{
  add(nome: string, dados: ComandoValidarImportacao, opcoes: Record<string, unknown>): Promise<unknown>;
}>;

/** Erro tipado do cliente da fila (transporte, conexão, contexto). */
export class ErroDoClienteDaFila extends Error {
  constructor(
    message: string,
    public readonly codigo: string = 'FILA_INDISPONIVEL',
  ) {
    super(message);
    this.name = 'ErroDoClienteDaFila';
  }
}

/** Enfileira validação de importação de plano de contas. */
export const enfileirarValidacaoPlanoContas = (
  fila: FilaQueEnfileira,
  comando: ComandoValidarImportacao,
): Promise<unknown> =>
  fila.add(NOME_DO_JOB_DE_VALIDACAO, comando, {
    ...OPCOES_DE_VALIDACAO_PLANO_CONTAS,
    jobId: idDoJobDeValidacao(comando),
  });