/**
 * Processador do job de validação do plano de contas (SPEC-013 §6.4). A mecânica (FALHA na última
 * tentativa com o job ainda ativo, adiamento com o banco fora, erro só com o código estável) é a
 * comum das importações: `importacao/processador.ts`. Aqui só entra a validação do plano.
 */
import { criarProcessadorDeValidacao } from '../importacao/processador.js';
import { processarValidacao, registrarFalhaDaValidacao } from './validacao.js';

export {
  ESPERA_PARA_REGISTRAR_FALHA_MS,
  ehUltimaTentativa,
  type DependenciasDoProcessador,
  type JobDeValidacao,
} from '../importacao/processador.js';

// As referências são resolvidas na chamada (e não copiadas aqui), então trocar o módulo da validação
// nos testes continua valendo.
export const processarJobDeValidacao = criarProcessadorDeValidacao({
  processar: (deps, dados) => processarValidacao(deps, dados),
  registrarFalha: (deps, dados, codigo) => registrarFalhaDaValidacao(deps, dados, codigo),
});

