/**
 * Consumidor BullMQ da validação do plano de contas (SPEC-013 §6.4). A mecânica é a comum das
 * importações (`importacao/consumidor.ts`); aqui entram a fila do plano e a validação dele.
 */
import { FILA_DE_VALIDACAO_PLANO_CONTAS, FILA_DE_VALIDACAO_PLANO_CONTAS_MORTA } from '@contaia/shared';

import {
  iniciarConsumidor,
  type Consumidor,
  type OpcoesDoConsumidor,
} from '../importacao/consumidor.js';
import { processarValidacao, registrarFalhaDaValidacao } from './validacao.js';

export { identificadoresDoJob } from '../importacao/consumidor.js';

export type OpcoesDoConsumidorDoPlano = OpcoesDoConsumidor;
export type ConsumidorDoPlano = Consumidor;

export const iniciarConsumidorDoPlanoDeContas = (opcoes: OpcoesDoConsumidorDoPlano): Promise<ConsumidorDoPlano> =>
  iniciarConsumidor(
    {
      fila: FILA_DE_VALIDACAO_PLANO_CONTAS,
      filaMorta: FILA_DE_VALIDACAO_PLANO_CONTAS_MORTA,
      rotulo: 'da-validacao-do-plano',
      estrategia: {
        processar: (deps, dados) => processarValidacao(deps, dados),
        registrarFalha: (deps, dados, codigo) => registrarFalhaDaValidacao(deps, dados, codigo),
      },
    },
    opcoes,
  );
