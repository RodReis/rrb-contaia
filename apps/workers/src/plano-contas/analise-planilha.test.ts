/**
 * Parte pura da validação do plano de contas para XLSX/ODS (SPEC-015 §3.4–§3.7): a aba lida (leitor
 * real, em processo, sobre planilhas montadas) + cabeçalho + mapeamento por LETRA → o MESMO staging
 * do CSV, com as rejeições estruturais da linha e o que a leitura grava na tentativa.
 */
import type { LinhaDeStaging } from '@contaia/db';
import type { ContaVigente } from '@contaia/domain';
import { lerAba } from '@contaia/planilhas';
import { planilhaOds, planilhaXlsx, type AbaDeTeste, type LinhaDeTeste } from '@contaia/planilhas/testes';
import { describe, expect, it } from 'vitest';

import { analisarAba, analisarArquivo, type ResultadoDaAnalise } from './analise.js';

const POR_LETRA = { codigo: 'A', nome: 'B', tipo: 'C', natureza: 'D', conta_pai: 'E' };
const CABECALHO = ['codigo', 'nome', 'tipo', 'natureza', 'conta_pai'];
const FORMATOS = [
  ['XLSX', planilhaXlsx],
  ['ODS', planilhaOds],
] as const;

const aba = (linhas: readonly LinhaDeTeste[], mesclas?: readonly string[]): AbaDeTeste => ({
  nome: 'Plano',
  linhas,
  ...(mesclas === undefined ? {} : { mesclas }),
});

const analisar = (bytes: Buffer, linhaCabecalho = 1, mapeamento: Record<string, string> = POR_LETRA, vigentes: readonly ContaVigente[] = []) =>
  analisarAba(lerAba(bytes, 1), linhaCabecalho, mapeamento, vigentes);

/** Código de erro e campo da rejeitada (a válida não tem). */
const erro = (l: LinhaDeStaging) => (l.status === 'REJEITADA' ? { codigoDeErro: l.codigoDeErro, campo: l.campo, mensagem: l.mensagem } : null);

const linhas = (resultado: ResultadoDaAnalise) => {
  if (resultado.tipo !== 'LINHAS') throw new Error(`recusado: ${resultado.codigo}`);
  return resultado.linhas;
};

/** Mesmo conteúdo em CSV: a planilha precisa dar o mesmo resultado (SPEC-015 §3.6). */
const csv = (registros: readonly (readonly string[])[]): Buffer =>
  Buffer.from([CABECALHO.join(';'), ...registros.map((r) => r.join(';')), ''].join('\r\n'), 'utf8');
const MAPEAMENTO_CSV = Object.fromEntries(CABECALHO.map((c) => [c, c]));

