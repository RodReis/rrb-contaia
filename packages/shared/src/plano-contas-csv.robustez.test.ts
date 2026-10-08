/**
 * Robustez do `lerCsv` (SPEC-013 §3.2, Review Focus 1–2): numeração física das linhas, aspas
 * malformadas e entradas patológicas que já travaram o upload.
 *
 * - Propriedade determinística: textos aleatórios (gerador com semente fixa) comparados com um
 *   modelo de referência feito só com o `csv-parse` cru + contagem de linhas própria, sem a
 *   pré-passada de linhas em branco do `lerCsv`.
 * - Regressões explícitas de numeração e de erros que a pré-passada não pode esconder.
 * - Proteção de tempo: o upload roda `lerCsv` de forma síncrona na API.
 */
import { ErroDeDominio } from '@contaia/domain';
import { CsvError, parse } from 'csv-parse/sync';
import { describe, expect, it } from 'vitest';

import { lerCsv } from './plano-contas-csv.js';
import type { CsvLido } from './plano-contas-csv.js';

const utf8 = (texto: string): Uint8Array => new TextEncoder().encode(texto);

const codigoDoErro = (acao: () => unknown): string | null => {
  try {
    acao();
  } catch (erro) {
    if (erro instanceof ErroDeDominio) {
      return erro.codigo;
    }
    throw erro;
  }
  return null;
};

const resumo = (lido: CsvLido): readonly (readonly [number, readonly string[], number])[] =>
  lido.registros.map((r) => [r.numeroDaLinha, r.celulas, r.camposAMais] as const);

// ---------------------------------------------------------------------------------------------
// Propriedade: lerCsv == csv-parse cru + contagem de linhas independente
// ---------------------------------------------------------------------------------------------

const ALFABETO = ['a', ';', '"', '\r', '\n', '\r\n', ' ', '\t'] as const;
const CABECALHO = 'a;b\n';
const LARGURA = 2;

const gerador = (semente: number) => {
  let estado = semente >>> 0;
  const proximo = (): number => {
    estado = (Math.imul(estado, 1664525) + 1013904223) >>> 0;
    return estado / 2 ** 32;
  };
  return {
    inteiro: (limite: number): number => Math.floor(proximo() * limite),
    texto(): string {
      const tamanho = Math.floor(proximo() * 25);
      return Array.from({ length: tamanho }, () => ALFABETO[Math.floor(proximo() * ALFABETO.length)]).join('');
    },
  };
};

type Esperado = string | readonly (readonly [number, readonly string[], number])[];

const quebras = (celulas: readonly string[]): number =>
  celulas.reduce((total, celula) => total + (celula.match(/\r\n|\r|\n/gu)?.length ?? 0), 0);

/** Modelo de referência: sem pré-passada, `csv-parse` cru com os mesmos delimitadores de registro. */
const referencia = (texto: string): Esperado => {
  const registros: string[][] = [];
  try {
    parse(texto, {
      delimiter: ';',
      quote: '"',
      escape: '"',
      record_delimiter: ['\r\n', '\n', '\r'],
      relax_column_count: true,
      skip_empty_lines: false,
      on_record: (celulas: string[]) => {
        registros.push(celulas);
        return null;
      },
    });
  } catch (erro) {
    if (erro instanceof CsvError) {
      return 'ARQUIVO_INVALIDO';
    }
    throw erro;
  }

  const dados: (readonly [number, readonly string[], number])[] = [];
  let linha = 1;
  let cabecalhoVisto = false;
  for (const celulas of registros) {
    const inicio = linha;
    linha += 1 + quebras(celulas);
    if (celulas.every((celula) => celula.trim() === '')) {
      continue;
    }
    if (!cabecalhoVisto) {
      cabecalhoVisto = true;
      continue;
    }
    const ultimo = celulas.reduce((u, celula, indice) => (celula.trim() === '' ? u : indice), -1);
    dados.push([
      inicio,
      Array.from({ length: LARGURA }, (_, indice) => celulas[indice] ?? ''),
      Math.max(0, ultimo + 1 - LARGURA),
    ]);
  }
  return dados.length === 0 ? 'ARQUIVO_VAZIO' : dados;
};

const obtido = (texto: string): Esperado => {
  try {
    return resumo(lerCsv(utf8(texto)));
  } catch (erro) {
    if (erro instanceof ErroDeDominio) {
      return erro.codigo;
    }
    throw erro;
  }
};

