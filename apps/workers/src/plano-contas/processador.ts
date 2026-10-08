/**
 * Processador do job de validação (SPEC-013 §6.4). Registra a FALHA ENQUANTO o job ainda está
 * ativo, na última tentativa: no BullMQ 6 o evento `failed` só dispara depois que o job foi
 * finalizado no conjunto `failed`, e nada reentrega um job falho. Registrar ali deixava a tentativa
 * presa em VALIDANDO se o processo morresse logo depois ou se o banco ainda estivesse fora.
 *
 *   - não é a última tentativa → relança (o BullMQ repete com backoff);
 *   - última (ou irrecuperável) com tentativa identificável → `registrarFalhaDaValidacao`
 *     (idempotente, só age a partir de VALIDANDO) e relança o erro original, para o BullMQ
 *     finalizar o job;
 *   - a FALHA não pôde ser gravada (banco fora) → o job é ADIADO sem gastar tentativa
 *     (`moveToDelayed` + `DelayedError`) e volta até a FALHA ficar registrada.
 *
 * Queda do processo depois do commit da FALHA: o job segue ativo, trava, é reentregue, e
 * `iniciarValidacao` responde `ESTADO_INVALIDO_PARA_ACAO` → ack sem efeito.
 */
import { DelayedError, UnrecoverableError } from 'bullmq';

import {
  motivoDaFalhaDaValidacao,
  motivoEncerraEmFalha,
  processarValidacao,
  registrarFalhaDaValidacao,
  type DependenciasDaValidacao,
  type ResultadoDaValidacaoDoJob,
} from './validacao.js';

/** Espera antes de tentar de novo gravar a FALHA quando o banco está fora. */
export const ESPERA_PARA_REGISTRAR_FALHA_MS = 15_000;

/** O que o processador usa do `Job` do BullMQ (estrutural, para os testes). */
export type JobDeValidacao = Readonly<{
  data: unknown;
  /** Tentativas que JÁ falharam (0 na primeira execução). */
  attemptsMade: number;
  opts: Readonly<{ attempts?: number }>;
  moveToDelayed: (timestamp: number, token?: string) => Promise<void>;
}>;

export type DependenciasDoProcessador = DependenciasDaValidacao & Readonly<{ esperaParaRegistrarFalhaMs?: number }>;

export const ehUltimaTentativa = (job: JobDeValidacao, erro: Error): boolean =>
  erro instanceof UnrecoverableError || job.attemptsMade + 1 >= (job.opts.attempts ?? 1);

const registrar = (evento: string, erro: unknown): void => {
  // Só a classe: a mensagem pode carregar dado do arquivo ou segredo.
  console.error(JSON.stringify({ evento, classe: (erro as Error)?.name ?? 'desconhecida' }));
};

export const processarJobDeValidacao = async (
  deps: DependenciasDoProcessador,
  job: JobDeValidacao,
  token: string | undefined,
): Promise<ResultadoDaValidacaoDoJob> => {
  try {
    return await processarValidacao(deps, job.data);
  } catch (bruto) {
    const erro = bruto instanceof Error ? bruto : new Error('erro-desconhecido');
    const motivo = motivoDaFalhaDaValidacao(erro);

    if (!ehUltimaTentativa(job, erro) || !motivoEncerraEmFalha(motivo)) {
      throw erro;
    }

    try {
      await registrarFalhaDaValidacao(deps, job.data, motivo);
    } catch (falha) {
      registrar('falha-ao-registrar-falha-da-validacao', falha);
      await job.moveToDelayed(Date.now() + (deps.esperaParaRegistrarFalhaMs ?? ESPERA_PARA_REGISTRAR_FALHA_MS), token);

      throw new DelayedError();
    }

    throw erro;
  }
};
