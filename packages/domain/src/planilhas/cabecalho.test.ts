import { describe, expect, it } from 'vitest';

import { cabecalhoEstaMesclado, rotulosDasColunas, sugerirLinhaDeCabecalho } from './cabecalho.js';
import type { CelulaDaTabela, LeituraDaAba, LinhaDaTabela } from './tipos.js';

type Entrada = string | Partial<CelulaDaTabela>;

const celula = (entrada: Entrada): CelulaDaTabela =>
  typeof entrada === 'string'
    ? { valorExibido: entrada, tipoNativo: entrada === '' ? 'vazio' : 'texto', formula: false, mesclada: false }
    : { valorExibido: '', tipoNativo: 'texto', formula: false, mesclada: false, ...entrada };

const linha = (numero: number, celulas: Record<string, Entrada>, oculta = false): LinhaDaTabela => ({
  numero,
  oculta,
  celulas: Object.fromEntries(Object.entries(celulas).map(([letra, valor]) => [letra, celula(valor)])),
});

const leitura = (
  linhas: readonly LinhaDaTabela[],
  mesclas: LeituraDaAba['mesclas'] = [],
): LeituraDaAba => ({
  formato: 'XLSX',
  aba: { nome: 'Plano', posicao: 1, utilizavel: true },
  linhas,
  mesclas,
  totalDeLinhasOcultas: linhas.filter((l) => l.oculta).length,
});

describe('sugerirLinhaDeCabecalho', () => {
  it('sugere a primeira linha com conteúdo', () => {
    const aba = leitura([linha(3, { A: 'Código', B: 'Nome' }), linha(4, { A: '1', B: 'Ativo' })]);

    expect(sugerirLinhaDeCabecalho(aba)).toBe(3);
  });

  it('ignora linha cujas células são só brancas e usa o menor número, mesmo fora de ordem', () => {
    const aba = leitura([linha(9, { A: 'x' }), linha(2, { A: '   ', B: '' }), linha(5, { A: 'Código' })]);

    expect(sugerirLinhaDeCabecalho(aba)).toBe(5);
  });

  it('conta como conteúdo a célula com fórmula, mesmo com resultado em branco', () => {
    const aba = leitura([linha(1, { A: { valorExibido: '', tipoNativo: 'texto', formula: true } })]);

    expect(sugerirLinhaDeCabecalho(aba)).toBe(1);
  });

  it('devolve null quando a aba não tem conteúdo', () => {
    expect(sugerirLinhaDeCabecalho(leitura([]))).toBeNull();
    expect(sugerirLinhaDeCabecalho(leitura([linha(1, { A: '' })]))).toBeNull();
  });
});

describe('rotulosDasColunas', () => {
  it('rotula cada coluna com a letra e o nome: "Coluna C — Nome"', () => {
    const aba = leitura([linha(1, { A: 'Código', B: 'Nome', C: 'Tipo' })]);

    expect(rotulosDasColunas(aba, 1)).toEqual([
      { letra: 'A', nome: 'Código', rotulo: 'Coluna A — Código' },
      { letra: 'B', nome: 'Nome', rotulo: 'Coluna B — Nome' },
      { letra: 'C', nome: 'Tipo', rotulo: 'Coluna C — Tipo' },
    ]);
  });

  it('coluna sem nome no meio do cabeçalho vira "Coluna D (sem nome)"', () => {
    const aba = leitura([linha(1, { A: 'Código', C: 'Nome' })]);

    expect(rotulosDasColunas(aba, 1).map((r) => r.rotulo)).toEqual([
      'Coluna A — Código',
      'Coluna B (sem nome)',
      'Coluna C — Nome',
    ]);
    expect(rotulosDasColunas(aba, 1)[1]).toEqual({ letra: 'B', nome: null, rotulo: 'Coluna B (sem nome)' });
  });

  it('nomes repetidos (inclusive só na caixa) ficam distintos pela letra', () => {
    const aba = leitura([linha(1, { A: 'Nome', B: 'nome', C: ' NOME ' })]);

    const rotulos = rotulosDasColunas(aba, 1).map((r) => r.rotulo);

    expect(rotulos).toEqual(['Coluna A — Nome', 'Coluna B — nome', 'Coluna C — NOME']);
    expect(new Set(rotulos).size).toBe(3);
  });

  it('o nome é aparado e a lista termina na última coluna preenchida da linha de cabeçalho', () => {
    const aba = leitura([
      linha(1, { A: '  Código  ', B: 'Nome', C: '   ' }),
      linha(2, { A: '1', B: 'Ativo', C: 'sobra', D: 'sobra' }),
    ]);

    expect(rotulosDasColunas(aba, 1).map((r) => r.letra)).toEqual(['A', 'B']);
  });

  it('colunas além de Z usam letras duplas', () => {
    const aba = leitura([linha(1, { A: 'a', AA: 'aa', AB: 'ab' })]);

    const rotulos = rotulosDasColunas(aba, 1);

    expect(rotulos).toHaveLength(28);
    expect(rotulos[26]).toEqual({ letra: 'AA', nome: 'aa', rotulo: 'Coluna AA — aa' });
    expect(rotulos[1]?.rotulo).toBe('Coluna B (sem nome)');
  });

  it('linha de cabeçalho inexistente ou em branco não tem colunas', () => {
    const aba = leitura([linha(1, { A: 'x' })]);

    expect(rotulosDasColunas(aba, 7)).toEqual([]);
    expect(rotulosDasColunas(leitura([linha(1, { A: '' })]), 1)).toEqual([]);
  });
});

describe('cabecalhoEstaMesclado', () => {
  const aba = (mesclas: LeituraDaAba['mesclas'], cabecalho: Record<string, Entrada> = { A: 'Código', B: 'Nome' }) =>
    leitura([linha(2, cabecalho), linha(3, { A: '1', B: 'Ativo' })], mesclas);

  it('é falso sem mescla e com mescla só em outras linhas', () => {
    expect(cabecalhoEstaMesclado(aba([]), 2)).toBe(false);
    expect(cabecalhoEstaMesclado(aba([{ de: 'A3', ate: 'B3' }]), 2)).toBe(false);
    expect(cabecalhoEstaMesclado(aba([{ de: 'A1', ate: 'B1' }]), 2)).toBe(false);
  });

  it('é verdadeiro quando um intervalo mesclado cobre a linha de cabeçalho', () => {
    expect(cabecalhoEstaMesclado(aba([{ de: 'A2', ate: 'B2' }]), 2)).toBe(true);
    expect(cabecalhoEstaMesclado(aba([{ de: 'B1', ate: 'B3' }]), 2)).toBe(true);
  });

  it('é verdadeiro quando a célula do cabeçalho vem marcada como mesclada', () => {
    expect(cabecalhoEstaMesclado(aba([], { A: { valorExibido: 'Código', mesclada: true }, B: 'Nome' }), 2)).toBe(true);
  });

  it('um intervalo de uma célula só não é mescla', () => {
    expect(cabecalhoEstaMesclado(aba([{ de: 'A2', ate: 'A2' }]), 2)).toBe(false);
  });
});
