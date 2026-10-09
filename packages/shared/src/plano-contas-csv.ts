/**
 * Leitura única do CSV de importação do plano de contas (SPEC-013 §3.2).
 *
 * A API (validação do upload) e o worker (leitura completa) chamam esta mesma função, para a
 * configuração do `csv-parse` não existir em dois lugares. Decodificação, delimitador e limites
 * vêm do domínio (`decodificarCsv`); aqui ficam a tokenização e as regras de forma do arquivo:
 *
 * - até 10.000 linhas de dados (linhas em branco não contam e são descartadas no próprio
 *   tokenizador, sem acumular) → `ARQUIVO_ACIMA_DO_LIMITE`;
 * - sem linha de dados → `ARQUIVO_VAZIO`;
 * - cabeçalho com coluna sem nome no meio, ou repetida → `CABECALHO_INVALIDO`; colunas sem nome no
 *   fim do cabeçalho são descartadas se suas células forem vazias em todas as linhas, senão
 *   `CABECALHO_INVALIDO`;
 * - aspas malformadas → `ARQUIVO_INVALIDO` (o limite dos registros fica desconhecido);
 * - linha com mais campos preenchidos que o cabeçalho NÃO derruba o arquivo: o registro guarda as
 *   N primeiras células (as demais linhas não se deslocam) e `camposAMais > 0`, que a validação
 *   transforma em rejeição daquela linha; linha mais curta é completada com vazio e a validação
 *   rejeita o campo ausente; campos extras vazios no fim da linha são descartados.
 */
import {
  CODIGOS_DE_ERRO,
  ErroDeDominio,
  LIMITE_DE_LINHAS,
  decodificarCsv,
} from '@contaia/domain';
import type { Delimitador, RegistroDoCsv } from '@contaia/domain';
import { CsvError, parse } from 'csv-parse/sync';

export type CsvLido = Readonly<{
  /** Nomes das colunas, aparados, sem as colunas finais sem nome. */
  cabecalho: readonly string[];
  /** Linhas de dados, com número da linha física (cabeçalho = 1) e células na largura do cabeçalho. */
  registros: readonly RegistroDoCsv[];
  delimitador: Delimitador;
}>;

/** Os três fins de linha, sempre: sem isso o `csv-parse` fixa o primeiro que encontrar. */
const FINS_DE_REGISTRO = ['\r\n', '\n', '\r'];

const estaEmBranco = (celulas: readonly string[]): boolean => celulas.every((celula) => celula.trim() === '');

const ehListaDeTexto = (valor: unknown): valor is string[] =>
  Array.isArray(valor) && valor.every((campo) => typeof campo === 'string');


const chaveDaColuna = (nome: string): string => nome.normalize('NFC').toLowerCase();

const cabecalhoInvalido = (
  mensagem: string,
  detalhes: Readonly<Record<string, unknown>>,
): ErroDeDominio => new ErroDeDominio(CODIGOS_DE_ERRO.CABECALHO_INVALIDO, mensagem, [], detalhes);

type Cabecalho = Readonly<{ nomes: readonly string[]; larguraOriginal: number }>;

/** Nomes aparados; colunas sem nome só no fim são descartadas (a checagem dos dados vem depois). */
const lerCabecalho = (celulas: readonly string[], linha: number): Cabecalho => {
  const todos = celulas.map((celula) => celula.trim());
  let largura = todos.length;
  while (largura > 0 && todos[largura - 1] === '') {
    largura -= 1;
  }

  const nomes = todos.slice(0, largura);
  const vistos = new Set<string>();
  for (const [indice, nome] of nomes.entries()) {
    const coluna = indice + 1;
    if (nome === '') {
      throw cabecalhoInvalido(`A coluna ${coluna} do cabeçalho não tem nome.`, { linha, coluna });
    }
    if (vistos.has(chaveDaColuna(nome))) {
      throw cabecalhoInvalido(`O cabeçalho repete a coluna "${nome}".`, { linha, coluna, nome });
    }
    vistos.add(chaveDaColuna(nome));
  }

  return { nomes, larguraOriginal: todos.length };
};

const posicaoDoUltimoPreenchido = (celulas: readonly string[]): number =>
  celulas.reduce((ultimo, celula, indice) => (celula.trim() === '' ? ultimo : indice), -1);

