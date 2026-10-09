/**
 * Parte pura da validação (SPEC-013 §3.2–§3.4): bytes do original + mapeamento da tentativa +
 * contas vigentes → linhas de staging, ou a recusa do arquivo inteiro com um código estável. Sem
 * banco, sem rede, sem relógio: roda fora de qualquer transação.
 *
 * A API já recusou no envio o arquivo ilegível ou mal mapeado; aqui o arquivo é lido de novo
 * (defensivo: o original e o mapeamento vêm do storage e do banco), e o mesmo defeito encerra a
 * tentativa em REJEITADA — erro de conteúdo, nunca FALHA técnica.
 */
import type { LinhaDeStaging, MapeamentoDaImportacao } from '@contaia/db';
import {
  CAMPOS_DO_CONTRATO,
  CODIGOS_DE_ERRO,
  ErroDeDominio,
  normalizarLinhas,
  validarLinhasDoPlano,
  validarMapeamento,
  type ContaVigente,
  type LinhaAceita,
  type LinhaBrutaDeEntrada,
  type LinhaRejeitada,
  type Mapeamento,
} from '@contaia/domain';
import { lerCsv } from '@contaia/shared';

import { mensagemDaRejeicao } from './mensagens.js';

/** Defeitos do arquivo inteiro: a tentativa termina REJEITADA, sem staging. */
export const CODIGOS_DE_ARQUIVO_RECUSADO = [
  CODIGOS_DE_ERRO.ARQUIVO_VAZIO,
  CODIGOS_DE_ERRO.ARQUIVO_ACIMA_DO_LIMITE,
  CODIGOS_DE_ERRO.ARQUIVO_INVALIDO,
  CODIGOS_DE_ERRO.CABECALHO_INVALIDO,
  CODIGOS_DE_ERRO.MAPEAMENTO_INCOMPLETO,
] as const;
export type CodigoDeArquivoRecusado = (typeof CODIGOS_DE_ARQUIVO_RECUSADO)[number];

export type ResultadoDaAnalise =
  | Readonly<{ tipo: 'LINHAS'; linhas: readonly LinhaDeStaging[] }>
  | Readonly<{ tipo: 'ARQUIVO_RECUSADO'; codigo: CodigoDeArquivoRecusado }>;

const ehCodigoDeArquivoRecusado = (codigo: string): codigo is CodigoDeArquivoRecusado =>
  (CODIGOS_DE_ARQUIVO_RECUSADO as readonly string[]).includes(codigo);

/** O mapeamento gravado é JSON do banco: só os campos do contrato, texto; o resto vira ausente. */
const paraMapeamento = (gravado: MapeamentoDaImportacao): Mapeamento => {
  const campos = CAMPOS_DO_CONTRATO.map((campo) => {
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
): ResultadoDaAnalise => {
  try {
    const lido = lerCsv(bytes);
    const mapeamento = paraMapeamento(mapeamentoGravado);

    if (validarMapeamento(lido.cabecalho, mapeamento).length > 0) {
      return { tipo: 'ARQUIVO_RECUSADO', codigo: CODIGOS_DE_ERRO.MAPEAMENTO_INCOMPLETO };
    }

    const linhas = normalizarLinhas(lido.cabecalho, lido.registros, mapeamento);

    return { tipo: 'LINHAS', linhas: paraStaging(linhas, contasVigentes) };
  } catch (erro) {
    if (erro instanceof ErroDeDominio && ehCodigoDeArquivoRecusado(erro.codigo)) {
      return { tipo: 'ARQUIVO_RECUSADO', codigo: erro.codigo };
    }

    throw erro;
  }
};
