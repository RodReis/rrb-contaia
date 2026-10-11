/**
 * Fila de validação da importação do plano de contas (SPEC-013 §6.1, §6.4). O mecanismo é o
 * genérico de `importacao/fila.ts`; aqui ficam o token, a fila própria e o provider.
 */
import type { Provider } from '@nestjs/common';
import {
  type ComandoValidarImportacao,
  FILA_DE_VALIDACAO_PLANO_CONTAS,
  NOME_DO_JOB_DE_VALIDACAO_PLANO_CONTAS,
  OPCOES_DE_VALIDACAO_PLANO_CONTAS,
} from '@contaia/shared';

import {
  PRAZO_DA_FILA_MS,
  criarFilaDeValidacao,
  enfileirarValidacao as enfileirarValidacaoGenerica,
  type DefinicaoDoJob,
  type FilaDeValidacao,
  type FilaDeValidacaoGerenciada,
  type FilaDoBullmq,
} from '../importacao/fila';

export {
  PRAZO_DA_FILA_MS,
  type FilaDeValidacaoGerenciada,
  type FilaDoBullmq,
  type JobDoBullmq,
} from '../importacao/fila';

const JOB_DO_PLANO: DefinicaoDoJob = {
  nome: NOME_DO_JOB_DE_VALIDACAO_PLANO_CONTAS,
  opcoes: OPCOES_DE_VALIDACAO_PLANO_CONTAS,
};

/** O helper genérico exige o job; no plano de contas ele é sempre o do plano. */
export const enfileirarValidacao = (
  fila: FilaDoBullmq,
  comando: ComandoValidarImportacao,
  prazoMs: number = PRAZO_DA_FILA_MS,
): Promise<void> => enfileirarValidacaoGenerica(fila, comando, prazoMs, JOB_DO_PLANO);

/** Token de injeção da fila (Symbol, como no Signer). */
export const FILA_DE_VALIDACAO_DO_PLANO = Symbol('FILA_DE_VALIDACAO_DO_PLANO');

export type FilaDeValidacaoDoPlano = FilaDeValidacao;

export const criarFilaDeValidacaoDoPlano = (env: NodeJS.ProcessEnv): FilaDeValidacaoGerenciada =>
  criarFilaDeValidacao(env, {
    nomeDaFila: FILA_DE_VALIDACAO_PLANO_CONTAS,
    job: JOB_DO_PLANO,
    rotulo: 'plano de contas',
    contextoDoLog: 'FilaDoPlanoDeContas',
  });

export const PROVEDORES_DA_FILA_DO_PLANO: Provider[] = [
  { provide: FILA_DE_VALIDACAO_DO_PLANO, useFactory: () => criarFilaDeValidacaoDoPlano(process.env) },
];
