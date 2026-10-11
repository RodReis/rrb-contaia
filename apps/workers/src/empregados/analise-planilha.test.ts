/**
 * Parte pura da validação de empregados para XLSX/ODS (SPEC-015 §3.4–§3.7): a aba lida (leitor real,
 * em processo) + cabeçalho + mapeamento por LETRA → o MESMO staging do CSV (duplicidade, vigentes,
 * datas), com as rejeições estruturais da linha e o que a leitura grava na tentativa.
 */
import { lerAba } from '@contaia/planilhas';
import { abaXml, planilhaOds, planilhaXlsx, xlsx, type AbaDeTeste, type LinhaDeTeste } from '@contaia/planilhas/testes';
import { describe, expect, it } from 'vitest';

import { analisarAba, analisarArquivo, type ResultadoDaAnalise } from './analise.js';

const CABECALHO = ['cpf', 'nome', 'matricula', 'data_nascimento', 'data_admissao'];
const POR_LETRA = { cpf: 'A', nome: 'B', matricula: 'C', data_nascimento: 'D', data_admissao: 'E' };
const CPF_A = '529.982.247-25';
const CPF_B = '111.444.777-35';
const FORMATOS = [
  ['XLSX', planilhaXlsx],
  ['ODS', planilhaOds],
] as const;

const aba = (linhas: readonly LinhaDeTeste[], mesclas?: readonly string[]): AbaDeTeste => ({
  nome: 'Empregados',
  linhas,
  ...(mesclas === undefined ? {} : { mesclas }),
});

const linhas = (resultado: ResultadoDaAnalise) => {
  if (resultado.tipo !== 'LINHAS') throw new Error(`recusado: ${resultado.codigo}`);
  return resultado.linhas;
};

const csv = (registros: readonly (readonly string[])[]): Buffer =>
  Buffer.from([CABECALHO.join(';'), ...registros.map((r) => r.join(';')), ''].join('\r\n'), 'utf8');
const MAPEAMENTO_CSV = Object.fromEntries(CABECALHO.map((c) => [c, c]));

