/**
 * Consumidor BullMQ da validação do plano de contas (SPEC-013 §6.4). Nomes de fila, nome do job,
 * id determinístico e opções de retry vêm do `@contaia/shared` (os mesmos da API).
 *
 * A FALHA da tentativa é gravada pelo PROCESSADOR, com o job ainda ativo, na última tentativa
 * (`processador.ts`). O evento `failed` do BullMQ 6 só dispara com o job já finalizado; aqui ele
 * apenas copia o job para a fila morta — os quatro identificadores do comando, o CÓDIGO estável e o
 * total de tentativas, nunca a mensagem de uma exceção nem um campo arbitrário do payload — e, como
 * reforço idempotente, tenta de novo a FALHA (cobre o job que o BullMQ falha sem chamar o
 * processador, como o travado além do limite).
 */
import { FILA_DE_VALIDACAO_PLANO_CONTAS, FILA_DE_VALIDACAO_PLANO_CONTAS_MORTA } from '@contaia/shared';
import type { ConexaoDoRedis } from '@contaia/signer-client';
import { Queue, Worker, type Job } from 'bullmq';

import { deveIrParaDlq } from '../diagnostico.js';
import { criarConexaoRedis } from '../redis.js';
import { processarJobDeValidacao, type DependenciasDoProcessador } from './processador.js';
import { motivoDaFalhaDaValidacao, motivoEncerraEmFalha, registrarFalhaDaValidacao } from './validacao.js';

export type OpcoesDoConsumidorDoPlano = DependenciasDoProcessador &
  Readonly<{
    conexao: ConexaoDoRedis;
    /** Isola as chaves do Redis (testes). Sem ele, vale o padrão do BullMQ. */
    prefixo?: string;
    concorrencia?: number;
  }>;

export type ConsumidorDoPlano = Readonly<{ fechar: () => Promise<void> }>;

const CAMPOS_DO_COMANDO = ['tenantId', 'empresaId', 'tentativaId', 'correlationId'] as const;

const registrar = (evento: string, erro: unknown): void => {
  // Só a classe: a mensagem pode carregar dado do arquivo ou segredo.
  console.error(JSON.stringify({ evento, classe: (erro as Error)?.name ?? 'desconhecida' }));
};

/** Só os identificadores do comando (texto curto) vão para a fila morta; o resto do payload, não. */
export const identificadoresDoJob = (dados: unknown): Record<string, string> => {
  const fonte = typeof dados === 'object' && dados !== null ? (dados as Record<string, unknown>) : {};

  return Object.fromEntries(
    CAMPOS_DO_COMANDO.flatMap((campo) => {
      const valor = fonte[campo];

      return typeof valor === 'string' && valor.length <= 128 ? [[campo, valor]] : [];
    }),
  );
};

export const iniciarConsumidorDoPlanoDeContas = async (opcoes: OpcoesDoConsumidorDoPlano): Promise<ConsumidorDoPlano> => {
  const redis = criarConexaoRedis(opcoes.conexao);
  const comum = { connection: redis, ...(opcoes.prefixo === undefined ? {} : { prefix: opcoes.prefixo }) };
  const deps: DependenciasDoProcessador = {
    pool: opcoes.pool,
    ler: opcoes.ler,
    agora: opcoes.agora,
    ...(opcoes.esperaParaRegistrarFalhaMs === undefined ? {} : { esperaParaRegistrarFalhaMs: opcoes.esperaParaRegistrarFalhaMs }),
  };

  const morta = new Queue(FILA_DE_VALIDACAO_PLANO_CONTAS_MORTA, comum);
  const validacao = new Worker(FILA_DE_VALIDACAO_PLANO_CONTAS, (job, token) => processarJobDeValidacao(deps, job, token), {
    ...comum,
    concurrency: opcoes.concorrencia ?? 2,
  });

  // Cópias para a fila morta em andamento: o `fechar` espera por elas.
  const pendentes = new Set<Promise<void>>();
  const esgotado = async (job: Job, erro: Error): Promise<void> => {
    const motivo = motivoDaFalhaDaValidacao(erro);

    if (motivoEncerraEmFalha(motivo)) {
      // Reforço idempotente: normalmente o processador já gravou e isto não faz nada.
      await registrarFalhaDaValidacao(deps, job.data, motivo).catch((falha: unknown) =>
        registrar('falha-ao-registrar-falha-da-validacao', falha),
      );
    }

    await morta
      .add('morto', { ...identificadoresDoJob(job.data), motivo, tentativas: job.attemptsMade }, { removeOnFail: false })
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
