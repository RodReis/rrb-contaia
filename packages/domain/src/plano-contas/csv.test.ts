/**
 * Decodificação, mapeamento e normalização do CSV do plano de contas (SPEC-013 §3.2–3.3).
 */
import { describe, expect, it } from 'vitest';

import { ErroDeDominio } from '../erros.js';
import {
  LIMITE_DE_BYTES,
  LIMITE_DE_LINHAS,
  MODELO_CSV,
  decodificarCsv,
  normalizarLinhas,
  validarMapeamento,
} from './csv.js';
import type { Mapeamento, RegistroDoCsv } from './csv.js';
import { validarLinhasDoPlano } from './validacao.js';

const utf8 = (texto: string): Uint8Array => new TextEncoder().encode(texto);

/** Latin-1: cada code point até U+00FF vira um byte. */
const latin1 = (texto: string): Uint8Array => Uint8Array.from(texto, (c) => c.charCodeAt(0));

const codigoDoErro = (acao: () => unknown): string | undefined => {
  try {
    acao();
  } catch (erro) {
    return erro instanceof ErroDeDominio ? erro.codigo : `NAO_DOMINIO:${String(erro)}`;
  }
  return undefined;
};

const MAPEAMENTO_PADRAO: Mapeamento = {
  codigo: 'codigo',
  nome: 'nome',
  tipo: 'tipo',
  natureza: 'natureza',
  conta_pai: 'conta_pai',
};
const CABECALHO_PADRAO = ['codigo', 'nome', 'tipo', 'natureza', 'conta_pai'];

describe('decodificarCsv', () => {
  it('remove o BOM UTF-8', () => {
    const { texto } = decodificarCsv(Uint8Array.from([0xef, 0xbb, 0xbf, ...utf8('a;b\r\n1;2\r\n')]));

    expect(texto.startsWith('a;b')).toBe(true);
  });

  it('detecta ponto e vírgula', () => {
    expect(decodificarCsv(utf8('a;b;c\r\n1;2;3\r\n')).delimitador).toBe(';');
  });

  it('detecta vírgula e tabulação', () => {
    expect(decodificarCsv(utf8('a,b,c\n1,2,3\n')).delimitador).toBe(',');
    expect(decodificarCsv(utf8('a\tb\tc\n1\t2\t3\n')).delimitador).toBe('\t');
  });

  it('desempata em ponto e vírgula e ignora delimitador dentro de aspas no cabeçalho', () => {
    expect(decodificarCsv(utf8('a;b,c\n1;2,3\n')).delimitador).toBe(';');
    expect(decodificarCsv(utf8('"a,b,c,d";e\n1;2\n')).delimitador).toBe(';');
  });

  it('decodifica Latin-1 quando o arquivo não é UTF-8 válido', () => {
    const { texto } = decodificarCsv(latin1('codigo;nome\r\n1;Matrícula\r\n'));

    expect(texto).toContain('Matrícula');
  });

  it('decodifica UTF-8 com acentos sem confundir com Latin-1', () => {
    expect(decodificarCsv(utf8('codigo;nome\r\n1;Matrícula\r\n')).texto).toContain('Matrícula');
  });

  it('decodifica UTF-16 LE com BOM (Excel "Texto Unicode")', () => {
    const texto = 'a\tb\r\n1\t2\r\n';
    const bytes = new Uint8Array(2 + texto.length * 2);
    bytes.set([0xff, 0xfe]);
    for (let i = 0; i < texto.length; i += 1) {
      bytes[2 + i * 2] = texto.charCodeAt(i);
    }

    const resultado = decodificarCsv(bytes);

    expect(resultado.texto).toBe(texto);
    expect(resultado.delimitador).toBe('\t');
  });

  it('arquivo vazio, só BOM ou só espaços e quebras → ARQUIVO_VAZIO', () => {
    expect(codigoDoErro(() => decodificarCsv(new Uint8Array()))).toBe('ARQUIVO_VAZIO');
    expect(codigoDoErro(() => decodificarCsv(Uint8Array.from([0xef, 0xbb, 0xbf])))).toBe('ARQUIVO_VAZIO');
    expect(codigoDoErro(() => decodificarCsv(utf8('  \r\n \r\n')))).toBe('ARQUIVO_VAZIO');
  });

  it('só cabeçalho (com ou sem quebra final) → ARQUIVO_VAZIO', () => {
    expect(codigoDoErro(() => decodificarCsv(utf8('codigo;nome;tipo\r\n')))).toBe('ARQUIVO_VAZIO');
    expect(codigoDoErro(() => decodificarCsv(utf8('codigo;nome;tipo')))).toBe('ARQUIVO_VAZIO');
    expect(codigoDoErro(() => decodificarCsv(utf8('codigo;nome;tipo\r\n\r\n  \r\n')))).toBe('ARQUIVO_VAZIO');
  });

  it('cabeçalho com campo entre aspas e quebra de linha interna não é confundido com dados', () => {
    expect(codigoDoErro(() => decodificarCsv(utf8('"a\nb";c\n')))).toBe('ARQUIVO_VAZIO');
    expect(codigoDoErro(() => decodificarCsv(utf8('"a\nb";c\n1;2\n')))).toBeUndefined();
  });

  it('aspas sem fechar no cabeçalho → ARQUIVO_INVALIDO (e não ARQUIVO_VAZIO)', () => {
    expect(codigoDoErro(() => decodificarCsv(utf8('"codigo;nome\r\n1;Ativo\r\n')))).toBe('ARQUIVO_INVALIDO');
    expect(codigoDoErro(() => decodificarCsv(utf8('codigo;"nome')))).toBe('ARQUIVO_INVALIDO');
  });

  it('exatamente 10 MB passa; 10 MB + 1 byte → ARQUIVO_ACIMA_DO_LIMITE antes de decodificar', () => {
    const noLimite = new Uint8Array(LIMITE_DE_BYTES).fill(0x61);
    noLimite.set(utf8('a;b\r\n'), 0);
    const acima = new Uint8Array(LIMITE_DE_BYTES + 1).fill(0xff); // inválido em UTF-8: nem chega a ser lido

    expect(codigoDoErro(() => decodificarCsv(noLimite))).toBeUndefined();
    expect(codigoDoErro(() => decodificarCsv(acima))).toBe('ARQUIVO_ACIMA_DO_LIMITE');
  });

  it('expõe os limites da SPEC', () => {
    expect(LIMITE_DE_LINHAS).toBe(10_000);
    expect(LIMITE_DE_BYTES).toBe(10 * 1024 * 1024);
  });
});