describe('lerCsv — propriedade contra o csv-parse cru (semente fixa)', () => {
  it('2.000 textos aleatórios do alfabeto a ; " CR LF CRLF espaço tab: mesmas linhas, células e erros', () => {
    const aleatorio = gerador(20_261_008);

    for (let caso = 0; caso < 2_000; caso += 1) {
      const texto = CABECALHO + aleatorio.texto();

      expect(obtido(texto), `caso ${caso}: ${JSON.stringify(texto)}`).toEqual(referencia(texto));
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Regressões explícitas
// ---------------------------------------------------------------------------------------------

describe('lerCsv — numeração física e erros que a compactação não pode esconder', () => {
  it('linhas em branco entre registros com aspas de várias linhas', () => {
    const lido = lerCsv(utf8('a;b\n\n1;"x\ny"\n\n\n2;z\n\n'));

    expect(resumo(lido)).toEqual([
      [3, ['1', 'x\ny'], 0],
      [7, ['2', 'z'], 0],
    ]);
  });

  it('CR solto dentro de aspas conta como quebra de linha', () => {
    const lido = lerCsv(utf8('a;b\n1;"x\ry"\n2;z\n'));

    expect(resumo(lido)).toEqual([
      [2, ['1', 'x\ry'], 0],
      [4, ['2', 'z'], 0],
    ]);
  });

  it('aspas escapadas ("") encostadas numa quebra de linha interna', () => {
    const lido = lerCsv(utf8('a;b\r\n1;"q""\r\n"\r\n2;z\r\n'));

    expect(resumo(lido)).toEqual([
      [2, ['1', 'q"\r\n'], 0],
      [4, ['2', 'z'], 0],
    ]);
  });

  it('célula só de aspas escapadas ("""") tem conteúdo e não é registro em branco', () => {
    expect(resumo(lerCsv(utf8('a;b\n""""\n')))).toEqual([[2, ['"', ''], 0]]);
  });

  it('cabeçalho de várias linhas seguido de linhas em branco', () => {
    const lido = lerCsv(utf8('"a\nb";c\n\n\n1;2\n'));

    expect(lido.cabecalho).toEqual(['a\nb', 'c']);
    expect(resumo(lido)).toEqual([[5, ['1', '2'], 0]]);
  });

  it('linhas só de tab ou só de espaço sem quebra (NBSP) são em branco e mantêm a numeração', () => {
    const lido = lerCsv(utf8('a;b\n\t\n \n  \t\n1;2\n'));

    expect(resumo(lido)).toEqual([[5, ['1', '2'], 0]]);
  });

  it('linhas só de aspas vazias ("" e "";"") são em branco e mantêm a numeração', () => {
    const lido = lerCsv(utf8('a;b\n""\n"";""\n" "\n"\n"\n1;2\n'));

    expect(resumo(lido)).toEqual([[7, ['1', '2'], 0]]);
  });

  it('aspas no meio de um campo sem aspas, seguidas de linhas em branco → ARQUIVO_INVALIDO', () => {
    expect(codigoDoErro(() => lerCsv(utf8('a;b\n1;x"y\n\n\n')))).toBe('ARQUIVO_INVALIDO');
  });

  it('aspas sem fechar depois de linhas em branco → ARQUIVO_INVALIDO', () => {
    expect(codigoDoErro(() => lerCsv(utf8('a;b\n\n\n1;"x\n\n')))).toBe('ARQUIVO_INVALIDO');
    expect(codigoDoErro(() => lerCsv(utf8('a;b\n1;2\n\n"')))).toBe('ARQUIVO_INVALIDO');
  });

  it('aspas vazias malformadas ("" "" e espaço antes das aspas) continuam chegando ao csv-parse', () => {
    expect(codigoDoErro(() => lerCsv(utf8('a;b\n"" ""\n1;2\n')))).toBe('ARQUIVO_INVALIDO');
    expect(codigoDoErro(() => lerCsv(utf8('a;b\n ""\n1;2\n')))).toBe('ARQUIVO_INVALIDO');
  });
});

// ---------------------------------------------------------------------------------------------
// Tempo: o upload roda lerCsv na thread da API
// ---------------------------------------------------------------------------------------------

const repetir = (unidade: string, bytes: number): string => unidade.repeat(Math.floor(bytes / unidade.length));
const CINCO_MB = 5 * 1024 * 1024;
/** Folga grande para não ficar instável: medido, cada caso leva dezenas de ms; o defeito levava segundos a minutos. */
const LIMITE_DE_TEMPO_MS = 1_500;

describe('lerCsv — entradas patológicas de 5 MB terminam rápido', () => {
  const casos: readonly (readonly [string, string, string | null])[] = [
    ['linhas ""', '""\n', 'ARQUIVO_VAZIO'],
    ['linhas "";"" com CRLF', '"";""\r\n', 'ARQUIVO_VAZIO'],
    ['linhas "" com espaço', '"" \n', 'ARQUIVO_INVALIDO'],
    ['linhas ""+CRLF', '""\r\n', 'ARQUIVO_VAZIO'],
    ['linhas "";;""', '"";;""\n', 'ARQUIVO_VAZIO'],
    ['muitos campos vazios entre aspas por linha', '"";"";"";"";"";"";"";"";\n', 'ARQUIVO_VAZIO'],
    ['linhas só de quebra', '\n', 'ARQUIVO_VAZIO'],
    ['linhas só de CRLF', '\r\n', 'ARQUIVO_VAZIO'],
    ['linhas só de espaço', ' \n', 'ARQUIVO_VAZIO'],
    ['linhas só de ponto e vírgula', ';\n', 'ARQUIVO_VAZIO'],
    ['linhas de aspas escapadas (têm conteúdo)', '""""\n', 'ARQUIVO_ACIMA_DO_LIMITE'],
    ['linhas com aspas malformadas e conteúdo', '""x\n', 'ARQUIVO_ACIMA_DO_LIMITE'],
    ['linhas curtas com conteúdo', 'x\n', 'ARQUIVO_ACIMA_DO_LIMITE'],
  ];

  it.each(casos)('%s', (_nome, unidade, codigoEsperado) => {
    const texto = CABECALHO + repetir(unidade, CINCO_MB);
    const bytes = utf8(texto);

    const inicio = performance.now();
    const codigo = codigoDoErro(() => lerCsv(bytes));
    const duracao = performance.now() - inicio;

    // O que importa aqui é o tempo; o código só documenta o desfecho esperado de cada família.
    expect(duracao).toBeLessThan(LIMITE_DE_TEMPO_MS);
    if (codigoEsperado === 'ARQUIVO_INVALIDO') {
      expect(codigo).not.toBeNull();
    } else {
      expect(codigo).toBe(codigoEsperado);
    }
  });
});