const registroDeDados = (celulas: readonly string[], cabecalho: Cabecalho, linha: number): RegistroDoCsv => {
  const largura = cabecalho.nomes.length;
  const ultimo = posicaoDoUltimoPreenchido(celulas);

  if (ultimo >= largura) {
    const primeira = celulas.findIndex((celula, indice) => indice >= largura && celula.trim() !== '');
    if (primeira < cabecalho.larguraOriginal) {
      throw cabecalhoInvalido(`A coluna ${primeira + 1} não tem nome no cabeçalho, mas a linha ${linha} a preenche.`, {
        linha,
        coluna: primeira + 1,
      });
    }
  }

  return {
    numeroDaLinha: linha,
    celulas: Array.from({ length: largura }, (_, indice) => celulas[indice] ?? ''),
    camposAMais: Math.max(0, ultimo + 1 - cabecalho.larguraOriginal),
  };
};

const limiteDeLinhasExcedido = (): ErroDeDominio =>
  new ErroDeDominio(
    CODIGOS_DE_ERRO.ARQUIVO_ACIMA_DO_LIMITE,
    `O arquivo passa de ${LIMITE_DE_LINHAS} linhas de dados.`,
    [],
    { limiteDeLinhas: LIMITE_DE_LINHAS },
  );

const ehEspaco = (caractere: string): boolean =>
  caractere === ' ' || caractere === '\t' || (caractere > '\u007f' && caractere.trim() === '');

type Bloco = Readonly<{
  /** Primeira posição depois do bloco, terminador incluído. */
  fim: number;
  /** Há texto que não é espaço: o registro nunca é em branco. */
  temConteudo: boolean;
  /** Quebras de linha dentro de campos entre aspas (CRLF conta uma). */
  quebrasInternas: number;
  /** Aspas bem formadas e fechadas até o fim do registro: o `csv-parse` o leria sem erro. */
  bemFormado: boolean;
}>;

/** Onde o leitor está dentro de um registro, como no `csv-parse` estrito (sem `trim` nem `relax_quotes`). */
const Posicao = { INICIO_DE_CAMPO: 0, SEM_ASPAS: 1, ENTRE_ASPAS: 2, APOS_ASPAS: 3 } as const;
type PosicaoNoRegistro = (typeof Posicao)[keyof typeof Posicao];

/**
 * Um registro lógico: vai até a quebra de linha que não está entre aspas. Acompanha, campo a
 * campo, se as aspas são bem formadas (abrem no início do campo, fecham antes de delimitador ou
 * fim de registro, `""` dentro das aspas é uma aspa) e se há algum conteúdo visível — inclusive
 * `;` e `"` escapado dentro de aspas, que fazem o campo deixar de ser vazio.
 */
const lerBloco = (texto: string, inicio: number, delimitador: Delimitador): Bloco => {
  let onde: PosicaoNoRegistro = Posicao.INICIO_DE_CAMPO;
  let temConteudo = false;
  let bemFormado = true;
  let quebrasInternas = 0;
  let posicao = inicio;

  for (; posicao < texto.length; posicao += 1) {
    const caractere = texto.charAt(posicao);
    const ehQuebra = caractere === '\r' || caractere === '\n';

    if (onde === Posicao.ENTRE_ASPAS) {
      if (caractere === '"') {
        onde = Posicao.APOS_ASPAS;
      } else if (ehQuebra) {
        posicao += caractere === '\r' && texto.charAt(posicao + 1) === '\n' ? 1 : 0;
        quebrasInternas += 1;
      } else if (!ehEspaco(caractere)) {
        temConteudo = true;
      }
    } else if (ehQuebra) {
      break;
    } else if (caractere === delimitador) {
      onde = Posicao.INICIO_DE_CAMPO;
    } else if (onde === Posicao.APOS_ASPAS) {
      // `""` é uma aspa literal; qualquer outra coisa depois de fechar as aspas é malformada.
      onde = caractere === '"' ? Posicao.ENTRE_ASPAS : Posicao.SEM_ASPAS;
      temConteudo = temConteudo || caractere === '"' || !ehEspaco(caractere);
      bemFormado = bemFormado && caractere === '"';
    } else if (caractere === '"') {
      bemFormado = bemFormado && onde === Posicao.INICIO_DE_CAMPO;
      onde = Posicao.ENTRE_ASPAS;
    } else {
      onde = Posicao.SEM_ASPAS;
      temConteudo = temConteudo || !ehEspaco(caractere);
    }
  }

  const terminador = texto.startsWith('\r\n', posicao) ? 2 : Number(posicao < texto.length);
  return {
    fim: posicao + terminador,
    temConteudo,
    quebrasInternas,
    bemFormado: bemFormado && onde !== Posicao.ENTRE_ASPAS,
  };
};

