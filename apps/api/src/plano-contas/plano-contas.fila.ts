/**
 * Fila de validação da importação do plano de contas (SPEC-013 §6.1, §6.4).
 *
 * A API só ENFILEIRA: o comando leva tenant, empresa, tentativa e `correlationId` (nunca o
 * conteúdo do arquivo) e o worker relê a tentativa do banco. O id do job é determinístico pela
 * tentativa (`idDoJobDeValidacao`, o mesmo do worker): reenviar o mesmo arquivo enquanto a
 * tentativa segue `RECEBIDA` não cria um segundo job. Um job antigo já terminado (falhou antes de
 * a tentativa sair de `RECEBIDA`) é removido para o novo poder entrar — o BullMQ ignora `add` com
 * id de job que ainda existe.
 *
 * A API sobe sem Redis (modo local sem fila): sem `REDIS_URL`, enfileirar falha e o caso de uso
 * responde `FILA_INDISPONIVEL`, com a tentativa preservada em `RECEBIDA` para nova tentativa.
 */
import { Logger, type OnModuleDestroy, type Provider } from '@nestjs/common';
import {
  ComandoValidarImportacaoSchema,
  FILA_DE_VALIDACAO_PLANO_CONTAS,
  NOME_DO_JOB_DE_VALIDACAO_PLANO_CONTAS,
  OPCOES_DE_VALIDACAO_PLANO_CONTAS,
  idDoJobDeValidacao,
  type ComandoValidarImportacao,
} from '@contaia/shared';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

/** Token de injeção da fila (Symbol, como no Signer). */
export const FILA_DE_VALIDACAO_DO_PLANO = Symbol('FILA_DE_VALIDACAO_DO_PLANO');

/** O que o caso de uso precisa da fila. */
export type FilaDeValidacaoDoPlano = Readonly<{
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

      await fila.add(NOME_DO_JOB_DE_VALIDACAO_PLANO_CONTAS, dados, { ...OPCOES_DE_VALIDACAO_PLANO_CONTAS, jobId });
    })(),
    prazoMs,
  );
};

/** A fila do provider: o Nest chama `onModuleDestroy` no shutdown (fecha a fila e a conexão Redis). */
export type FilaDeValidacaoGerenciada = FilaDeValidacaoDoPlano & OnModuleDestroy & Readonly<{ onModuleDestroy(): Promise<void> }>;

/** Sem `REDIS_URL` (modo local sem fila): toda tentativa de enfileirar falha, sem rede. */
const filaDesligada = (): FilaDeValidacaoGerenciada => ({
  enfileirar: () => Promise.reject(new Error('REDIS_URL ausente: validação do plano de contas não enfileirada')),
  onModuleDestroy: () => Promise.resolve(),
});

export const criarFilaDeValidacaoDoPlano = (env: NodeJS.ProcessEnv): FilaDeValidacaoGerenciada => {
  const url = env['REDIS_URL']?.trim();
  const logger = new Logger('FilaDoPlanoDeContas');

  if (!url) {
    logger.warn('REDIS_URL ausente: o envio de plano de contas responde fila indisponível.');

    return filaDesligada();
  }

  // Criada no primeiro envio: o BullMQ conecta ao construir, e a API (e o teste de DI) não deve
  // abrir conexão com Redis só por subir.
  let fila: Queue | null = null;
  let conexao: Redis | null = null;
  const obterFila = (): Queue => {
    if (fila === null) {
      // Produtor: não precisa de `maxRetriesPerRequest: null` (isso é do Worker).
      conexao = new Redis(url, { maxRetriesPerRequest: 3 });
      fila = new Queue(FILA_DE_VALIDACAO_PLANO_CONTAS, { connection: conexao });
      // Sem ouvinte, o `error` de conexão derrubaria o processo. Só a mensagem: nada de payload.
      fila.on('error', (erro: Error) => logger.warn(`fila do plano de contas indisponível: ${erro.message}`));
    }

    return fila;
  };

  return {
    enfileirar: (comando) => enfileirarValidacao(obterFila(), comando),
    // A conexão foi passada pronta ao BullMQ, que não a fecha no `close()`: fecha-se aqui também.
    onModuleDestroy: async () => {
      await fila?.close();
      await conexao?.quit().catch(() => conexao?.disconnect());
      fila = null;
      conexao = null;
    },
  };
};

export const PROVEDORES_DA_FILA_DO_PLANO: Provider[] = [
  { provide: FILA_DE_VALIDACAO_DO_PLANO, useFactory: () => criarFilaDeValidacaoDoPlano(process.env) },
];
