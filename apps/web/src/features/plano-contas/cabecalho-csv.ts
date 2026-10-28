/**
 * Mapeamento do plano de contas sobre o cabeçalho lido no navegador (SPEC-013 §3.3). A leitura do
 * arquivo é a comum às importações (`importacao/cabecalho-csv`); aqui ficam a sugestão pelos nomes
 * do modelo e as pendências da regra do domínio (`validarMapeamento`, a mesma da API).
 */
import { CAMPOS_DO_CONTRATO, CAMPO_CLASSE_CONTABIL, validarMapeamento, type PendenciaDoMapeamento } from '@contaia/domain';

import { sugerirMapeamento } from '../importacao/cabecalho-csv';
import type { RascunhoDoMapeamento } from '../importacao/dominio';

export { BYTES_LIDOS_NO_NAVEGADOR, lerCabecalhoDoArquivo, registrosDoTexto } from '../importacao/cabecalho-csv';

export const mapeamentoSugerido = (cabecalho: readonly string[]): RascunhoDoMapeamento =>
  sugerirMapeamento([...CAMPOS_DO_CONTRATO, CAMPO_CLASSE_CONTABIL], cabecalho);

/** As mesmas pendências que a API devolveria em `MAPEAMENTO_INCOMPLETO` (regra do domínio). */
export const pendenciasDoRascunho = (
  cabecalho: readonly string[],
  rascunho: RascunhoDoMapeamento,
): readonly PendenciaDoMapeamento[] =>
  validarMapeamento(cabecalho, {
    codigo: rascunho['codigo'] ?? '',
    nome: rascunho['nome'] ?? '',
    tipo: rascunho['tipo'] ?? '',
    natureza: rascunho['natureza'] ?? '',
    conta_pai: rascunho['conta_pai'] ?? '',
    ...(rascunho['classe_contabil'] ? { classe_contabil: rascunho['classe_contabil'] } : {}),
  });
