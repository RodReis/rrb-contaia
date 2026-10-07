/**
 * Filas do Signer (SPEC-012 §3.8–§3.10), compartilhadas por quem enfileira (API) e por quem consome
 * (workers). Aqui só vivem os nomes, as opções de retry e o dedup do job — nada de BullMQ em si,
 * para o pacote continuar leve. Retry, backoff, teto e DLQ são do WORKER chamador: o Signer faz uma
 * tentativa por chamada.
 */
import { createHash } from 'node:crypto';
import type { ComandoDiagnosticar } from '@contaia/shared';

export const FILA_DE_DIAGNOSTICO = 'signer-diagnostico';
/** DLQ: o que esgotou as tentativas ou falhou de forma definitiva, para olhar e agir. */
export const FILA_DE_DIAGNOSTICO_MORTA = 'signer-diagnostico-morta';
export const FILA_DO_MONITOR = 'signer-monitor';
export const NOME_DO_JOB_DE_DIAGNOSTICO = 'diagnosticar';
export const ID_DO_AGENDADOR_DO_MONITOR = 'signer-monitor-a-cada-minuto';

/** O monitor verifica o Signer a cada minuto (SPEC-012 §3.10). */
export const INTERVALO_DO_MONITOR_MS = 60_000;

export const OPCOES_DO_DIAGNOSTICO = {
  /** Teto de tentativas; esgotado, o job vai para a fila morta. */
  attempts: 5,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: { age: 3_600, count: 1_000 },
  /** Falha retida: é a DLQ de leitura e o rastro de diagnóstico. */
  removeOnFail: false,
} as const;

/**
 * Id determinístico do job: o mesmo diagnóstico (empresa, finalidade e correlação) não entra duas
 * vezes na fila, mesmo se o gancho da F11 repetir. Hash, porque o alfabeto de id do BullMQ é estreito.
 */
export const idDoJobDeDiagnostico = (comando: ComandoDiagnosticar): string =>
  `diag-${createHash('sha256')
    .update(`${comando.tenantId}|${comando.empresaId}|${comando.finalidade}|${comando.correlationId}`)
    .digest('hex')
    .slice(0, 40)}`;

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
  add(nome: string, dados: ComandoDiagnosticar, opcoes: Record<string, unknown>): Promise<unknown>;
}>;

export const enfileirarDiagnostico = (fila: FilaQueEnfileira, comando: ComandoDiagnosticar): Promise<unknown> =>
  fila.add(NOME_DO_JOB_DE_DIAGNOSTICO, comando, { ...OPCOES_DO_DIAGNOSTICO, jobId: idDoJobDeDiagnostico(comando) });
