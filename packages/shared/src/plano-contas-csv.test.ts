/**
 * Leitura única do CSV de importação do plano de contas (SPEC-013 §3.2, Review Focus 1–3).
 * É a mesma função que a API usa para validar o upload e que o worker usa para a leitura completa.
 */
import {
  ErroDeDominio,
  LIMITE_DE_BYTES,
  LIMITE_DE_LINHAS,
  MODELO_CSV,
  normalizarLinhas,
  validarLinhasDoPlano,
  validarMapeamento,
} from '@contaia/domain';
import type { Mapeamento } from '@contaia/domain';
import { describe, expect, it } from 'vitest';

import { lerCsv } from './plano-contas-csv.js';
import type { CsvLido } from './plano-contas-csv.js';

const utf8 = (texto: string): Uint8Array => new TextEncoder().encode(texto);
const latin1 = (texto: string): Uint8Array => Uint8Array.from(texto, (c) => c.charCodeAt(0));
const comBom = (texto: string): Uint8Array => Uint8Array.from([0xef, 0xbb, 0xbf, ...utf8(texto)]);

const celulasDe = (lido: CsvLido): readonly (readonly string[])[] => lido.registros.map((r) => r.celulas);
const numerosDe = (lido: CsvLido): readonly number[] => lido.registros.map((r) => r.numeroDaLinha);

const erroDe = (acao: () => unknown): ErroDeDominio => {
  try {
    acao();
  } catch (erro) {
    if (erro instanceof ErroDeDominio) {
      return erro;
    }
    throw erro;
  }
  throw new Error('esperava ErroDeDominio, mas nada foi lançado');
};

const MAPEAMENTO_PADRAO: Mapeamento = {
  codigo: 'codigo',
  nome: 'nome',
  tipo: 'tipo',
  natureza: 'natureza',
  conta_pai: 'conta_pai',
};

describe('lerCsv — formatos do Excel pt-BR', () => {
  it('lê CSV com ponto e vírgula, CRLF e numera as linhas pela posição no arquivo', () => {
    const lido = lerCsv(utf8('codigo;nome\r\n1;Ativo\r\n2;Passivo\r\n'));

    expect(lido.delimitador).toBe(';');
    expect(lido.cabecalho).toEqual(['codigo', 'nome']);
    expect(celulasDe(lido)).toEqual([
      ['1', 'Ativo'],
      ['2', 'Passivo'],
    ]);
    expect(numerosDe(lido)).toEqual([2, 3]);
  });

  it('remove o BOM UTF-8 do nome da primeira coluna', () => {
    const lido = lerCsv(comBom('codigo;nome\r\n1;Ativo\r\n'));

    expect(lido.cabecalho).toEqual(['codigo', 'nome']);
  });

  it('lê vírgula e tabulação como delimitadores', () => {
    expect(lerCsv(utf8('a,b\n1,2\n')).delimitador).toBe(',');
    expect(celulasDe(lerCsv(utf8('a\tb\n1\t2\n')))).toEqual([['1', '2']]);
  });

  it('decodifica Latin-1 ("Matrícula") quando não é UTF-8', () => {
    const lido = lerCsv(latin1('Matrícula;nome\r\n1;Descrição\r\n'));

    expect(lido.cabecalho).toEqual(['Matrícula', 'nome']);
    expect(celulasDe(lido)).toEqual([['1', 'Descrição']]);
  });

  it('aceita CRLF, LF e CR misturados como fim de linha', () => {
    const lido = lerCsv(utf8('a;b\r\n1;2\n3;4\r5;6\r\n'));

    expect(celulasDe(lido)).toEqual([
      ['1', '2'],
      ['3', '4'],
      ['5', '6'],
    ]);
    expect(numerosDe(lido)).toEqual([2, 3, 4]);
  });

  it('lê o último registro sem quebra de linha final', () => {
    expect(celulasDe(lerCsv(utf8('a;b\r\n1;2')))).toEqual([['1', '2']]);
  });
});

