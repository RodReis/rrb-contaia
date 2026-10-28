/**
 * Parte pura da validação (SPEC-013 §3.2–§3.4, SPEC-015 §3.4–§3.7): o original (bytes do CSV, ou a
 * aba já lida da planilha) + mapeamento da tentativa + contas vigentes → linhas de staging, ou a
 * recusa do arquivo inteiro com um código estável. Sem banco, sem rede, sem relógio: roda fora de
 * qualquer transação.
 *
 * A API já recusou no envio o arquivo ilegível ou mal mapeado; aqui o arquivo é lido de novo
 * (defensivo: o original e o mapeamento vêm do storage e do banco), e o mesmo defeito encerra a
 * tentativa em REJEITADA — erro de conteúdo, nunca FALHA técnica. Na planilha, depois do cabeçalho
 * e do mapeamento por LETRA, o caminho é o mesmo do CSV (`tabelaParaRegistros` → `normalizarLinhas`).
 */
import type { LinhaDeStaging, MapeamentoDaImportacao } from '@contaia/db';
import {
  CAMPOS_DO_CONTRATO,
  CAMPO_CLASSE_CONTABIL,
  CODIGOS_DE_ERRO,
  conferirCabecalho,
  normalizarLinhas,
  tabelaParaRegistros,
  validarLinhasDoPlano,
  validarMapeamento,
  type ContaVigente,
  type LeituraDaAba,
  type LinhaAceita,
  type LinhaBrutaDeEntrada,
  type LinhaRejeitada,
  type Mapeamento,
} from '@contaia/domain';
import { lerCsv } from '@contaia/shared';

import { recusandoDefeitoDoArquivo, type ArquivoRecusado } from '../importacao/arquivo-recusado.js';
import { leituraRegistravel, type LeituraRegistravel } from '../importacao/planilha.js';
import { mensagemDaRejeicao } from './mensagens.js';

export { CODIGOS_DE_ARQUIVO_RECUSADO, type CodigoDeArquivoRecusado } from '../importacao/arquivo-recusado.js';

export type ResultadoDaAnalise =
  /** `leitura`: só na planilha — o que a leitura grava na tentativa. */
  | Readonly<{ tipo: 'LINHAS'; linhas: readonly LinhaDeStaging[]; leitura?: LeituraRegistravel }>
  | ArquivoRecusado;

/** O mapeamento gravado é JSON do banco: só os campos do contrato, texto; o resto vira ausente. */
const paraMapeamento = (gravado: MapeamentoDaImportacao): Mapeamento => {
  const campos = [...CAMPOS_DO_CONTRATO, CAMPO_CLASSE_CONTABIL].map((campo) => {
    const coluna: unknown = gravado[campo];

    return [campo, typeof coluna === 'string' ? coluna : ''] as const;
  });

  return Object.fromEntries(campos) as Mapeamento;
};

const vazioParaNulo = (valor: string | null): string | null => (valor === null || valor === '' ? null : valor);

const linhaValida = (aceita: LinhaAceita, codigosVigentes: ReadonlySet<string>): LinhaDeStaging => ({
  status: 'VALIDA',
  numeroDaLinha: aceita.numeroDaLinha,
  codigo: aceita.codigo,
  nome: aceita.nome,
  tipo: aceita.tipo,
  natureza: aceita.natureza,
  contaPai: aceita.contaPai,
  ...(aceita.classeContabil === null || aceita.classeContabil === undefined
    ? {}
    : { classeContabil: aceita.classeContabil }),
  acao: codigosVigentes.has(aceita.codigo) ? 'ATUALIZAR' : 'INCLUIR',
});

/** Rejeitada guarda os valores crus (normalizados pela leitura) da própria linha, para o relatório. */
const linhaRejeitada = (rejeicao: LinhaRejeitada, bruta: LinhaBrutaDeEntrada): LinhaDeStaging => ({
  status: 'REJEITADA',
  numeroDaLinha: rejeicao.numeroDaLinha,
  codigo: vazioParaNulo(bruta.codigo),
  nome: vazioParaNulo(bruta.nome),
  tipo: vazioParaNulo(bruta.tipo),
  natureza: vazioParaNulo(bruta.natureza),
  contaPai: vazioParaNulo(bruta.contaPai),
  classeContabil: vazioParaNulo(bruta.classeContabil ?? null),
  codigoDeErro: rejeicao.codigoDeErro,
  campo: rejeicao.campo,
  mensagem: mensagemDaRejeicao(rejeicao),
});

const paraStaging = (
  linhas: readonly LinhaBrutaDeEntrada[],
  contasVigentes: readonly ContaVigente[],
): readonly LinhaDeStaging[] => {
  const { aceitas, rejeitadas } = validarLinhasDoPlano({ linhas, contasVigentes });
  const brutaPorNumero = new Map(linhas.map((linha) => [linha.numeroDaLinha, linha]));
  const codigosVigentes = new Set(contasVigentes.map((conta) => conta.codigo));

  return [
    ...aceitas.map((aceita) => linhaValida(aceita, codigosVigentes)),
    ...rejeitadas.map((rejeicao) => linhaRejeitada(rejeicao, brutaPorNumero.get(rejeicao.numeroDaLinha)!)),
  ].sort((a, b) => a.numeroDaLinha - b.numeroDaLinha);
};

export const analisarArquivo = (
  bytes: Uint8Array,
  mapeamentoGravado: MapeamentoDaImportacao,
  contasVigentes: readonly ContaVigente[],
): ResultadoDaAnalise =>
  recusandoDefeitoDoArquivo(() => {
    const lido = lerCsv(bytes);
    const mapeamento = paraMapeamento(mapeamentoGravado);

    if (validarMapeamento(lido.cabecalho, mapeamento).length > 0) {
      return { tipo: 'ARQUIVO_RECUSADO', codigo: CODIGOS_DE_ERRO.MAPEAMENTO_INCOMPLETO } as const;
    }

    const linhas = normalizarLinhas(lido.cabecalho, lido.registros, mapeamento);

    return { tipo: 'LINHAS', linhas: paraStaging(linhas, contasVigentes) } as const;
  });

/** Planilha: a aba lida, a linha de cabeçalho e o mapeamento campo → LETRA gravados na tentativa. */
export const analisarAba = (
  leitura: LeituraDaAba,
  linhaCabecalho: number,
  mapeamentoGravado: MapeamentoDaImportacao,
  contasVigentes: readonly ContaVigente[],
): ResultadoDaAnalise =>
  recusandoDefeitoDoArquivo(() => {
    const cabecalho = conferirCabecalho(leitura, linhaCabecalho);
    if (!cabecalho.ok) {
      return { tipo: 'ARQUIVO_RECUSADO', codigo: cabecalho.codigo } as const;
    }

    const mapeamento = paraMapeamento(mapeamentoGravado);
    if (validarMapeamento(cabecalho.letras, mapeamento).length > 0) {
      return { tipo: 'ARQUIVO_RECUSADO', codigo: CODIGOS_DE_ERRO.MAPEAMENTO_INCOMPLETO } as const;
    }

    const tabela = tabelaParaRegistros(leitura, linhaCabecalho, Object.values(mapeamento).filter((coluna) => coluna !== ''));
    const linhas = normalizarLinhas(tabela.cabecalho, tabela.registros, mapeamento, tabela.rejeicoesEstruturaisPorLinha);

    return { tipo: 'LINHAS', linhas: paraStaging(linhas, contasVigentes), leitura: leituraRegistravel(tabela) } as const;
  });
