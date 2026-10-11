/**
 * Contrato entre o fluxo de importação por CSV (envio, mapeamento, acompanhamento, prévia,
 * resultado, rejeições, histórico) e cada domínio que o usa: plano de contas (SPEC-013) e
 * empregados (SPEC-014). O pipeline é o mesmo nas duas fatias; muda o recurso da API, os campos do
 * mapeamento, as colunas que identificam a linha rejeitada, as permissões e as palavras.
 *
 * Os textos ficam no domínio, inteiros, e não montados por concatenação de substantivos: "conta
 * nova incluída" e "empregado novo incluído" não se derivam um do outro sem erro de concordância.
 */
import type { PreviaDaImportacao, TipoDeArquivo } from '@contaia/shared';
import type { ReactNode } from 'react';

import type { Sessao } from '../usuarios/api';

/**
 * Linha rejeitada no que todo domínio tem em comum. As colunas que a identificam (código da
 * conta; CPF e matrícula do empregado) chegam pelo índice e são lidas por `colunasDaRejeicao`.
 */
export type RejeicaoBase = {
  readonly numeroDaLinha: number;
  readonly campo: string | null;
  readonly codigoDeErro: string;
  readonly mensagem: string | null;
  readonly [coluna: string]: unknown;
};

export type PreviaBase = Omit<PreviaDaImportacao, 'amostraRejeicoes'> &
  Readonly<{ amostraRejeicoes: readonly RejeicaoBase[] }>;

export type Totais = NonNullable<PreviaBase['totais']>;

export type PaginaDeRejeicoesBase = Readonly<{
  pagina: number;
  itensPorPagina: number;
  total: number;
  itens: readonly RejeicaoBase[];
}>;

/** Campo do contrato → coluna do arquivo. Campo ausente = ainda não associado. */
export type RascunhoDoMapeamento = Readonly<Partial<Record<string, string>>>;

export type PendenciaDoRascunho = Readonly<{ campo: string; motivo: string }>;

/** O que a pessoa pode fazer na aba. Empresa arquivada é só consulta (SPEC-003). */
export type PermissoesDaImportacao = Readonly<{
  importar: boolean;
  confirmar: boolean;
  baixar: boolean;
}>;

export type ColunaDaRejeicao = Readonly<{
  titulo: string;
  celula: (rejeicao: RejeicaoBase) => ReactNode;
}>;

export type TextosDaImportacao = Readonly<{
  /** Rótulo acessível do `<input type="file">` do CSV. */
  arquivoCsv: string;
  /** Rótulo acessível do `<input type="file">` das planilhas XLSX/ODS (SPEC-015). */
  arquivoPlanilha: string;
  /** Nome do grupo dos modelos oficiais do domínio (CSV, XLSX e ODS). */
  modelos: string;
  arrasteAqui: string;
  semPermissaoDeImportar: Readonly<{ titulo: string; descricao: string }>;
  /** Descrição do cartão enquanto o worker trabalha. */
  emAndamento: string;
  anuncioAplicando: string;
  tituloAplicando: string;
  descricaoValidando: string;
  tituloDaConfirmacao: (arquivo: string) => string;
  decisao: (totais: Totais) => string;
  descricaoDoCancelamento: string;
  conflito: Readonly<{ titulo: string; descricao: string; cancelar: (arquivo: string) => string }>;
  confirmando: string;
  confirmacaoNegada: string;
  /** "3 contas novas incluídas e 1 atualizada" — sem ponto final. */
  aplicadas: (totais: Totais | null) => string;
  /** Mesmo número, no toast: "3 contas novas e 1 atualizada". */
  aplicadasNoAviso: (totais: Totais | null) => string;
  concluida: string;
  rejeitada: string;
  cancelada: string;
  falhaTecnica: string;
  previstasNaoAplicadas: string;
  rejeicoesNaoEntram: string;
  legendaDoHistorico: string;
  avisoDeCancelamento: string;
}>;

export type DominioDaImportacao = Readonly<{
  /** Aba da empresa e valor de `?aba=` (`plano-contas`, `empregados`). */
  aba: string;
  /** Segmento da rota na API: `/empresas/{id}/{recurso}`; também raiz das chaves de query. */
  recurso: string;
  tipoDeArquivo: TipoDeArquivo;
  lerPrevia: (corpo: unknown) => PreviaBase;
  lerRejeicoes: (corpo: unknown) => PaginaDeRejeicoesBase;
  campos: readonly string[];
  rotuloDoCampo: (campo: string | null) => string;
  ajudaDoCampo: (campo: string) => string;
  mapeamentoSugerido: (cabecalho: readonly string[]) => RascunhoDoMapeamento;
  pendenciasDoRascunho: (cabecalho: readonly string[], rascunho: RascunhoDoMapeamento) => readonly PendenciaDoRascunho[];
  rotuloDoErro: (codigo: string) => string;
  mensagemPadraoDoErro: (codigo: string) => string;
  colunasDaRejeicao: readonly ColunaDaRejeicao[];
  /** Regras que o "Como preparar o CSV" lista, além dos campos. */
  regras: readonly string[];
  nomeDoModelo: string;
  permissoes: (sessao: Sessao | undefined, somenteLeitura: boolean) => PermissoesDaImportacao;
  textos: TextosDaImportacao;
}>;

/** Mapeamento completo para o envio: todo campo do domínio, vazio quando não associado. */
export const mapeamentoCompleto = (
  dominio: DominioDaImportacao,
  rascunho: RascunhoDoMapeamento,
): Readonly<Record<string, string>> =>
  Object.fromEntries(dominio.campos.map((campo) => [campo, rascunho[campo] ?? '']));
