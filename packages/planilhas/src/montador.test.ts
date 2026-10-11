/** O montador de planilhas por linhas (subpath de testes) gera o MESMO conteúdo em XLSX e ODS. */
import { describe, expect, it } from 'vitest';

import { lerAba } from './ler-aba.ts';
import { planilhaOds, planilhaXlsx, type AbaDeTeste } from './testes/montador.ts';

const ABA: AbaDeTeste = {
  nome: 'Dados',
  linhas: [
    { numero: 1, valores: ['Título'] },
    { numero: 3, valores: ['a', 'b', 'c'] },
    { numero: 4, valores: ['1', 'x', ''], oculta: true },
    { numero: 5, valores: ['2', 'y', 'z'], formulaEm: 'B' },
    { numero: 6, valores: ['3', 'w', ''] },
    { numero: 7, valores: ['4', '', ''] },
  ],
  mesclas: ['B6:C7'],
};

const resumo = (bytes: Uint8Array) => {
  const leitura = lerAba(bytes, 1);
  return leitura.linhas.map((linha) => ({
    numero: linha.numero,
    oculta: linha.oculta,
    celulas: Object.fromEntries(
      Object.entries(linha.celulas)
        .filter(([, c]) => c.valorExibido !== '' || c.formula || c.mesclada)
        .map(([letra, c]) => [letra, `${c.valorExibido}${c.formula ? '=' : ''}`]),
    ),
  }));
};

describe('montador de planilhas de teste', () => {
  it('XLSX e ODS saem com as mesmas linhas, ocultas, fórmulas e a mescla reconhecida pelo leitor', () => {
    const xlsx = lerAba(planilhaXlsx(ABA), 1);
    const ods = lerAba(planilhaOds(ABA), 1);

    expect(resumo(planilhaXlsx(ABA))).toEqual(resumo(planilhaOds(ABA)));
    expect(xlsx.totalDeLinhasOcultas).toBe(1);
    expect(ods.totalDeLinhasOcultas).toBe(1);
    expect(xlsx.mesclas).toEqual([{ de: 'B6', ate: 'C7' }]);
    expect(ods.mesclas).toEqual([{ de: 'B6', ate: 'C7' }]);
    expect(ods.linhas.find((l) => l.numero === 5)?.celulas['B']).toMatchObject({ valorExibido: 'y', formula: true });
  });
});