describe.each(FORMATOS)('analisarAba de empregados (%s)', (_formato, montar) => {
  it('título ignorado, oculta processada, fórmula/mescla em coluna mapeada rejeitam só a linha (sem eco de CPF/nome)', () => {
    const bytes = montar(
      aba(
        [
          { numero: 1, valores: ['Folha 2026'] },
          { numero: 2, valores: CABECALHO },
          { numero: 3, valores: [CPF_A, 'Maria Souza', '00123', '15/03/1985', '01/02/2010'] },
          { numero: 4, valores: [CPF_B, 'João Lima', '77', '20/07/1990', '10/01/2015'], oculta: true },
          { numero: 5, valores: ['123.456.789-09', 'Ana Reis', '8', '01/01/1980', '01/01/2000'], formulaEm: 'A' },
          { numero: 6, valores: ['987.654.321-00', 'Pedro', '9', '01/01/1980', '01/01/2000'] },
          { numero: 7, valores: ['', '', '', '', ''] },
        ],
        ['B6:C6'],
      ),
    );

    const resultado = analisarAba(lerAba(bytes, 1), 2, POR_LETRA, new Map());

    expect(linhas(resultado).map((l) => [l.numeroDaLinha, l.status, l.codigoDeErro, l.campo])).toEqual([
      [3, 'VALIDA', null, null],
      [4, 'VALIDA', null, null],
      [5, 'REJEITADA', 'CELULA_COM_FORMULA', 'cpf'],
      [6, 'REJEITADA', 'CELULA_MESCLADA', 'nome'],
    ]);
    const rejeitadas = linhas(resultado).filter((l) => l.status === 'REJEITADA');
    for (const linha of rejeitadas) {
      expect(linha.mensagem).not.toMatch(/\d{3}\.\d{3}|Ana|Pedro/u);
    }
    expect(rejeitadas[0]!.cpf).toBeNull();
    expect(resultado.tipo === 'LINHAS' && resultado.leitura).toMatchObject({ linhasIgnoradasAntesDoCabecalho: 1, linhasOcultas: 1 });
  });

  it('equivalência com o CSV: duplicidade rejeita todas, vigente vira ATUALIZAR, arquivado rejeita, 00123 ≠ 123', () => {
    const registros = [
      [CPF_A, 'Maria', '00123', '15/03/1985', '01/02/2010'],
      [CPF_A, 'Maria', '123', '15/03/1985', '01/02/2010'],
      [CPF_B, 'João', '7', '15/03/1985', '01/02/2010'],
      ['11144477735', 'João dup', '7', '15/03/1985', '01/02/2010'],
      ['123.456.789-00', 'CPF ruim', '9', '15/03/1985', '01/02/2010'],
      ['390.533.447-05', 'Arquivado', '5', '15/03/1985', '01/02/2010'],
    ];
    const vigentes = new Map([
      ['52998224725|00123', { arquivado: false }],
      ['39053344705|5', { arquivado: true }],
    ]);
    const doCsv = analisarArquivo(csv(registros), MAPEAMENTO_CSV, vigentes);
    const bytes = montar(aba([{ numero: 1, valores: CABECALHO }, ...registros.map((valores, i) => ({ numero: i + 2, valores }))]));
    const daPlanilha = analisarAba(lerAba(bytes, 1), 1, POR_LETRA, vigentes);

    expect(linhas(daPlanilha)).toEqual(linhas(doCsv));
    expect(linhas(daPlanilha).map((l) => l.codigoDeErro ?? l.acao)).toEqual([
      'ATUALIZAR',
      'INCLUIR',
      'CHAVE_DUPLICADA_NO_ARQUIVO',
      'CHAVE_DUPLICADA_NO_ARQUIVO',
      'CPF_INVALIDO',
      'EMPREGADO_ARQUIVADO',
    ]);
  });

  it('mapeamento por nome (não letra) ou com letra fora do cabeçalho → MAPEAMENTO_INCOMPLETO', () => {
    const bytes = montar(aba([{ numero: 1, valores: CABECALHO }, { numero: 2, valores: [CPF_A, 'Maria', '1', '15/03/1985', '01/02/2010'] }]));

    expect(analisarAba(lerAba(bytes, 1), 1, MAPEAMENTO_CSV, new Map())).toEqual({ tipo: 'ARQUIVO_RECUSADO', codigo: 'MAPEAMENTO_INCOMPLETO' });
    expect(analisarAba(lerAba(bytes, 1), 1, { ...POR_LETRA, cpf: 'Z' }, new Map())).toEqual({ tipo: 'ARQUIVO_RECUSADO', codigo: 'MAPEAMENTO_INCOMPLETO' });
  });
});

describe('analisarAba de empregados: tipos nativos do XLSX', () => {
  it('data nativa nas colunas de data vira a data civil; CPF número com máscara vale o exibido; matrícula 00123 preservada', () => {
    // xf 1 = dd/mm/yyyy; xf 2 = máscara de CPF; xf 3 = 00000 (ESTILOS dos construtores).
    const linhasXml =
      '<row r="1">' +
      CABECALHO.map((c, i) => `<c r="${'ABCDE'[i]}1" t="inlineStr"><is><t>${c}</t></is></c>`).join('') +
      '</row><row r="2"><c r="A2" s="2"><v>52998224725</v></c><c r="B2" t="inlineStr"><is><t>Maria</t></is></c>' +
      '<c r="C2" s="3"><v>123</v></c><c r="D2" s="1"><v>31121</v></c><c r="E2" s="1"><v>40210</v></c></row>';
    const bytes = xlsx({ abas: [{ nome: 'E', xml: abaXml(linhasXml) }] });

    const [linha] = linhas(analisarAba(lerAba(bytes, 1), 1, POR_LETRA, new Map()));

    expect(linha).toMatchObject({
      status: 'VALIDA',
      cpfNormalizado: '52998224725',
      matricula: '00123',
      dataNascimento: '1985-03-15',
      dataAdmissao: '2010-02-01',
    });
  });
});
