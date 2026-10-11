import { describe, expect, it } from 'vitest';

import { CODIGOS_DE_DIAGNOSTICO_DE_PLANILHA, diagnosticosDaTabela } from './diagnosticos.js';
import type { ResultadoTabular } from './tipos.js';

const resultado = (parcial: Partial<ResultadoTabular> = {}): ResultadoTabular => ({
  cabecalho: ['A'],
  registros: [],
  ignoradasAntesDoCabecalho: 0,
  ocultas: 0,
  cabecalhoMesclado: false,
  rejeicoesEstruturaisPorLinha: new Map(),
  ...parcial,
});

describe('diagnosticosDaTabela', () => {
  it('não gera diagnóstico quando nada aconteceu', () => {
    expect(diagnosticosDaTabela(resultado())).toEqual([]);
  });

  it('informa linhas ignoradas, ocultas processadas e rejeições por fórmula e por mescla, com quantidade', () => {
    const diagnosticos = diagnosticosDaTabela(
      resultado({
        ignoradasAntesDoCabecalho: 3,
        ocultas: 2,
        rejeicoesEstruturaisPorLinha: new Map([
          [5, { codigo: 'CELULA_COM_FORMULA', letra: 'A' }],
          [6, { codigo: 'CELULA_COM_FORMULA', letra: 'B' }],
          [9, { codigo: 'CELULA_MESCLADA', letra: 'A' }],
        ]),
      }),
    );

    expect(diagnosticos.map((d) => [d.codigo, d.quantidade])).toEqual([
      ['LINHAS_ANTERIORES_AO_CABECALHO_IGNORADAS', 3],
      ['LINHAS_OCULTAS_PROCESSADAS', 2],
      ['LINHAS_COM_FORMULA_REJEITADAS', 2],
      ['LINHAS_COM_CELULA_MESCLADA_REJEITADAS', 1],
    ]);
    for (const diagnostico of diagnosticos) {
      expect(CODIGOS_DE_DIAGNOSTICO_DE_PLANILHA).toContain(diagnostico.codigo);
      expect(diagnostico.mensagem.length).toBeGreaterThan(10);
      expect(diagnostico.mensagem).not.toMatch(/\d/u); // a quantidade vai à parte; a mensagem é fixa
    }
  });
});
