/**
 * Fila de validação da importação de empregados (SPEC-014 §6.1, §6.4). Fila própria, o mesmo
 * contrato de comando da F13 (tenant, empresa, tentativa e `correlationId`; nunca CPF ou nome).
 */
import type { Provider } from '@nestjs/common';
import {
  FILA_DE_VALIDACAO_EMPREGADOS,
  NOME_DO_JOB_DE_VALIDACAO_EMPREGADOS,
  OPCOES_DE_VALIDACAO_EMPREGADOS,
} from '@contaia/shared';

import {
  criarFilaDeValidacao,
  type DefinicaoDoJob,
  type FilaDeValidacaoGerenciada,
} from '../importacao/fila';

/** Token de injeção da fila (Symbol, como no Signer). */
export const FILA_DE_VALIDACAO_DOS_EMPREGADOS = Symbol('FILA_DE_VALIDACAO_DOS_EMPREGADOS');

export const JOB_DE_VALIDACAO_DOS_EMPREGADOS: DefinicaoDoJob = {
  nome: NOME_DO_JOB_DE_VALIDACAO_EMPREGADOS,
  opcoes: OPCOES_DE_VALIDACAO_EMPREGADOS,
};

export const criarFilaDeValidacaoDosEmpregados = (env: NodeJS.ProcessEnv): FilaDeValidacaoGerenciada =>
  criarFilaDeValidacao(env, {
    nomeDaFila: FILA_DE_VALIDACAO_EMPREGADOS,
    job: JOB_DE_VALIDACAO_DOS_EMPREGADOS,
    rotulo: 'empregados',
    contextoDoLog: 'FilaDosEmpregados',
  });

export const PROVEDORES_DA_FILA_DOS_EMPREGADOS: Provider[] = [
  { provide: FILA_DE_VALIDACAO_DOS_EMPREGADOS, useFactory: () => criarFilaDeValidacaoDosEmpregados(process.env) },
];
