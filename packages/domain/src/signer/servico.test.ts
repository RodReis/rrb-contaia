import { describe, expect, it } from 'vitest';

import { LIMITE_DE_DESATUALIZACAO_MS, estadoDoServico } from './servico.js';

const AGORA = new Date('2026-10-07T12:00:00.000Z');
const haMinutos = (n: number): Date => new Date(AGORA.getTime() - n * 60_000);

describe('estado agregado do serviço Signer para o cartão (SPEC-012 §5.2)', () => {
  it('incidente aberto é indisponível, mesmo que a última verificação tenha sido boa', () => {
    expect(estadoDoServico({ ultimaVerificacaoEm: haMinutos(0), ultimoResultado: 'OK', incidenteAberto: true, agora: AGORA })).toEqual({
      estado: 'INDISPONIVEL',
      desatualizado: false,
    });
  });

  it('última verificação válida e recente é operacional', () => {
    expect(estadoDoServico({ ultimaVerificacaoEm: haMinutos(1), ultimoResultado: 'OK', incidenteAberto: false, agora: AGORA })).toEqual({
      estado: 'OPERACIONAL',
      desatualizado: false,
    });
  });

  it('o Signer respondeu, mas se disse degradado (ex.: Vault selado): o cartão não afirma operacional', () => {
    expect(
      estadoDoServico({
        ultimaVerificacaoEm: haMinutos(0),
        ultimoResultado: 'OK',
        ultimoDegradado: true,
        incidenteAberto: false,
        agora: AGORA,
      }),
    ).toEqual({ estado: 'DEGRADADO', desatualizado: false });
  });

  it('falha recente ainda sem incidente (menos de três) é degradado', () => {
    expect(estadoDoServico({ ultimaVerificacaoEm: haMinutos(0), ultimoResultado: 'FALHA', incidenteAberto: false, agora: AGORA })).toEqual({
      estado: 'DEGRADADO',
      desatualizado: false,
    });
  });

  it('sem nenhuma verificação não se afirma operacional: degradado e desatualizado', () => {
    expect(estadoDoServico({ ultimaVerificacaoEm: null, ultimoResultado: null, incidenteAberto: false, agora: AGORA })).toEqual({
      estado: 'DEGRADADO',
      desatualizado: true,
    });
  });

  it('o monitor parado (verificação velha) também não afirma operacional', () => {
    const velha = new Date(AGORA.getTime() - LIMITE_DE_DESATUALIZACAO_MS - 1_000);

    expect(estadoDoServico({ ultimaVerificacaoEm: velha, ultimoResultado: 'OK', incidenteAberto: false, agora: AGORA })).toEqual({
      estado: 'DEGRADADO',
      desatualizado: true,
    });
  });

  it('a verificação no limite exato da janela ainda vale', () => {
    const noLimite = new Date(AGORA.getTime() - LIMITE_DE_DESATUALIZACAO_MS);

    expect(estadoDoServico({ ultimaVerificacaoEm: noLimite, ultimoResultado: 'OK', incidenteAberto: false, agora: AGORA }).estado).toBe(
      'OPERACIONAL',
    );
  });

  it('incidente aberto vence o desatualizado: o aviso mais grave é o que aparece', () => {
    expect(estadoDoServico({ ultimaVerificacaoEm: haMinutos(30), ultimoResultado: 'FALHA', incidenteAberto: true, agora: AGORA }).estado).toBe(
      'INDISPONIVEL',
    );
  });
});
