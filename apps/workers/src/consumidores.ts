/**
 * Consumidores BullMQ do Signer (SPEC-012 §3.8–§3.10).
 *
 *   - `signer-diagnostico`: chama o diagnóstico no Signer; repetição com backoff exponencial e teto
 *     vêm das opções do job (`OPCOES_DO_DIAGNOSTICO`); esgotado ou irrecuperável, o job é copiado
 *     para a fila morta com o CÓDIGO estável (nunca a mensagem de uma exceção);
 *   - `signer-monitor`: um agendador repetível dispara a verificação de saúde a cada minuto; o
 *     BullMQ garante uma execução por tick mesmo com vários processos de worker.
 */
import {
  FILA_DE_DIAGNOSTICO,
  FILA_DE_DIAGNOSTICO_MORTA,
  FILA_DO_MONITOR,
  ID_DO_AGENDADOR_DO_MONITOR,
  INTERVALO_DO_MONITOR_MS,
  type ClienteDoSigner,
  type ConexaoDoRedis,
} from '@contaia/signer-client';
import { Queue, Worker } from 'bullmq';

import { deveIrParaDlq, motivoDaFalha, processarDiagnostico } from './diagnostico.js';
import { criarConexaoRedis } from './redis.js';

export type OpcoesDosConsumidores = Readonly<{
  conexao: ConexaoDoRedis;
  /** Isola as chaves do Redis (testes). Sem ele, vale o padrão do BullMQ. */
  prefixo?: string;
  cliente: Pick<ClienteDoSigner, 'diagnosticar'>;
  /** A verificação de saúde; injetada para o teste não depender do banco. */
  verificar: () => Promise<unknown>;
  intervaloDoMonitorMs?: number;
  concorrenciaDoDiagnostico?: number;
}>;

export type Consumidores = Readonly<{ fechar: () => Promise<void> }>;

const registrar = (evento: string, erro: unknown): void => {
  // Só a classe: a mensagem pode carregar dado externo ou segredo.
  console.error(JSON.stringify({ evento, classe: (erro as Error)?.name ?? 'desconhecida' }));
};

export const iniciarConsumidores = async (opcoes: OpcoesDosConsumidores): Promise<Consumidores> => {
  const redis = criarConexaoRedis(opcoes.conexao);
  const comum = { connection: redis, ...(opcoes.prefixo === undefined ? {} : { prefix: opcoes.prefixo }) };

  const morta = new Queue(FILA_DE_DIAGNOSTICO_MORTA, comum);
  const diagnostico = new Worker(
    FILA_DE_DIAGNOSTICO,
    (job) => processarDiagnostico(job.data, opcoes.cliente),
    { ...comum, concurrency: opcoes.concorrenciaDoDiagnostico ?? 4 },
  );

  diagnostico.on('failed', (job, erro) => {
    if (job === undefined || !deveIrParaDlq(job, erro)) {
      return;
    }

    morta
      .add(
        'morto',
        { ...(job.data as Record<string, unknown>), motivo: motivoDaFalha(erro), tentativas: job.attemptsMade },
        { removeOnFail: false },
      )
      .catch((falha: unknown) => registrar('falha-ao-enviar-para-fila-morta', falha));
  });
  diagnostico.on('error', (erro) => registrar('erro-no-consumidor-de-diagnostico', erro));

  const filaDoMonitor = new Queue(FILA_DO_MONITOR, comum);

  await filaDoMonitor.upsertJobScheduler(
    ID_DO_AGENDADOR_DO_MONITOR,
    { every: opcoes.intervaloDoMonitorMs ?? INTERVALO_DO_MONITOR_MS },
    { name: 'verificar', opts: { removeOnComplete: { count: 10 }, removeOnFail: { count: 100 } } },
  );

  const monitor = new Worker(FILA_DO_MONITOR, () => opcoes.verificar(), comum);

  monitor.on('failed', (_job, erro) => registrar('falha-na-verificacao-de-saude', erro));
  monitor.on('error', (erro) => registrar('erro-no-consumidor-do-monitor', erro));

  return {
    fechar: async () => {
      await Promise.all([diagnostico.close(), monitor.close()]);
      await Promise.all([morta.close(), filaDoMonitor.close()]);
      redis.disconnect();
    },
  };
};
