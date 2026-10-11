import { describe, expect, it } from 'vitest';

import {
  amostraDaAba,
  cabecalhoEstaMesclado,
  conferirCabecalho,
  resumoDaAba,
  rotulosDasColunas,
  sugerirLinhaDeCabecalho,
} from './cabecalho.js';
import { LIMITE_DE_TEXTO_DA_INSPECAO, LIMITE_DO_ROTULO_DA_COLUNA } from './texto.js';
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

describe('resumoDaAba', () => {
  it('conta, sem precisar de mapeamento, o que a inspeção mostra antes do envio', () => {
    const aba = leitura(
      [
        linha(1, { A: 'Título' }),
        linha(2, { A: 'Código', B: 'Nome' }),
        linha(3, { A: '1', B: 'Ativo' }, true),
        linha(4, { A: '' }),
        linha(5, { A: '2', B: 'Caixa' }),
        linha(6, { A: '3', B: 'Banco' }, true),
      ],
      [{ de: 'A2', ate: 'A3' }],
    );

    expect(resumoDaAba(aba, 2)).toEqual({
      ignoradasAntesDoCabecalho: 1,
      linhasDeDados: 3,
      ocultas: 2,
      cabecalhoMesclado: true,
    });
  });
});

describe('amostraDaAba', () => {
  it('devolve as primeiras linhas com conteúdo, só com as células preenchidas, em valor exibido', () => {
    const aba = leitura([
      linha(7, { A: 'sétima' }),
      linha(2, { A: 'Código', B: '', C: 'Nome' }, true),
      linha(4, { A: '   ' }),
      linha(3, { A: { valorExibido: '00123', tipoNativo: 'numero' } }),
    ]);

    expect(amostraDaAba(aba, 3)).toEqual([
      { numero: 2, oculta: true, celulas: { A: 'Código', C: 'Nome' } },
      { numero: 3, oculta: false, celulas: { A: '00123' } },
      { numero: 7, oculta: false, celulas: { A: 'sétima' } },
    ]);
    expect(amostraDaAba(aba, 2).map((l) => l.numero)).toEqual([2, 3]);
  });
});

describe('textos longos (uma célula do Excel chega a 32.767 caracteres)', () => {
  const LONGO = 32_767;
  const emojiNaFronteira = `${'a'.repeat(LIMITE_DE_TEXTO_DA_INSPECAO - 2)}${'😀'.repeat(10)}`;

  it('rotulosDasColunas trunca nome e rótulo no limite e mantém a letra sempre presente', () => {
    const aba = leitura([linha(1, { A: 'x'.repeat(LONGO), B: emojiNaFronteira, AB: 'curto' })]);

    const rotulos = rotulosDasColunas(aba, 1);
    const a = rotulos[0]!;
    const b = rotulos[1]!;

    expect(a.nome!.length).toBeLessThanOrEqual(LIMITE_DE_TEXTO_DA_INSPECAO);
    expect(a.nome!.endsWith('…')).toBe(true);
    expect(a.rotulo.startsWith('Coluna A — ')).toBe(true);
    expect(a.rotulo.length).toBeLessThanOrEqual(LIMITE_DO_ROTULO_DA_COLUNA);
    expect(b.rotulo.startsWith('Coluna B — ')).toBe(true);
    expect(b.nome!.length).toBeLessThanOrEqual(LIMITE_DE_TEXTO_DA_INSPECAO);
    expect(b.nome).not.toMatch(/[\ud800-\udbff]…$/u); // nunca um par partido antes das reticências
    expect(rotulos.at(-1)).toEqual({ letra: 'AB', nome: 'curto', rotulo: 'Coluna AB — curto' });
  });

  it('dois cabeçalhos longos idênticos seguem distintos pela letra', () => {
    const aba = leitura([linha(1, { A: 'y'.repeat(LONGO), B: 'y'.repeat(LONGO) })]);

    const [a, b] = rotulosDasColunas(aba, 1);

    expect(a!.rotulo).not.toBe(b!.rotulo);
  });

  it('amostraDaAba trunca cada célula no limite', () => {
    const aba = leitura([linha(1, { A: 'z'.repeat(LONGO), B: emojiNaFronteira, C: 'curto' })]);

    const [primeira] = amostraDaAba(aba);

    expect(primeira!.celulas.A!.length).toBeLessThanOrEqual(LIMITE_DE_TEXTO_DA_INSPECAO);
    expect(primeira!.celulas.A!.endsWith('…')).toBe(true);
    expect(primeira!.celulas.B!.length).toBeLessThanOrEqual(LIMITE_DE_TEXTO_DA_INSPECAO);
    expect(primeira!.celulas.C).toBe('curto');
  });
});

describe('conferirCabecalho (mesma regra no envio da API e na validação do worker)', () => {
  it('aba sem linhas → ABA_SEM_DADOS', () => {
    expect(conferirCabecalho(leitura([]), 1)).toEqual({ ok: false, codigo: 'ABA_SEM_DADOS' });
  });

  it('linha de cabeçalho em branco ou inexistente → CABECALHO_INVALIDO', () => {
    const aba = leitura([linha(1, { A: '  ' }), linha(2, { A: 'Código' })]);

    expect(conferirCabecalho(aba, 1)).toEqual({ ok: false, codigo: 'CABECALHO_INVALIDO' });
    expect(conferirCabecalho(aba, 7)).toEqual({ ok: false, codigo: 'CABECALHO_INVALIDO' });
  });

  it('cabeçalho com célula mesclada (mapeada ou não) → CABECALHO_MESCLADO', () => {
    const aba = leitura([linha(1, { A: 'Código', B: 'Nome', D: 'Obs' }), linha(2, { A: '1' })], [{ de: 'C1', ate: 'D1' }]);

    expect(conferirCabecalho(aba, 1)).toEqual({ ok: false, codigo: 'CABECALHO_MESCLADO' });
  });

  it('cabeçalho utilizável → as letras de A até a última preenchida (vazias no meio inclusas)', () => {
    const aba = leitura([linha(2, { A: 'Título' }), linha(3, { A: 'Código', C: 'Nome' }), linha(4, { A: '1', C: 'Ativo' })]);

    expect(conferirCabecalho(aba, 3)).toEqual({ ok: true, letras: ['A', 'B', 'C'] });
  });
});