describe('lerCsv — aspas', () => {
  it('campo entre aspas com delimitador, aspas escapadas e quebra de linha internos', () => {
    const lido = lerCsv(utf8('codigo;nome\r\n1;"Caixa; e ""bancos"""\r\n2;"linha um\r\nlinha dois"\r\n3;Fim\r\n'));

    expect(celulasDe(lido)).toEqual([
      ['1', 'Caixa; e "bancos"'],
      ['2', 'linha um\r\nlinha dois'],
      ['3', 'Fim'],
    ]);
  });

  it('a quebra dentro de aspas conta como linha física: o registro seguinte pula uma linha', () => {
    const lido = lerCsv(utf8('codigo;nome\r\n1;"a\r\nb"\r\n2;c\n3;"x\ny\nz"\n4;w\n'));

    expect(numerosDe(lido)).toEqual([2, 4, 5, 8]);
  });

  it('aspas sem fechar → ARQUIVO_INVALIDO, sem interpretar o resto do arquivo como um campo só', () => {
    const erro = erroDe(() => lerCsv(utf8('codigo;nome\r\n1;"Caixa\r\n2;Bancos\r\n')));

    expect(erro.codigo).toBe('ARQUIVO_INVALIDO');
  });

  it('aspas soltas no meio de um campo sem aspas → ARQUIVO_INVALIDO', () => {
    expect(erroDe(() => lerCsv(utf8('codigo;nome\r\n1;Cx"a\r\n'))).codigo).toBe('ARQUIVO_INVALIDO');
    expect(erroDe(() => lerCsv(utf8('codigo;nome\r\n1;"Cx"a\r\n'))).codigo).toBe('ARQUIVO_INVALIDO');
  });
});

