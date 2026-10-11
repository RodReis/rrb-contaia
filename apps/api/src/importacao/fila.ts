/**
 * Fila de validação das importações por arquivo (SPEC-013 §6.1, §6.4; SPEC-014 §6.4).
 *
 * A API só ENFILEIRA: o comando leva tenant, empresa, tentativa e `correlationId` (nunca o
 * conteúdo do arquivo nem dado pessoal) e o worker relê a tentativa do banco. O id do job é
 * determinístico pela tentativa (`idDoJobDeValidacao`, o mesmo do worker): reenviar o mesmo arquivo
 * enquanto a tentativa segue `RECEBIDA` não cria um segundo job. Um job antigo já terminado (falhou
 * antes de a tentativa sair de `RECEBIDA`) é removido para o novo poder entrar — o BullMQ ignora
 * `add` com id de job que ainda existe. Cada domínio (plano de contas, empregados) tem a sua fila.
 *
 * A API sobe sem Redis (modo local sem fila): sem `REDIS_URL`, enfileirar falha e o caso de uso
 * responde `FILA_INDISPONIVEL`, com a tentativa preservada em `RECEBIDA` para nova tentativa.
 */
import { Logger, type OnModuleDestroy } from '@nestjs/common';
import {
  ComandoValidarImportacaoSchema,
  NOME_DO_JOB_DE_VALIDACAO_PLANO_CONTAS,
  OPCOES_DE_VALIDACAO_PLANO_CONTAS,
  idDoJobDeValidacao,
  type ComandoValidarImportacao,
} from '@contaia/shared';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

/** O que o caso de uso precisa da fila. */
export type FilaDeValidacao = Readonly<{
  enfileirar(comando: ComandoValidarImportacao): Promise<void>;
}>;

/** O pedaço do BullMQ que se usa aqui: estrutural, para o teste dublar sem Redis. */
export type FilaDoBullmq = Readonly<{
  add(nome: string, dados: ComandoValidarImportacao, opcoes: Readonly<Record<string, unknown>>): Promise<unknown>;
  getJob(id: string): Promise<JobDoBullmq | undefined | null>;
}>;

export type JobDoBullmq = Readonly<{
  getState(): Promise<string>;
  remove(): Promise<void>;
}>;

/** Nome e opções de retry/backoff do job de validação de um domínio. */
export type DefinicaoDoJob = Readonly<{ nome: string; opcoes: Readonly<Record<string, unknown>> }>;

const JOB_DO_PLANO: DefinicaoDoJob = { nome: NOME_DO_JOB_DE_VALIDACAO_PLANO_CONTAS, opcoes: OPCOES_DE_VALIDACAO_PLANO_CONTAS };

/** Redis fora do ar faz o BullMQ esperar a reconexão para sempre: o envio desiste antes. */
export const PRAZO_DA_FILA_MS = 5_000;

const ESTADOS_TERMINADOS = new Set(['completed', 'failed']);

const comPrazo = async <T>(promessa: Promise<T>, prazoMs: number): Promise<T> => {
  let temporizador: NodeJS.Timeout | undefined;
  const esgotado = new Promise<never>((_resolver, rejeitar) => {
    temporizador = setTimeout(() => rejeitar(new Error('fila sem resposta no prazo')), prazoMs);
  });

  try {
    return await Promise.race([promessa, esgotado]);
  } finally {
    clearTimeout(temporizador);
  }
};

/**
 * Enfileira (ou reenfileira) a validação. O comando é validado pelo contrato do `shared` antes de
 * sair do processo: campo a mais ou id malformado nunca chega ao worker.
 */
export const enfileirarValidacao = async (
  fila: FilaDoBullmq,
  comando: ComandoValidarImportacao,
  prazoMs: number = PRAZO_DA_FILA_MS,
  job: DefinicaoDoJob = JOB_DO_PLANO,
): Promise<void> => {
  const dados = ComandoValidarImportacaoSchema.parse(comando);
  const jobId = idDoJobDeValidacao(dados.tentativaId);

  await comPrazo(
    (async () => {
      const existente = await fila.getJob(jobId);

      if (existente !== undefined && existente !== null) {
        if (!ESTADOS_TERMINADOS.has(await existente.getState())) {
          return; // já está na fila ou em processamento: nada a fazer.
        }

        await existente.remove();
      }

      await fila.add(job.nome, dados, { ...job.opcoes, jobId });
    })(),
    prazoMs,
  );
};

/** A fila do provider: o Nest chama `onModuleDestroy` no shutdown (fecha a fila e a conexão Redis). */
export type FilaDeValidacaoGerenciada = FilaDeValidacao & OnModuleDestroy & Readonly<{ onModuleDestroy(): Promise<void> }>;

export type ConfiguracaoDaFila = Readonly<{
  nomeDaFila: string;
  job: DefinicaoDoJob;
  /** Rótulo do log ("plano de contas", "empregados"). */
  rotulo: string;
  contextoDoLog: string;
}>;

export const criarFilaDeValidacao = (env: NodeJS.ProcessEnv, configuracao: ConfiguracaoDaFila): FilaDeValidacaoGerenciada => {
  const url = env['REDIS_URL']?.trim();
  const logger = new Logger(configuracao.contextoDoLog);

  if (!url) {
    logger.warn(`REDIS_URL ausente: o envio de ${configuracao.rotulo} responde fila indisponível.`);

    return {
      enfileirar: () =>
        Promise.reject(new Error(`REDIS_URL ausente: validação de ${configuracao.rotulo} não enfileirada`)),
      onModuleDestroy: () => Promise.resolve(),
    };
  }

  // Criada no primeiro envio: o BullMQ conecta ao construir, e a API (e o teste de DI) não deve
  // abrir conexão com Redis só por subir.
  let fila: Queue | null = null;
  let conexao: Redis | null = null;
  const obterFila = (): Queue => {
    if (fila === null) {
      // Produtor: não precisa de `maxRetriesPerRequest: null` (isso é do Worker).
      conexao = new Redis(url, { maxRetriesPerRequest: 3 });
      fila = new Queue(configuracao.nomeDaFila, { connection: conexao });
      // Sem ouvinte, o `error` de conexão derrubaria o processo. Só a mensagem: nada de payload.
      fila.on('error', (erro: Error) => logger.warn(`fila de ${configuracao.rotulo} indisponível: ${erro.message}`));
    }

    return fila;
  };

  return {
    enfileirar: (comando) => enfileirarValidacao(obterFila(), comando, PRAZO_DA_FILA_MS, configuracao.job),
    // A conexão foi passada pronta ao BullMQ, que não a fecha no `close()`: fecha-se aqui também.
    onModuleDestroy: async () => {
      await fila?.close();
      await conexao?.quit().catch(() => conexao?.disconnect());
      fila = null;
      conexao = null;
    },
  };
};
