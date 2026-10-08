/**
 * Relatório CSV completo da importação do plano de contas (SPEC-013 §3.9).
 *
 * Gerado em fluxo: a fonte é um `AsyncIterable` (cursor no banco) e cada linha do relatório sai
 * como um pedaço de texto, sem nunca montar o arquivo inteiro na memória. Pensado para abrir no
 * Excel pt-BR: BOM UTF-8, `;` como separador, CRLF e neutralização de fórmulas.
 */
import type { CodigoDeErroDaLinha } from './validacao.js';

/**
 * Uma linha do relatório: valores como lidos do arquivo e o resultado da validação. Compatível
 * estruturalmente com o tipo homônimo do repositório (`@contaia/db`), sem depender dele.
 */
export type LinhaDoRelatorio = Readonly<{
  numeroDaLinha: number;
  codigo: string | null;
  nome: string | null;
  tipo: string | null;
  natureza: string | null;
  contaPai: string | null;
  status: 'VALIDA' | 'REJEITADA';
  acao: 'INCLUIR' | 'ATUALIZAR' | null;
  codigoDeErro: CodigoDeErroDaLinha | null;
  campo: string | null;
  mensagem: string | null;
}>;

const MARCA_DE_ORDEM = String.fromCharCode(0xfeff);
const SEPARADOR = ';';
const FIM_DE_LINHA = '\r\n';

const COLUNAS = [
  'linha',
  'codigo',
  'nome',
  'tipo',
  'natureza',
  'conta_pai',
  'status',
  'acao',
  'codigo_de_erro',
  'campo',
  'mensagem',
] as const;

/** Iniciais que o Excel e o LibreOffice interpretam como fórmula (OWASP: CSV injection). */
const INICIO_DE_FORMULA = /^[=+\-@\t\r]/u;
const PRECISA_DE_ASPAS = /[";\r\n]/u;

/** Neutraliza fórmula com o prefixo `'` e, só depois, aplica o escape de aspas do CSV. */
const celula = (valor: string | number | null): string => {
  if (valor === null) {
    return '';
  }

  const texto = String(valor);
  const seguro = INICIO_DE_FORMULA.test(texto) ? `'${texto}` : texto;

  return PRECISA_DE_ASPAS.test(seguro) ? `"${seguro.replaceAll('"', '""')}"` : seguro;
};

const registro = (valores: readonly (string | number | null)[]): string =>
  `${valores.map(celula).join(SEPARADOR)}${FIM_DE_LINHA}`;

const paraRegistro = (linha: LinhaDoRelatorio): string =>
  registro([
    linha.numeroDaLinha,
    linha.codigo,
    linha.nome,
    linha.tipo,
    linha.natureza,
    linha.contaPai,
    linha.status,
    linha.acao,
    linha.codigoDeErro,
    linha.campo,
    linha.mensagem,
  ]);

/** Primeiro pedaço: BOM + cabeçalho; depois, um pedaço por linha do relatório. */
export async function* gerarRelatorioCsv(linhas: AsyncIterable<LinhaDoRelatorio>): AsyncGenerator<string, void, undefined> {
  yield `${MARCA_DE_ORDEM}${registro(COLUNAS)}`;

  for await (const linha of linhas) {
    yield paraRegistro(linha);
  }
}