describe('lerCsv — linhas em branco e largura das linhas', () => {
  it('pula linhas em branco e linhas só de delimitadores, mantendo a numeração física', () => {
    const lido = lerCsv(utf8('a;b\r\n\r\n1;2\r\n  \r\n;;\r\n3;4\r\n\r\n'));

    expect(celulasDe(lido)).toEqual([
      ['1', '2'],
      ['3', '4'],
    ]);
    expect(numerosDe(lido)).toEqual([3, 6]);
  });

  it('linhas em branco antes do cabeçalho deslocam a numeração (cabeçalho na linha 3)', () => {
    const lido = lerCsv(utf8('\r\n\r\na;b\r\n1;2\r\n'));

    expect(lido.cabecalho).toEqual(['a', 'b']);
    expect(numerosDe(lido)).toEqual([4]);
  });

  it('linha mais curta que o cabeçalho é completada com vazio (a validação rejeita o campo ausente)', () => {
    expect(celulasDe(lerCsv(utf8('a;b;c\r\n1;2\r\n')))).toEqual([['1', '2', '']]);
  });

  it('delimitador sobrando no fim da linha (campo extra vazio) é descartado', () => {
    expect(celulasDe(lerCsv(utf8('a;b\r\n1;2;\r\n3;4;;\r\n')))).toEqual([
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  it('campo extra preenchido não derruba o arquivo: o registro fica com as N primeiras células e é sinalizado', () => {
    const lido = lerCsv(utf8('a;b\r\n1;2\r\n3;Caixa; Bancos\r\n4;5\r\n6;7;8;9\r\n'));

    expect(celulasDe(lido)).toEqual([
      ['1', '2'],
      ['3', 'Caixa'],
      ['4', '5'],
      ['6', '7'],
    ]);
    expect(lido.registros.map((r) => [r.numeroDaLinha, r.camposAMais])).toEqual([
      [2, 0],
      [3, 1],
      [4, 0],
      [5, 2],
    ]);
  });

  it('campos extras só vazios não contam como campos a mais', () => {
    const lido = lerCsv(utf8('a;b\r\n1;2;;\r\n'));

    expect(lido.registros).toEqual([{ numeroDaLinha: 2, celulas: ['1', '2'], camposAMais: 0 }]);
  });
});

describe('lerCsv — cabeçalho', () => {
  it('apara espaços dos nomes das colunas', () => {
    expect(lerCsv(utf8(' codigo ; nome \r\n1;Ativo\r\n')).cabecalho).toEqual(['codigo', 'nome']);
  });

  it('coluna repetida (mesmo ignorando caixa e espaços) → CABECALHO_INVALIDO', () => {
    expect(erroDe(() => lerCsv(utf8('codigo;nome;codigo\r\n1;A;2\r\n'))).codigo).toBe('CABECALHO_INVALIDO');
    expect(erroDe(() => lerCsv(utf8('Codigo;nome; codigo \r\n1;A;2\r\n'))).codigo).toBe('CABECALHO_INVALIDO');
  });

  it('coluna sem nome no meio do cabeçalho → CABECALHO_INVALIDO, mesmo sem dados nela', () => {
    expect(erroDe(() => lerCsv(utf8('codigo;;nome\r\n1;;A\r\n'))).codigo).toBe('CABECALHO_INVALIDO');
    expect(erroDe(() => lerCsv(utf8('codigo;;nome;\r\n1;x;A;\r\n'))).codigo).toBe('CABECALHO_INVALIDO');
  });

  it('colunas sem nome no fim, com células sempre vazias (gerador que põe ; em toda linha), são descartadas', () => {
    const lido = lerCsv(utf8('codigo;nome;;\r\n1;Ativo;;\r\n2;Passivo;\r\n3;Caixa\r\n'));

    expect(lido.cabecalho).toEqual(['codigo', 'nome']);
    expect(celulasDe(lido)).toEqual([
      ['1', 'Ativo'],
      ['2', 'Passivo'],
      ['3', 'Caixa'],
    ]);
    expect(lido.registros.every((r) => r.camposAMais === 0)).toBe(true);
  });

  it('coluna sem nome no fim com dado em alguma linha → CABECALHO_INVALIDO', () => {
    const erro = erroDe(() => lerCsv(utf8('codigo;nome;\r\n1;Ativo;\r\n2;Passivo;obs\r\n')));

    expect(erro.codigo).toBe('CABECALHO_INVALIDO');
    expect(erro.detalhes).toMatchObject({ linha: 3, coluna: 3 });
  });

  it('aspas sem fechar no cabeçalho → ARQUIVO_INVALIDO, não ARQUIVO_VAZIO', () => {
    expect(erroDe(() => lerCsv(utf8('"codigo;nome\r\n1;Ativo\r\n'))).codigo).toBe('ARQUIVO_INVALIDO');
  });
});

describe('lerCsv — vazio e limites', () => {
  it('arquivo vazio, só BOM ou só cabeçalho → ARQUIVO_VAZIO', () => {
    expect(erroDe(() => lerCsv(new Uint8Array())).codigo).toBe('ARQUIVO_VAZIO');
    expect(erroDe(() => lerCsv(comBom(''))).codigo).toBe('ARQUIVO_VAZIO');
    expect(erroDe(() => lerCsv(utf8('codigo;nome\r\n'))).codigo).toBe('ARQUIVO_VAZIO');
    expect(erroDe(() => lerCsv(utf8('codigo;nome\r\n\r\n;\r\n'))).codigo).toBe('ARQUIVO_VAZIO');
  });

  const arquivoComLinhas = (quantidade: number): Uint8Array => {
    const linhas = ['codigo;nome'];
    for (let i = 1; i <= quantidade; i += 1) {
      linhas.push(`${i};Conta ${i}`);
    }
    return utf8(`${linhas.join('\r\n')}\r\n`);
  };

  it(`${LIMITE_DE_LINHAS} linhas de dados passam; a seguinte → ARQUIVO_ACIMA_DO_LIMITE`, () => {
    const noLimite = lerCsv(arquivoComLinhas(LIMITE_DE_LINHAS));

    expect(celulasDe(noLimite)).toHaveLength(LIMITE_DE_LINHAS);
    expect(numerosDe(noLimite).at(-1)).toBe(LIMITE_DE_LINHAS + 1);
    expect(erroDe(() => lerCsv(arquivoComLinhas(LIMITE_DE_LINHAS + 1))).codigo).toBe('ARQUIVO_ACIMA_DO_LIMITE');
  });

  it('linhas em branco não contam para o limite de linhas de dados', () => {
    const base = new TextDecoder().decode(arquivoComLinhas(LIMITE_DE_LINHAS));
    const lido = lerCsv(utf8(`${base}\r\n\r\n\r\n`));

    expect(celulasDe(lido)).toHaveLength(LIMITE_DE_LINHAS);
  });

  it('10 MB + 1 byte → ARQUIVO_ACIMA_DO_LIMITE antes de decodificar; 10 MB exatos são lidos', () => {
    const acima = new Uint8Array(LIMITE_DE_BYTES + 1).fill(0xff);
    expect(erroDe(() => lerCsv(acima)).codigo).toBe('ARQUIVO_ACIMA_DO_LIMITE');

    const cabecalho = utf8('codigo;nome\r\n1;"');
    const fim = utf8('"\r\n');
    const exato = new Uint8Array(LIMITE_DE_BYTES).fill(0x61);
    exato.set(cabecalho, 0);
    exato.set(fim, LIMITE_DE_BYTES - fim.length);

    const lido = lerCsv(exato);
    expect(celulasDe(lido)).toHaveLength(1);
    expect(celulasDe(lido)[0]?.[1]).toHaveLength(LIMITE_DE_BYTES - cabecalho.length - fim.length);
  });

  it('10 MB de quebras de linha em branco: lê só o que tem dados e mantém a numeração física', () => {
    const inicio = utf8('codigo;nome\r\n1;A\r\n');
    const fim = utf8('2;B');
    const corpo = new Uint8Array(LIMITE_DE_BYTES - inicio.length - fim.length).fill(0x0a);
    const arquivo = new Uint8Array(LIMITE_DE_BYTES);
    arquivo.set(inicio, 0);
    arquivo.set(corpo, inicio.length);
    arquivo.set(fim, inicio.length + corpo.length);

    const lido = lerCsv(arquivo);

    expect(celulasDe(lido)).toEqual([
      ['1', 'A'],
      ['2', 'B'],
    ]);
    expect(numerosDe(lido)).toEqual([2, 3 + corpo.length]);
  });

  it('binário (ex.: .xlsx renomeado) → ARQUIVO_INVALIDO', () => {
    const zip = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x08, 0x00, 0x61, 0x3b, 0x62]);

    expect(erroDe(() => lerCsv(zip)).codigo).toBe('ARQUIVO_INVALIDO');
  });
});

describe('lerCsv → normalizarLinhas → validarLinhasDoPlano', () => {
  const ponta = (bytes: Uint8Array) => {
    const lido = lerCsv(bytes);
    expect(validarMapeamento(lido.cabecalho, MAPEAMENTO_PADRAO)).toEqual([]);
    const linhas = normalizarLinhas(lido.cabecalho, lido.registros, MAPEAMENTO_PADRAO);
    return validarLinhasDoPlano({ linhas, contasVigentes: [] });
  };

  it('o modelo oficial do ContaIA passa sem nenhuma rejeição', () => {
    const { aceitas, rejeitadas } = ponta(utf8(MODELO_CSV));

    expect(rejeitadas).toEqual([]);
    expect(aceitas.map((a) => a.numeroDaLinha)).toEqual([2, 3, 4, 5, 6, 7]);
  });

  it('o modelo com BOM, em Latin-1 ou com vírgula também passa', () => {
    expect(ponta(comBom(MODELO_CSV)).rejeitadas).toEqual([]);
    expect(ponta(latin1(MODELO_CSV)).rejeitadas).toEqual([]);
    expect(ponta(utf8(MODELO_CSV.replaceAll(';', ','))).rejeitadas).toEqual([]);
  });

  it('o arquivo do Excel (Latin-1, acentos e caixa variados) é aceito', () => {
    const excel = latin1(
      'codigo;nome;tipo;natureza;conta_pai\r\n' +
        '1;Ativo;Sintética;Devedora;\r\n' +
        '1.1;Matrícula especial;ANALÍTICA;devedora;1\r\n',
    );

    const { aceitas, rejeitadas } = ponta(excel);

    expect(rejeitadas).toEqual([]);
    expect(aceitas.map((a) => a.nome)).toEqual(['Ativo', 'Matrícula especial']);
  });

  it('ponto e vírgula sem aspas no nome rejeita só aquela linha, na linha física certa, e as demais seguem', () => {
    const { aceitas, rejeitadas } = ponta(
      utf8(
        'codigo;nome;tipo;natureza;conta_pai\r\n' +
          '1;Ativo;sintetica;devedora;\r\n' +
          '\r\n' +
          '3;Caixa; Bancos;analitica;devedora;1\r\n' +
          '4;Estoque;analitica;devedora;1\r\n' +
          '3.1;Filha da linha defeituosa;analitica;devedora;3\r\n',
      ),
    );

    expect(aceitas.map((a) => [a.numeroDaLinha, a.codigo])).toEqual([
      [2, '1'],
      [5, '4'],
    ]);
    expect(rejeitadas).toEqual([
      expect.objectContaining({
        numeroDaLinha: 4,
        codigo: '3',
        campo: null,
        codigoDeErro: 'VALOR_FORA_DO_DOMINIO',
        mensagem: expect.stringContaining('mais campos do que o cabeçalho'),
      }),
      expect.objectContaining({ numeroDaLinha: 6, codigoDeErro: 'CONTA_PAI_REJEITADA' }),
    ]);
  });

  it('erros de conteúdo viram rejeições com a linha física certa, mesmo após linhas em branco', () => {
    const { aceitas, rejeitadas } = ponta(
      utf8(
        'codigo;nome;tipo;natureza;conta_pai\r\n' +
          '1;Ativo;sintetica;devedora;\r\n' +
          '\r\n' +
          '2;Sem tipo;;devedora;1\r\n' +
          '   ;Sem código;analitica;devedora;1\r\n' +
          '3;Tipo inválido;xpto;devedora;1\r\n' +
          '5;Pai de si mesmo;analitica;devedora;5\r\n' +
          '01;Zero à esquerda;analitica;devedora;1\r\n' +
          '7;Repetido A;analitica;devedora;1\r\n' +
          '7;Repetido B;analitica;devedora;1\r\n',
      ),
    );

    expect(aceitas.map((a) => a.codigo)).toEqual(['1', '01']);
    expect(rejeitadas.map((r) => [r.numeroDaLinha, r.codigoDeErro])).toEqual([
      [4, 'CAMPO_OBRIGATORIO_AUSENTE'],
      [5, 'CAMPO_OBRIGATORIO_AUSENTE'],
      [6, 'VALOR_FORA_DO_DOMINIO'],
      [7, 'CICLO_HIERARQUICO'],
      [9, 'CODIGO_DUPLICADO_NO_ARQUIVO'],
      [10, 'CODIGO_DUPLICADO_NO_ARQUIVO'],
    ]);
  });
});
