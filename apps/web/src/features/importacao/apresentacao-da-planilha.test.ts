/**
 * Textos e traduções puras da planilha (SPEC-015 §3.3–3.5, §3.9): rótulo da aba, resumo das linhas
 * ignoradas e ocultas, sugestão do mapeamento por letra e o que a prévia mostra de uma planilha.
 */
import { describe, expect, it } from 'vitest';

import { sugerirMapeamento } from './cabecalho-csv';
import {
  colunaDoMapeamento,
  descricaoDoDiagnostico,
  ehPlanilha,
  letrasDasColunas,
  nomeDoModelo,
  nomeDoRelatorio,
  previaDaLinha,
  resumoDasLinhas,
  rotuloDaAba,
  sugestaoPorLetra,
} from './apresentacao-da-planilha';

describe('rotuloDaAba', () => {
  it('diz nome e posição', () => {
    expect(rotuloDaAba({ nome: 'Plano 2026', posicao: 2 })).toBe('Plano 2026 (posição 2)');
  });
});

describe('resumoDasLinhas', () => {
  it.each([
    [0, 0, '0 linhas anteriores ignoradas · 0 linhas ocultas processadas'],
    [1, 1, '1 linha anterior ignorada · 1 linha oculta processada'],
    [1200, 3, '1.200 linhas anteriores ignoradas · 3 linhas ocultas processadas'],
  ])('%i ignoradas e %i ocultas', (ignoradas, ocultas, esperado) => {
    expect(resumoDasLinhas(ignoradas, ocultas)).toBe(esperado);
  });
});

describe('sugestaoPorLetra', () => {
  const sugerir = (cabecalho: readonly string[]) => sugerirMapeamento(['codigo', 'nome'], cabecalho);

  it('traduz a sugestão por nome na letra da coluna', () => {
    const colunas = [
      { letra: 'A', nome: 'Nome', rotulo: 'Coluna A — Nome' },
      { letra: 'B', nome: null, rotulo: 'Coluna B (sem nome)' },
      { letra: 'C', nome: 'Código', rotulo: 'Coluna C — Código' },
    ];

    expect(sugestaoPorLetra(sugerir, colunas)).toEqual({ codigo: 'C', nome: 'A' });
  });

  it('nome repetido não é escolhido em silêncio', () => {
    const colunas = [
      { letra: 'A', nome: 'codigo', rotulo: 'Coluna A — codigo' },
      { letra: 'B', nome: 'codigo', rotulo: 'Coluna B — codigo' },
    ];

    expect(sugestaoPorLetra(sugerir, colunas)).toEqual({});
  });
});

describe('letrasDasColunas', () => {
  it('ordena pela posição da coluna, não pela ordem alfabética', () => {
    expect(letrasDasColunas([{ AA: 'x', B: 'y' }, { A: 'z', C: '' }])).toEqual(['A', 'B', 'C', 'AA']);
  });
});

describe('colunaDoMapeamento', () => {
  it('planilha mostra a letra como coluna; CSV mostra o nome', () => {
    expect(colunaDoMapeamento('XLSX', 'C')).toBe('Coluna C');
    expect(colunaDoMapeamento('ODS', 'AB')).toBe('Coluna AB');
    expect(colunaDoMapeamento('CSV', 'codigo')).toBe('codigo');
    expect(colunaDoMapeamento(undefined, 'codigo')).toBe('codigo');
    expect(colunaDoMapeamento('XLSX', undefined)).toBe('—');
  });
});

describe('ehPlanilha', () => {
  it('só XLSX e ODS', () => {
    expect(ehPlanilha('XLSX')).toBe(true);
    expect(ehPlanilha('ODS')).toBe(true);
    expect(ehPlanilha('CSV')).toBe(false);
    expect(ehPlanilha(undefined)).toBe(false);
  });
});

describe('descricaoDoDiagnostico', () => {
  it.each([
    ['LINHAS_ANTERIORES_AO_CABECALHO_IGNORADAS', 2, '2 linhas anteriores ao cabeçalho ignoradas'],
    ['LINHAS_OCULTAS_PROCESSADAS', 1, '1 linha oculta processada'],
    ['LINHAS_COM_FORMULA_REJEITADAS', 1, '1 linha rejeitada por fórmula'],
    ['LINHAS_COM_CELULA_MESCLADA_REJEITADAS', 3, '3 linhas rejeitadas por célula mesclada'],
  ] as const)('%s', (codigo, quantidade, esperado) => {
    expect(descricaoDoDiagnostico({ codigo, quantidade, mensagem: 'texto do servidor' })).toBe(esperado);
  });
});

describe('nomes dos arquivos baixados', () => {
  it('relatório é sempre CSV, sem a extensão do original', () => {
    expect(nomeDoRelatorio('plano.csv')).toBe('relatorio-plano.csv');
    expect(nomeDoRelatorio('plano.XLSX')).toBe('relatorio-plano.csv');
    expect(nomeDoRelatorio('empregados.ods')).toBe('relatorio-empregados.csv');
  });

  it('modelo troca só a extensão', () => {
    expect(nomeDoModelo('modelo-empregados.csv', 'csv')).toBe('modelo-empregados.csv');
    expect(nomeDoModelo('modelo-empregados.csv', 'xlsx')).toBe('modelo-empregados.xlsx');
    expect(nomeDoModelo('modelo-plano-de-contas.csv', 'ods')).toBe('modelo-plano-de-contas.ods');
  });
});

describe('previaDaLinha', () => {
  const letras = ['A', 'B', 'C', 'D', 'E'];

  it('os três primeiros valores na ordem das colunas, com reticências quando há mais', () => {
    expect(previaDaLinha({ C: 'tipo', A: 'codigo', B: 'nome', D: 'natureza' }, letras)).toBe('codigo, nome, tipo, …');
  });

  it('pula células vazias e não põe reticências quando cabe tudo', () => {
    expect(previaDaLinha({ A: 'Relatório', C: '  ', E: 'Obs' }, letras)).toBe('Relatório, Obs');
  });

  it('corta valor longo e diz quando a linha está vazia', () => {
    expect(previaDaLinha({ A: 'x'.repeat(60) }, letras)).toBe(`${'x'.repeat(39)}…`);
    expect(previaDaLinha({}, letras)).toBe('linha vazia');
  });
});