describe.each(FORMATOS)('analisarAba (%s)', (_formato, montar) => {
  it('título antes do cabeçalho ignorado, oculta processada, fórmula e mescla rejeitam SÓ a própria linha, com o número original', () => {
    const bytes = montar(
      aba(
        [
          { numero: 1, valores: ['Plano de contas 2026'] },
          { numero: 2, valores: ['Empresa X'] },
          { numero: 3, valores: CABECALHO },
          { numero: 4, valores: ['1', 'Ativo', 'sintética', 'devedora', ''] },
          { numero: 5, valores: ['1.1', 'Caixa', 'analítica', 'devedora', '1'], oculta: true },
          { numero: 6, valores: ['1.2', 'Bancos', 'analítica', 'devedora', '1'], formulaEm: 'B' },
          { numero: 7, valores: ['1.3', 'Aplicações', 'analítica', 'devedora', '1'] },
          { numero: 8, valores: ['1.4', '', 'analítica', 'devedora', '1'] },
          { numero: 9, valores: ['1.5', 'Estoques', 'analítica', 'devedora', '1'] },
        ],
        ['B7:B8'],
      ),
    );

    const resultado = analisar(bytes, 3);

    expect(linhas(resultado).map((l) => [l.numeroDaLinha, l.status, l.codigo, erro(l)?.codigoDeErro ?? null, erro(l)?.campo ?? null])).toEqual([
      [4, 'VALIDA', '1', null, null],
      [5, 'VALIDA', '1.1', null, null],
      [6, 'REJEITADA', '1.2', 'CELULA_COM_FORMULA', 'nome'],
      [7, 'REJEITADA', '1.3', 'CELULA_MESCLADA', 'nome'],
      [8, 'REJEITADA', '1.4', 'CELULA_MESCLADA', 'nome'],
      [9, 'VALIDA', '1.5', null, null],
    ]);
    const formula = linhas(resultado).find((l) => l.numeroDaLinha === 6)!;
    // Nem o resultado salvo da fórmula nem o valor da mescla alimentam a linha; a mensagem é fixa.
    expect(formula.nome).toBeNull();
    expect(erro(formula)?.mensagem).toMatch(/fórmula/u);
    expect(linhas(resultado).find((l) => l.numeroDaLinha === 8)!.nome).toBeNull();
    expect(resultado.tipo === 'LINHAS' && resultado.leitura).toEqual({
      linhasIgnoradasAntesDoCabecalho: 2,
      linhasOcultas: 1,
      diagnosticos: [
        expect.objectContaining({ codigo: 'LINHAS_ANTERIORES_AO_CABECALHO_IGNORADAS', quantidade: 2 }),
        expect.objectContaining({ codigo: 'LINHAS_OCULTAS_PROCESSADAS', quantidade: 1 }),
        expect.objectContaining({ codigo: 'LINHAS_COM_FORMULA_REJEITADAS', quantidade: 1 }),
        expect.objectContaining({ codigo: 'LINHAS_COM_CELULA_MESCLADA_REJEITADAS', quantidade: 2 }),
      ],
    });
  });

  it('fórmula/mescla fora das colunas mapeadas não rejeitam nada', () => {
    const bytes = montar(
      aba(
        [
          { numero: 1, valores: [...CABECALHO, 'obs'] },
          { numero: 2, valores: ['1', 'Ativo', 'sintética', 'devedora', '', 'x'], formulaEm: 'F' },
          { numero: 3, valores: ['2', 'Passivo', 'sintética', 'credora', '', 'y'] },
          { numero: 4, valores: ['3', 'PL', 'sintética', 'credora', '', ''] },
        ],
        ['F3:F4'],
      ),
    );

    expect(linhas(analisar(bytes)).every((l) => l.status === 'VALIDA')).toBe(true);
  });

  it('equivalência: o mesmo conteúdo em CSV e na planilha → o mesmo staging (hierarquia, órfã, duplicidade, vigente)', () => {
    const registros = [
      ['1', 'Ativo', 'Sintética', 'Devedora', ''],
      ['1.1', 'Caixa', 'analítica', 'devedora', '1'],
      ['1.1', 'Caixa dup', 'analítica', 'devedora', '1'],
      ['2.1', 'Órfã', 'analítica', 'credora', '9'],
      ['3', 'Receitas', 'xpto', 'credora', ''],
      ['4', 'Já existe', 'sintética', 'credora', ''],
    ];
    const vigentes: readonly ContaVigente[] = [{ codigo: '4', tipo: 'sintetica', contaPai: null, arquivada: false, temFilhas: false }];
    const doCsv = analisarArquivo(csv(registros), MAPEAMENTO_CSV, vigentes);
    const daPlanilha = analisarAba(
      lerAba(montar(aba([{ numero: 1, valores: CABECALHO }, ...registros.map((valores, i) => ({ numero: i + 2, valores }))])), 1),
      1,
      POR_LETRA,
      vigentes,
    );

    expect(linhas(daPlanilha)).toEqual(linhas(doCsv));
    expect(linhas(daPlanilha).map((l) => (l.status === 'REJEITADA' ? l.codigoDeErro : l.acao))).toEqual([
      'INCLUIR',
      'CODIGO_DUPLICADO_NO_ARQUIVO',
      'CODIGO_DUPLICADO_NO_ARQUIVO',
      'CONTA_PAI_INEXISTENTE',
      'VALOR_FORA_DO_DOMINIO',
      'ATUALIZAR',
    ]);
  });

  it.each([
    ['cabeçalho em branco', 2, POR_LETRA, 'CABECALHO_INVALIDO'],
    ['letra fora do cabeçalho', 1, { ...POR_LETRA, conta_pai: 'H' }, 'MAPEAMENTO_INCOMPLETO'],
    ['nome do cabeçalho no lugar da letra', 1, { ...POR_LETRA, codigo: 'codigo' }, 'MAPEAMENTO_INCOMPLETO'],
    ['mesma letra em dois campos', 1, { ...POR_LETRA, nome: 'A' }, 'MAPEAMENTO_INCOMPLETO'],
  ] as const)('%s → arquivo recusado (%s) sem staging', (_caso, linhaCabecalho, mapeamento, codigo) => {
    const bytes = montar(aba([{ numero: 1, valores: CABECALHO }, { numero: 3, valores: ['1', 'Ativo', 'sintética', 'devedora', ''] }]));

    expect(analisar(bytes, linhaCabecalho, mapeamento)).toEqual({ tipo: 'ARQUIVO_RECUSADO', codigo });
  });

  it('só o cabeçalho → ARQUIVO_VAZIO', () => {
    expect(analisar(montar(aba([{ numero: 1, valores: CABECALHO }])))).toEqual({ tipo: 'ARQUIVO_RECUSADO', codigo: 'ARQUIVO_VAZIO' });
  });
});

describe('analisarAba: aba e cabeçalho (rede de segurança do worker)', () => {
  it('cabeçalho com célula mesclada → CABECALHO_MESCLADO', () => {
    const bytes = planilhaXlsx(aba([{ numero: 1, valores: CABECALHO }, { numero: 2, valores: ['1', 'Ativo', 'sintética', 'devedora', ''] }], ['D1:E1']));

    expect(analisar(bytes)).toEqual({ tipo: 'ARQUIVO_RECUSADO', codigo: 'CABECALHO_MESCLADO' });
  });

  it('aba sem nenhuma linha → ABA_SEM_DADOS', () => {
    const vazia = { formato: 'XLSX', aba: { nome: 'P', posicao: 1, utilizavel: false }, linhas: [], mesclas: [], totalDeLinhasOcultas: 0 } as const;

    expect(analisarAba(vazia, 1, POR_LETRA, [])).toEqual({ tipo: 'ARQUIVO_RECUSADO', codigo: 'ABA_SEM_DADOS' });
  });

  it('o CSV continua sem os metadados de leitura de planilha', () => {
    const resultado = analisarArquivo(csv([['1', 'Ativo', 'sintética', 'devedora', '']]), MAPEAMENTO_CSV, []);

    expect(resultado.tipo === 'LINHAS' && 'leitura' in resultado).toBe(false);
  });
});