describe('validarMapeamento', () => {
  it('mapeamento completo e válido → sem pendências', () => {
    expect(validarMapeamento(CABECALHO_PADRAO, MAPEAMENTO_PADRAO)).toEqual([]);
  });

  it('faltando natureza → AUSENTE', () => {
    const semNatureza = Object.fromEntries(
      Object.entries(MAPEAMENTO_PADRAO).filter(([campo]) => campo !== 'natureza'),
    ) as unknown as Mapeamento;

    expect(validarMapeamento(CABECALHO_PADRAO, semNatureza)).toEqual([
      { campo: 'natureza', motivo: 'AUSENTE' },
    ]);
  });

  it('natureza em branco → AUSENTE', () => {
    expect(validarMapeamento(CABECALHO_PADRAO, { ...MAPEAMENTO_PADRAO, natureza: '  ' })).toEqual([
      { campo: 'natureza', motivo: 'AUSENTE' },
    ]);
  });

  it('coluna que não existe no cabeçalho → COLUNA_INEXISTENTE', () => {
    expect(validarMapeamento(CABECALHO_PADRAO, { ...MAPEAMENTO_PADRAO, nome: 'descricao' })).toEqual([
      { campo: 'nome', motivo: 'COLUNA_INEXISTENTE' },
    ]);
  });

  it('mesma coluna para codigo e nome → COLUNA_REPETIDA nos dois campos', () => {
    expect(validarMapeamento(CABECALHO_PADRAO, { ...MAPEAMENTO_PADRAO, nome: 'codigo' })).toEqual([
      { campo: 'codigo', motivo: 'COLUNA_REPETIDA' },
      { campo: 'nome', motivo: 'COLUNA_REPETIDA' },
    ]);
  });

  it('ignora espaços nas pontas ao comparar com o cabeçalho', () => {
    expect(validarMapeamento(['  codigo ', 'nome', 'tipo', 'natureza', 'conta_pai'], MAPEAMENTO_PADRAO)).toEqual([]);
  });
});

