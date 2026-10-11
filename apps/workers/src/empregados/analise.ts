/**
 * Parte pura da validação de empregados (SPEC-014 §3.2–§3.5): bytes do original + mapeamento da
 * tentativa + empregados vigentes → linhas de staging, ou a recusa do arquivo inteiro com um código
 * estável. Sem banco, sem rede, sem relógio: roda fora de qualquer transação.
 *
 * A API já recusou no envio o arquivo ilegível ou mal mapeado; aqui o arquivo é lido de novo
 * (defensivo: o original e o mapeamento vêm do storage e do banco), e o mesmo defeito encerra a
 * tentativa em REJEITADA — erro de conteúdo, nunca FALHA técnica. Erro de LINHA nunca derruba o
 * arquivo: vira linha REJEITADA no staging, com código, campo e mensagem (sem CPF nem nome).
 */
import {
  CODIGOS_DE_ERRO,
  ErroDeDominio,
  normalizarLinhasDeEmpregados,
  validarLinhasDeEmpregados,
  validarMapeamentoDeEmpregados,
  type EmpregadoVigente,
  type LinhaDeStagingDeEmpregado,
} from '@contaia/domain';
import { lerCsv } from '@contaia/shared';

import { ehCodigoDeArquivoRecusado, type CodigoDeArquivoRecusado } from '../importacao/arquivo-recusado.js';

export type ResultadoDaAnalise =
  | Readonly<{ tipo: 'LINHAS'; linhas: readonly LinhaDeStagingDeEmpregado[] }>
  | Readonly<{ tipo: 'ARQUIVO_RECUSADO'; codigo: CodigoDeArquivoRecusado }>;

/**
 * @param mapeamentoGravado JSON da tentativa (vem do banco: `unknown` até o domínio validar).
 * @param vigentes empregados da empresa por `${cpf11}|${matricula}`, lidos antes da leitura do S3.
 */
export const analisarArquivo = (
  bytes: Uint8Array,
  mapeamentoGravado: unknown,
  vigentes: ReadonlyMap<string, EmpregadoVigente>,
): ResultadoDaAnalise => {
  try {
    const lido = lerCsv(bytes);
    const mapeamento = validarMapeamentoDeEmpregados(mapeamentoGravado, lido.cabecalho);

    if (!mapeamento.ok) {
      return { tipo: 'ARQUIVO_RECUSADO', codigo: CODIGOS_DE_ERRO.MAPEAMENTO_INCOMPLETO };
    }

    const linhas = normalizarLinhasDeEmpregados(lido.cabecalho, lido.registros, mapeamento.mapeamento);

    return { tipo: 'LINHAS', linhas: validarLinhasDeEmpregados(linhas, vigentes) };
  } catch (erro) {
    if (erro instanceof ErroDeDominio && ehCodigoDeArquivoRecusado(erro.codigo)) {
      return { tipo: 'ARQUIVO_RECUSADO', codigo: erro.codigo };
    }

    throw erro;
  }
};
