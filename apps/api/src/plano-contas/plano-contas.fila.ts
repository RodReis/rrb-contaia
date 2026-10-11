/**
 * Fila de validação da importação do plano de contas (SPEC-013 §6.1, §6.4). O mecanismo é o
 * genérico de `importacao/fila.ts`; aqui ficam o token, a fila própria e o provider.
 */
import type { Provider } from '@nestjs/common';
import {
  FILA_DE_VALIDACAO_PLANO_CONTAS,
  NOME_DO_JOB_DE_VALIDACAO_PLANO_CONTAS,
  OPCOES_DE_VALIDACAO_PLANO_CONTAS,
} from '@contaia/shared';

import { criarFilaDeValidacao, type FilaDeValidacao, type FilaDeValidacaoGerenciada } from '../importacao/fila';

export {
  PRAZO_DA_FILA_MS,
  enfileirarValidacao,
  type FilaDeValidacaoGerenciada,
  type FilaDoBullmq,
  type JobDoBullmq,
} from '../importacao/fila';

/** Token de injeção da fila (Symbol, como no Signer). */
export const FILA_DE_VALIDACAO_DO_PLANO = Symbol('FILA_DE_VALIDACAO_DO_PLANO');

export type FilaDeValidacaoDoPlano = FilaDeValidacao;

export const criarFilaDeValidacaoDoPlano = (env: NodeJS.ProcessEnv): FilaDeValidacaoGerenciada =>
  criarFilaDeValidacao(env, {
    nomeDaFila: FILA_DE_VALIDACAO_PLANO_CONTAS,
    job: { nome: NOME_DO_JOB_DE_VALIDACAO_PLANO_CONTAS, opcoes: OPCOES_DE_VALIDACAO_PLANO_CONTAS },
    rotulo: 'plano de contas',
    contextoDoLog: 'FilaDoPlanoDeContas',
  });

export const PROVEDORES_DA_FILA_DO_PLANO: Provider[] = [
  { provide: FILA_DE_VALIDACAO_DO_PLANO, useFactory: () => criarFilaDeValidacaoDoPlano(process.env) },
];