type TextoCompactado = Readonly<{
  texto: string;
  /** Linha física em que começa cada registro do texto compactado, na ordem. */
  iniciosDosRegistros: readonly number[];
}>;

/**
 * Tira do texto os registros em branco e bem formados (vazios, só espaços, só delimitadores, só
 * aspas vazias como `""` ou `"";""`), que o `csv-parse` lê em tempo mais que linear (10 MB de
 * `""` levavam mais de um minuto) e que seriam descartados de qualquer jeito. Registros malformados
 * ou com aspas sem fechar NÃO saem: chegam ao `csv-parse`, que recusa o arquivo. Guarda a linha
 * física em que começa cada registro que sobrou, porque o `info.lines` do `csv-parse` não é
 * confiável com CRLF entre aspas. Antecipa o limite: mais de cabeçalho + 10.000 registros mantidos
 * (todos têm conteúdo ou são malformados) → recusa antes do `csv-parse`.
 */
const compactarLinhasEmBranco = (texto: string, delimitador: Delimitador): TextoCompactado => {
  const trechos: string[] = [];
  const inicios: number[] = [];
  let trechoDesde = -1;
  let linha = 1;
  let mantidos = 0;
  let posicao = 0;

  while (posicao < texto.length) {
    const bloco = lerBloco(texto, posicao, delimitador);

    if (bloco.bemFormado && !bloco.temConteudo) {
      if (trechoDesde >= 0) {
        trechos.push(texto.slice(trechoDesde, posicao));
        trechoDesde = -1;
      }
    } else {
      trechoDesde = trechoDesde >= 0 ? trechoDesde : posicao;
      inicios.push(linha);
      mantidos += 1;
      if (mantidos > LIMITE_DE_LINHAS + 1) {
        throw limiteDeLinhasExcedido();
      }
    }

    linha += 1 + bloco.quebrasInternas;
    posicao = bloco.fim;
  }

  if (trechoDesde >= 0) {
    trechos.push(texto.slice(trechoDesde));
  }
  return { texto: trechos.join(''), iniciosDosRegistros: inicios };
};

/**
 * Tokeniza e já descarta, durante a leitura (`on_record`), o cabeçalho e os registros em branco,
 * sem acumular arrays à toa. O número da linha física vem de `compactarLinhasEmBranco`.
 */
const tokenizar = (
  textoBruto: string,
  delimitador: Delimitador,
): Readonly<{ cabecalho: Cabecalho | null; registros: readonly RegistroDoCsv[] }> => {
  const { texto, iniciosDosRegistros } = compactarLinhasEmBranco(textoBruto, delimitador);
  let cabecalho: Cabecalho | null = null;
  const registros: RegistroDoCsv[] = [];
  let lidos = 0;

  const aoLerRegistro = (celulas: unknown): null => {
    const numero = iniciosDosRegistros[lidos];
    lidos += 1;
    if (!ehListaDeTexto(celulas) || numero === undefined) {
      throw new ErroDeDominio(CODIGOS_DE_ERRO.ARQUIVO_INVALIDO, 'O CSV não pôde ser interpretado.');
    }

    if (estaEmBranco(celulas)) {
      return null;
    }
    if (cabecalho === null) {
      cabecalho = lerCabecalho(celulas, numero);
      return null;
    }
    if (registros.length >= LIMITE_DE_LINHAS) {
      throw limiteDeLinhasExcedido();
    }
    registros.push(registroDeDados(celulas, cabecalho, numero));
    return null;
  };

  try {
    parse(texto, {
      delimiter: delimitador,
      quote: '"',
      escape: '"',
      record_delimiter: FINS_DE_REGISTRO,
      relax_column_count: true,
      skip_empty_lines: false,
      bom: false,
      trim: false,
      on_record: aoLerRegistro,
    });
  } catch (erro) {
    if (erro instanceof CsvError) {
      throw new ErroDeDominio(
        CODIGOS_DE_ERRO.ARQUIVO_INVALIDO,
        'O CSV está malformado (aspas sem fechar ou fora do lugar).',
        [],
        { motivo: erro.code },
      );
    }
    throw erro;
  }

  return { cabecalho, registros };
};

export const lerCsv = (bytes: Uint8Array): CsvLido => {
  const { texto, delimitador } = decodificarCsv(bytes);
  const { cabecalho, registros } = tokenizar(texto, delimitador);

  if (cabecalho === null || registros.length === 0) {
    throw new ErroDeDominio(CODIGOS_DE_ERRO.ARQUIVO_VAZIO, 'O arquivo não tem nenhuma linha de dados.');
  }

  return { cabecalho: cabecalho.nomes, registros, delimitador };
};
