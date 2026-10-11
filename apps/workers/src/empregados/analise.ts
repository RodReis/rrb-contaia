/**
 * Parte pura da validação de empregados (SPEC-014 §3.2–§3.5, SPEC-015 §3.4–§3.7): o original (bytes
 * do CSV, ou a aba já lida da planilha) + mapeamento da tentativa + empregados vigentes → linhas de
 * staging, ou a recusa do arquivo inteiro com um código estável. Sem banco, sem rede, sem relógio:
 * roda fora de qualquer transação.
 *
 * A API já recusou no envio o arquivo ilegível ou mal mapeado; aqui o arquivo é lido de novo
 * (defensivo: o original e o mapeamento vêm do storage e do banco), e o mesmo defeito encerra a
 * tentativa em REJEITADA — erro de conteúdo, nunca FALHA técnica. Erro de LINHA nunca derruba o
 * arquivo: vira linha REJEITADA no staging, com código, campo e mensagem (sem CPF nem nome).
 */
import {
  CODIGOS_DE_ERRO,
  conferirCabecalho,
  normalizarLinhasDeEmpregados,
  tabelaParaRegistros,
  validarLinhasDeEmpregados,
  validarMapeamentoDeEmpregados,
  type EmpregadoVigente,
  type LeituraDaAba,
  type LinhaDeStagingDeEmpregado,
} from '@contaia/domain';
import { lerCsv } from '@contaia/shared';

import { recusandoDefeitoDoArquivo, type ArquivoRecusado } from '../importacao/arquivo-recusado.js';
import { leituraRegistravel, type LeituraRegistravel } from '../importacao/planilha.js';

export type ResultadoDaAnalise =
  /** `leitura`: só na planilha — o que a leitura grava na tentativa. */
  | Readonly<{ tipo: 'LINHAS'; linhas: readonly LinhaDeStagingDeEmpregado[]; leitura?: LeituraRegistravel }>
  | ArquivoRecusado;

/**
 * @param mapeamentoGravado JSON da tentativa (vem do banco: `unknown` até o domínio validar).
 * @param vigentes empregados da empresa por `${cpf11}|${matricula}`, lidos antes da leitura do S3.
 */
export const analisarArquivo = (
  bytes: Uint8Array,
  mapeamentoGravado: unknown,
  vigentes: ReadonlyMap<string, EmpregadoVigente>,
): ResultadoDaAnalise =>
  recusandoDefeitoDoArquivo(() => {
    const lido = lerCsv(bytes);
    const mapeamento = validarMapeamentoDeEmpregados(mapeamentoGravado, lido.cabecalho);

    if (!mapeamento.ok) {
      return { tipo: 'ARQUIVO_RECUSADO', codigo: CODIGOS_DE_ERRO.MAPEAMENTO_INCOMPLETO } as const;
    }

    const linhas = normalizarLinhasDeEmpregados(lido.cabecalho, lido.registros, mapeamento.mapeamento);

    return { tipo: 'LINHAS', linhas: validarLinhasDeEmpregados(linhas, vigentes) } as const;
  });

/**
 * Planilha: a aba lida, a linha de cabeçalho e o mapeamento campo → LETRA gravados na tentativa. Data
 * nativa nas colunas de data vira a data civil; nas demais vale o valor exibido (como no CSV).
 */
export const analisarAba = (
  leitura: LeituraDaAba,
  linhaCabecalho: number,
  mapeamentoGravado: unknown,
  vigentes: ReadonlyMap<string, EmpregadoVigente>,
): ResultadoDaAnalise =>
  recusandoDefeitoDoArquivo(() => {
    const cabecalho = conferirCabecalho(leitura, linhaCabecalho);
    if (!cabecalho.ok) {
      return { tipo: 'ARQUIVO_RECUSADO', codigo: cabecalho.codigo } as const;
    }

    const validado = validarMapeamentoDeEmpregados(mapeamentoGravado, cabecalho.letras);
    if (!validado.ok) {
      return { tipo: 'ARQUIVO_RECUSADO', codigo: CODIGOS_DE_ERRO.MAPEAMENTO_INCOMPLETO } as const;
    }

    const mapeamento = validado.mapeamento;
    const tabela = tabelaParaRegistros(leitura, linhaCabecalho, Object.values(mapeamento), {
      letrasDeData: [mapeamento.data_nascimento, mapeamento.data_admissao],
    });
    const linhas = normalizarLinhasDeEmpregados(tabela.cabecalho, tabela.registros, mapeamento, tabela.rejeicoesEstruturaisPorLinha);

    return { tipo: 'LINHAS', linhas: validarLinhasDeEmpregados(linhas, vigentes), leitura: leituraRegistravel(tabela) } as const;
  });
