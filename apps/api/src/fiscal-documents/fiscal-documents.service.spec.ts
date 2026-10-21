import { describe, expect, it } from 'vitest';
import {
  statusDevolucaoTransferenciaPeloCfop,
  statusImportacaoPeloCfop,
  statusMonofasicoPelosCst,
  statusStContribuicoesPelosCst,
  statusBeneficioPeloCBenef,
} from './fiscal-documents.service';
import { settlementCoverageBlocksReview } from './icms-st-settlements.service';

describe('indicadores fiscais derivados com cautela da NF-e', () => {
  it('classifica importação pelo grupo CFOP 3 e deixa código ausente desconhecido', () => {
    expect(statusImportacaoPeloCfop('3102')).toBe(true);
    expect(statusImportacaoPeloCfop('1102')).toBe(false);
    expect(statusImportacaoPeloCfop(null)).toBeNull();
  });

  it('distingue CST monofásico 04 de substituição de contribuição CST 05', () => {
    expect(statusMonofasicoPelosCst([{ codigo: 'PIS', situacao: '04' }])).toBe(true);
    expect(statusMonofasicoPelosCst([{ codigo: 'PIS', situacao: '05' }])).toBeNull();
    expect(statusStContribuicoesPelosCst([{ codigo: 'COFINS', situacao: '05' }])).toBe(true);
  });

  it('só conclui ausência de CST especial quando PIS e COFINS estão presentes', () => {
    expect(statusMonofasicoPelosCst([
      { codigo: 'PIS', situacao: '01' }, { codigo: 'COFINS', situacao: '01' },
    ])).toBe(false);
    expect(statusMonofasicoPelosCst([{ codigo: 'PIS', situacao: '01' }])).toBeNull();
  });

  it('marca CFOP conhecido de devolução e mantém CFOP de compra comum como não devolução', () => {
    expect(statusDevolucaoTransferenciaPeloCfop('1202')).toBe(true);
    expect(statusDevolucaoTransferenciaPeloCfop('1102')).toBe(false);
    expect(statusDevolucaoTransferenciaPeloCfop(null)).toBeNull();
  });

  it('não confunde o literal SEM CBENEF com código de benefício declarado', () => {
    expect(statusBeneficioPeloCBenef('GO800001')).toBe(true);
    expect(statusBeneficioPeloCBenef(' SEM CBENEF ')).toBeNull();
    expect(statusBeneficioPeloCBenef(null)).toBeNull();
  });
});

describe('bloqueios de revisão fiscal F29', () => {
  it('mantém a submissão bloqueada enquanto houver cobertura ausente no snapshot', () => {
    expect(settlementCoverageBlocksReview({ blockingReasonCodes: ['OFFICIAL_LAYOUT_UNAVAILABLE'] })).toBe(true);
    expect(settlementCoverageBlocksReview({ blockingReasonCodes: [] })).toBe(false);
    expect(settlementCoverageBlocksReview(null)).toBe(false);
  });
});