describe('normalizarLinhas', () => {
  /** Registros consecutivos a partir da linha 2 (cabeçalho na 1), sem campos a mais. */
  const registros = (linhas: readonly (readonly string[])[]): readonly RegistroDoCsv[] =>
    linhas.map((celulas, posicao) => ({ numeroDaLinha: posicao + 2, celulas, camposAMais: 0 }));

  const normalizar = (
    linhas: readonly (readonly string[])[],
    mapeamento: Mapeamento = MAPEAMENTO_PADRAO,
    cabecalho: readonly string[] = CABECALHO_PADRAO,
  ) => normalizarLinhas(cabecalho, registros(linhas), mapeamento);

  it("'Analítica ' → 'analitica' e demais variantes de acento e caixa", () => {
    const [a, b, c, d] = normalizar([
      ['1', 'A', 'Analítica ', 'Devedora', ''],
      ['2', 'B', 'SINTÉTICA', 'CREDORA', ''],
      ['3', 'C', 'analitica', 'devedora', ''],
      ['4', 'D', ' Sintetica', 'credora ', ''],
    ]);

    expect([a?.tipo, a?.natureza]).toEqual(['analitica', 'devedora']);
    expect([b?.tipo, b?.natureza]).toEqual(['sintetica', 'credora']);
    expect([c?.tipo, c?.natureza]).toEqual(['analitica', 'devedora']);
    expect([d?.tipo, d?.natureza]).toEqual(['sintetica', 'credora']);
  });

  it('preserva o valor cru (aparado) quando não é do domínio, para o domínio rejeitar depois', () => {
    const [linha] = normalizar([['1', 'A', ' Xpto ', 'ambas', '']]);

    expect(linha?.tipo).toBe('Xpto');
    expect(linha?.natureza).toBe('ambas');
  });

  it("código '01' permanece '01' e código só de espaços vira ''", () => {
    const [a, b] = normalizar([
      ['01', 'A', 'analitica', 'devedora', ''],
      ['   ', 'B', 'analitica', 'devedora', ''],
    ]);

    expect(a?.codigo).toBe('01');
    expect(b?.codigo).toBe('');
  });

  it('conta-pai em branco → null; preenchida mantém zeros à esquerda', () => {
    const [a, b] = normalizar([
      ['1', 'A', 'sintetica', 'devedora', '  '],
      ['2', 'B', 'analitica', 'devedora', ' 01 '],
    ]);

    expect(a?.contaPai).toBeNull();
    expect(b?.contaPai).toBe('01');
  });

  it('numera as linhas pela posição física: primeira linha de dados é a 2', () => {
    const resultado = normalizar([
      ['1', 'A', 'sintetica', 'devedora', ''],
      ['2', 'B', 'sintetica', 'devedora', ''],
    ]);

    expect(resultado.map((l) => l.numeroDaLinha)).toEqual([2, 3]);
  });

  it('usa o número físico que viaja com cada registro (linhas em branco ou quebras internas)', () => {
    const resultado = normalizarLinhas(
      CABECALHO_PADRAO,
      [
        { numeroDaLinha: 2, celulas: ['1', 'A', 'sintetica', 'devedora', ''], camposAMais: 0 },
        { numeroDaLinha: 7, celulas: ['2', 'B', 'sintetica', 'devedora', ''], camposAMais: 0 },
      ],
      MAPEAMENTO_PADRAO,
    );

    expect(resultado.map((l) => l.numeroDaLinha)).toEqual([2, 7]);
  });

  it('respeita a ordem de colunas definida pelo mapeamento, não pela posição', () => {
    const cabecalho = ['Conta pai', 'Natureza', 'Tipo', 'Descrição', 'Código'];
    const mapeamento: Mapeamento = {
      codigo: 'Código',
      nome: 'Descrição',
      tipo: 'Tipo',
      natureza: 'Natureza',
      conta_pai: 'Conta pai',
    };

    const [linha] = normalizar([['1', 'Credora', 'Sintética', 'Passivo', '2']], mapeamento, cabecalho);

    expect(linha).toEqual({
      numeroDaLinha: 2,
      codigo: '2',
      nome: 'Passivo',
      tipo: 'sintetica',
      natureza: 'credora',
      contaPai: '1',
    });
  });

  it('célula ausente em linha curta vira vazio, sem lançar', () => {
    const [linha] = normalizar([['1', 'A']]);

    expect(linha).toMatchObject({ tipo: '', natureza: '', contaPai: null });
  });

  it('registro com campos a mais carrega o defeito de estrutura; sem sobra, a chave nem existe', () => {
    const [comSobra, semSobra] = normalizarLinhas(
      CABECALHO_PADRAO,
      [
        { numeroDaLinha: 4, celulas: ['3', 'Caixa', 'Bancos', 'analitica', 'devedora'], camposAMais: 1 },
        { numeroDaLinha: 5, celulas: ['4', 'B', 'analitica', 'devedora', ''], camposAMais: 0 },
      ],
      MAPEAMENTO_PADRAO,
    );

    expect(comSobra).toMatchObject({ numeroDaLinha: 4, defeitoDeEstrutura: 'CAMPOS_A_MAIS' });
    expect(semSobra).toBeDefined();
    expect(semSobra && 'defeitoDeEstrutura' in semSobra).toBe(false);
  });

  it('mapeamento que não cobre o cabeçalho → MAPEAMENTO_INCOMPLETO', () => {
    expect(codigoDoErro(() => normalizar([['1']], { ...MAPEAMENTO_PADRAO, nome: 'nao_existe' }))).toBe(
      'MAPEAMENTO_INCOMPLETO',
    );
  });

  it('alimenta validarLinhasDoPlano: valores inválidos viram rejeição, não exceção', () => {
    const linhas = normalizar([
      ['1', 'Ativo', 'sintetica', 'devedora', ''],
      ['2', 'Estranha', 'xpto', 'devedora', '1'],
      ['3', 'Sem natureza', 'analitica', '', '1'],
      ['', 'Sem código', 'analitica', 'devedora', '1'],
      ['4', 'Filha de si mesma', 'analitica', 'devedora', '4'],
      ['01', 'Zero à esquerda', 'analitica', 'devedora', '1'],
    ]);

    const { aceitas, rejeitadas } = validarLinhasDoPlano({ linhas, contasVigentes: [] });

    expect(aceitas.map((a) => a.codigo)).toEqual(['1', '01']);
    expect(rejeitadas.map((r) => [r.numeroDaLinha, r.codigoDeErro, r.campo])).toEqual([
      [3, 'VALOR_FORA_DO_DOMINIO', 'tipo'],
      [4, 'CAMPO_OBRIGATORIO_AUSENTE', 'natureza'],
      [5, 'CAMPO_OBRIGATORIO_AUSENTE', 'codigo'],
      [6, 'CICLO_HIERARQUICO', 'conta_pai'],
    ]);
  });
});

describe('MODELO_CSV', () => {
  it('começa pelo cabeçalho oficial, usa CRLF e termina com quebra', () => {
    expect(MODELO_CSV.startsWith('codigo;nome;tipo;natureza;conta_pai\r\n')).toBe(true);
    expect(MODELO_CSV.endsWith('\r\n')).toBe(true);
    expect(MODELO_CSV.replaceAll('\r\n', '')).not.toMatch(/[\r\n]/u);
  });

  it('é aceito integralmente pela validação, sem nenhuma rejeição', () => {
    const [cabecalho, ...dados] = MODELO_CSV.trimEnd()
      .split('\r\n')
      .map((linha) => linha.split(';'));

    const registros: readonly RegistroDoCsv[] = dados.map((celulas, posicao) => ({
      numeroDaLinha: posicao + 2,
      celulas,
      camposAMais: 0,
    }));
    const linhas = normalizarLinhas(cabecalho ?? [], registros, MAPEAMENTO_PADRAO);
    const { aceitas, rejeitadas } = validarLinhasDoPlano({ linhas, contasVigentes: [] });

    expect(rejeitadas).toEqual([]);
    expect(aceitas.length).toBe(dados.length);
    expect(aceitas.length).toBeGreaterThanOrEqual(4);
  });
});
