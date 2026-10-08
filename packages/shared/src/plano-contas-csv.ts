/**
 * Leitura única do CSV de importação do plano de contas (SPEC-013 §3.2).
 *
 * A API (validação do upload) e o worker (leitura completa) chamam esta mesma função, para a
 * configuração do `csv-parse` não existir em dois lugares. Decodificação, delimitador e limites
 * vêm do domínio (`decodificarCsv`); aqui ficam a tokenização e as regras de forma do arquivo:
 *
 * - até 10.000 linhas de dados (linhas em branco não contam) → `ARQUIVO_ACIMA_DO_LIMITE`;
 * - sem linha de dados → `ARQUIVO_VAZIO`;
 * - cabeçalho com coluna sem nome ou repetida → `CABECALHO_INVALIDO`;
 * - aspas malformadas, ou linha com mais campos preenchidos que o cabeçalho → `ARQUIVO_INVALIDO`
 *   (nunca se deslocam colunas em silêncio); linha mais curta é completada com vazio e a
 *   validação rejeita o campo ausente; campos extras vazios no fim da linha são descartados.
 */
import {
  CODIGOS_DE_ERRO,
  ErroDeDominio,
  LIMITE_DE_LINHAS,
  decodificarCsv,
} from '@contaia/domain';
import type { Delimitador } from '@contaia/domain';
import { CsvError, parse } from 'csv-parse/sync';

export type CsvLido = Readonly<{
  /** Nomes das colunas, aparados. */
  cabecalho: readonly string[];
  /** Linhas de dados, todas com a largura do cabeçalho. Células sem aparar. */
  linhas: readonly (readonly string[])[];
  /** Linha física de cada registro de `linhas` no arquivo (cabeçalho na linha 1). */
  numerosDasLinhas: readonly number[];
  delimitador: Delimitador;
}>;

/** Os três fins de linha, sempre: sem isso o `csv-parse` fixa o primeiro que encontrar. */
const FINS_DE_REGISTRO = ['\r\n', '\n', '\r'];

const ehMatrizDeTexto = (valor: unknown): valor is string[][] =>
  Array.isArray(valor) &&
  valor.every((registro) => Array.isArray(registro) && registro.every((campo) => typeof campo === 'string'));

const arquivoInvalido = (mensagem: string, detalhes: Readonly<Record<string, unknown>>): ErroDeDominio =>
  new ErroDeDominio(CODIGOS_DE_ERRO.ARQUIVO_INVALIDO, mensagem, [], detalhes);

const tokenizar = (texto: string, delimitador: Delimitador): readonly (readonly string[])[] => {
  try {
    const registros: unknown = parse(texto, {
      delimiter: delimitador,
      quote: '"',
      escape: '"',
      record_delimiter: FINS_DE_REGISTRO,
      relax_column_count: true,
      skip_empty_lines: false,
      bom: false,
      trim: false,
    });

    if (!ehMatrizDeTexto(registros)) {
      throw arquivoInvalido('O CSV não pôde ser interpretado.', {});
    }
    return registros;
  } catch (erro) {
    if (erro instanceof CsvError) {
      throw arquivoInvalido('O CSV está malformado (aspas sem fechar ou fora do lugar).', {
        motivo: erro.code,
        linhaAproximada: erro['lines'],
      });
    }
    throw erro;
  }
};

const estaEmBranco = (registro: readonly string[]): boolean => registro.every((campo) => campo.trim() === '');

const quebrasDeLinha = (registro: readonly string[]): number =>
  registro.reduce((total, campo) => total + (campo.match(/\r\n|\r|\n/gu)?.length ?? 0), 0);

const chaveDaColuna = (nome: string): string => nome.normalize('NFC').toLowerCase();

const validarCabecalho = (registro: readonly string[], linha: number): readonly string[] => {
  const nomes = registro.map((campo) => campo.trim());
  const vistos = new Set<string>();

  for (const [indice, nome] of nomes.entries()) {
    const coluna = indice + 1;
    if (nome === '') {
      throw new ErroDeDominio(
        CODIGOS_DE_ERRO.CABECALHO_INVALIDO,
        `A coluna ${coluna} do cabeçalho não tem nome.`,
        [],
        { linha, coluna },
      );
    }
    if (vistos.has(chaveDaColuna(nome))) {
      throw new ErroDeDominio(
        CODIGOS_DE_ERRO.CABECALHO_INVALIDO,
        `O cabeçalho repete a coluna "${nome}".`,
        [],
        { linha, coluna, nome },
      );
    }
    vistos.add(chaveDaColuna(nome));
  }

  return nomes;
};

/** Largura do cabeçalho: completa o que falta com vazio e recusa sobra preenchida. */
const ajustarLargura = (registro: readonly string[], largura: number, linha: number): readonly string[] => {
  if (registro.length > largura && !estaEmBranco(registro.slice(largura))) {
    throw arquivoInvalido(
      `A linha ${linha} tem mais campos que o cabeçalho (${registro.length} contra ${largura}). ` +
        'Confira delimitadores e aspas no texto.',
      { linha, camposNoCabecalho: largura, camposNaLinha: registro.length },
    );
  }

  return Array.from({ length: largura }, (_, indice) => registro[indice] ?? '');
};

const arquivoSemDados = (): ErroDeDominio =>
  new ErroDeDominio(CODIGOS_DE_ERRO.ARQUIVO_VAZIO, 'O arquivo não tem nenhuma linha de dados.');

export const lerCsv = (bytes: Uint8Array): CsvLido => {
  const { texto, delimitador } = decodificarCsv(bytes);

  let cabecalho: readonly string[] | null = null;
  const linhas: (readonly string[])[] = [];
  const numerosDasLinhas: number[] = [];
  let linhaFisica = 1;

  for (const registro of tokenizar(texto, delimitador)) {
    const numero = linhaFisica;
    linhaFisica += 1 + quebrasDeLinha(registro);

    if (estaEmBranco(registro)) {
      continue;
    }
    if (cabecalho === null) {
      cabecalho = validarCabecalho(registro, numero);
      continue;
    }
    if (linhas.length >= LIMITE_DE_LINHAS) {
      throw new ErroDeDominio(
        CODIGOS_DE_ERRO.ARQUIVO_ACIMA_DO_LIMITE,
        `O arquivo passa de ${LIMITE_DE_LINHAS} linhas de dados.`,
        [],
        { limiteDeLinhas: LIMITE_DE_LINHAS },
      );
    }
    linhas.push(ajustarLargura(registro, cabecalho.length, numero));
    numerosDasLinhas.push(numero);
  }

  if (cabecalho === null || linhas.length === 0) {
    throw arquivoSemDados();
  }

  return { cabecalho, linhas, numerosDasLinhas, delimitador };
};
