import { describe, expect, it } from 'vitest';

import { projetarSaudeEmpresa, type SinalDeSaude } from './saude-empresa.js';

const sinal = (overrides: Partial<SinalDeSaude> = {}): SinalDeSaude => ({
  fonte: 'PENDENCIAS',
  codigo: 'PENDENCIA_ABERTA',
  gravidade: 'AMARELO',
  origemId: 'origem-1',
  descricao: 'Pendência cadastral aberta',
  dataReferencia: null,
  atualizadoEm: new Date('2026-10-17T12:00:00Z'),
  ...overrides,
});

describe('projetarSaudeEmpresa', () => {
  it('mantém todos os motivos e prioriza vermelho sobre amarelo', () => {
    const resultado = projetarSaudeEmpresa({
      sinais: [sinal(), sinal({ fonte: 'OBRIGACOES', codigo: 'OBRIGACAO_VENCIDA', gravidade: 'VERMELHO', origemId: 'origem-2' })],
      fontesIncompletas: [],
    });

    expect(resultado.cor).toBe('VERMELHO');
    expect(resultado.motivos).toHaveLength(2);
    expect(resultado.motivoPrioritario?.codigo).toBe('OBRIGACAO_VENCIDA');
  });

  it('não duplica sinais com a mesma fonte e referência opaca', () => {
    const motivo = sinal();
    const resultado = projetarSaudeEmpresa({ sinais: [motivo, motivo], fontesIncompletas: [] });

    expect(resultado.motivos).toHaveLength(1);
  });

  it('impede verde quando qualquer fonte está incompleta', () => {
    const resultado = projetarSaudeEmpresa({ sinais: [], fontesIncompletas: ['CERTIFICADOS'] });

    expect(resultado.cor).toBe('AMARELO');
    expect(resultado.motivos).toEqual([
      expect.objectContaining({ fonte: 'CERTIFICADOS', codigo: 'FONTE_INCOMPLETA', gravidade: 'AMARELO' }),
    ]);
  });

  it('retorna verde somente sem sinais e sem fontes incompletas', () => {
    expect(projetarSaudeEmpresa({ sinais: [], fontesIncompletas: [] })).toMatchObject({ cor: 'VERDE', motivos: [] });
  });
});
