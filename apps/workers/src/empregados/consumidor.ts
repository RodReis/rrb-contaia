/**
 * Consumidor BullMQ da validação de empregados (SPEC-014 §6.4). A mecânica é a comum das
 * importações (`importacao/consumidor.ts`); aqui entram a fila de empregados e a validação deles.
 * Segunda fila do mesmo processo de workers, sob o mesmo gate do storage que a do plano de contas.
 */
import { FILA_DE_VALIDACAO_EMPREGADOS, FILA_DE_VALIDACAO_EMPREGADOS_MORTA } from '@contaia/shared';

import { iniciarConsumidor, type Consumidor, type OpcoesDoConsumidor } from '../importacao/consumidor.js';
import { criarProcessadorDeValidacao, type EstrategiaDeValidacao } from '../importacao/processador.js';
import { processarValidacaoDeEmpregados, registrarFalhaDaValidacaoDeEmpregados } from './validacao.js';

export { identificadoresDoJob } from '../importacao/consumidor.js';

export type OpcoesDoConsumidorDeEmpregados = OpcoesDoConsumidor;
export type ConsumidorDeEmpregados = Consumidor;

// As referências são resolvidas na chamada (e não copiadas aqui), então trocar o módulo da validação
// nos testes continua valendo.
const estrategia: EstrategiaDeValidacao = {
  processar: (deps, dados) => processarValidacaoDeEmpregados(deps, dados),
  registrarFalha: (deps, dados, codigo) => registrarFalhaDaValidacaoDeEmpregados(deps, dados, codigo),
};

export const processarJobDeValidacaoDeEmpregados = criarProcessadorDeValidacao(estrategia);

export const iniciarConsumidorDeEmpregados = (opcoes: OpcoesDoConsumidorDeEmpregados): Promise<ConsumidorDeEmpregados> =>
  iniciarConsumidor(
    { fila: FILA_DE_VALIDACAO_EMPREGADOS, filaMorta: FILA_DE_VALIDACAO_EMPREGADOS_MORTA, rotulo: 'da-validacao-de-empregados', estrategia },
    opcoes,
  );
