/**
 * Consumidor BullMQ da validação do plano de contas (SPEC-013 §6.4). Nomes de fila, nome do job,
 * id determinístico e opções de retry vêm do `@contaia/shared` (os mesmos da API). Esgotado ou
 * irrecuperável, o job:
 *
 *   1. leva a tentativa a FALHA (evento com código estável + notificação ao iniciador), quando há
 *      tentativa identificável ainda em VALIDANDO;
 *   2. é copiado para a fila morta com os dados originais, o CÓDIGO estável e o total de
 *      tentativas — nunca a mensagem de uma exceção.
 */
import { FILA_DE_VALIDACAO_PLANO_CONTAS, FILA_DE_VALIDACAO_PLANO_CONTAS_MORTA } from '@contaia/shared';
import type { ConexaoDoRedis } from '@contaia/signer-client';
import { Queue, Worker, type Job } from 'bullmq';

import { deveIrParaDlq } from '../diagnostico.js';
import { criarConexaoRedis } from '../redis.js';
import {
  motivoDaFalhaDaValidacao,
  motivoEncerraEmFalha,
  processarValidacao,
  registrarFalhaDaValidacao,
  type DependenciasDaValidacao,
} from './validacao.js';

export type OpcoesDoConsumidorDoPlano = DependenciasDaValidacao &
  Readonly<{
    conexao: ConexaoDoRedis;
    /** Isola as chaves do Redis (testes). Sem ele, vale o padrão do BullMQ. */
    prefixo?: string;
    concorrencia?: number;
  }>;

export type ConsumidorDoPlano = Readonly<{ fechar: () => Promise<void> }>;

const registrar = (evento: string, erro: unknown): void => {
  // Só a classe: a mensagem pode carregar dado do arquivo ou segredo.
  console.error(JSON.stringify({ evento, classe: (erro as Error)?.name ?? 'desconhecida' }));
};

const dadosDoJob = (job: Job): Record<string, unknown> =>
  typeof job.data === 'object' && job.data !== null ? { ...(job.data as Record<string, unknown>) } : {};

export const iniciarConsumidorDoPlanoDeContas = async (opcoes: OpcoesDoConsumidorDoPlano): Promise<ConsumidorDoPlano> => {
  const redis = criarConexaoRedis(opcoes.conexao);
  const comum = { connection: redis, ...(opcoes.prefixo === undefined ? {} : { prefix: opcoes.prefixo }) };
  const deps: DependenciasDaValidacao = { pool: opcoes.pool, ler: opcoes.ler, agora: opcoes.agora };

  const morta = new Queue(FILA_DE_VALIDACAO_PLANO_CONTAS_MORTA, comum);
  const validacao = new Worker(FILA_DE_VALIDACAO_PLANO_CONTAS, (job) => processarValidacao(deps, job.data), {
    ...comum,
    concurrency: opcoes.concorrencia ?? 2,
  });

  // Encerramentos em andamento: o `fechar` espera por eles (nada fica pela metade no desligamento).
  const pendentes = new Set<Promise<void>>();
  const esgotado = async (job: Job, erro: Error): Promise<void> => {
    const motivo = motivoDaFalhaDaValidacao(erro);

    if (motivoEncerraEmFalha(motivo)) {
      // O banco antes da fila morta: job na fila morta implica FALHA tentada.
      await registrarFalhaDaValidacao(deps, job.data, motivo).catch((falha: unknown) =>
        registrar('falha-ao-registrar-falha-da-validacao', falha),
      );
    }

    await morta
      .add('morto', { ...dadosDoJob(job), motivo, tentativas: job.attemptsMade }, { removeOnFail: false })
      .catch((falha: unknown) => registrar('falha-ao-enviar-para-fila-morta', falha));
  };

  validacao.on('failed', (job, erro) => {
    if (job === undefined || !deveIrParaDlq(job, erro)) {
      return;
    }

    const pendente = esgotado(job, erro).finally(() => pendentes.delete(pendente));
    pendentes.add(pendente);
  });
  validacao.on('error', (erro) => registrar('erro-no-consumidor-da-validacao-do-plano', erro));

  await validacao.waitUntilReady();

  return {
    fechar: async () => {
      await validacao.close();
      await Promise.all(pendentes);
      await morta.close();
      redis.disconnect();
    },
  };
};
