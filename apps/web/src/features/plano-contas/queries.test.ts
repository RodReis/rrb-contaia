/**
 * Ritmo do acompanhamento da tentativa: consulta enquanto há trabalho em curso e, quando a leitura
 * falha, continua tentando com espera crescente até um teto — nunca para em silêncio.
 */
import { describe, expect, it } from 'vitest';

import { INTERVALO_DO_ACOMPANHAMENTO_MS, TETO_DO_ACOMPANHAMENTO_MS, intervaloDoAcompanhamento } from './queries';

describe('intervaloDoAcompanhamento', () => {
  it.each(['RECEBIDA', 'VALIDANDO', 'APLICANDO'] as const)('consulta a cada 2 s em %s sem falhas', (estado) => {
    expect(intervaloDoAcompanhamento(estado, 0)).toBe(INTERVALO_DO_ACOMPANHAMENTO_MS);
  });

  it('dobra a espera a cada falha seguida, até o teto', () => {
    expect(intervaloDoAcompanhamento('VALIDANDO', 1)).toBe(4_000);
    expect(intervaloDoAcompanhamento('VALIDANDO', 2)).toBe(8_000);
    expect(intervaloDoAcompanhamento('VALIDANDO', 3)).toBe(16_000);
    expect(intervaloDoAcompanhamento('VALIDANDO', 4)).toBe(TETO_DO_ACOMPANHAMENTO_MS);
    expect(intervaloDoAcompanhamento('APLICANDO', 50)).toBe(TETO_DO_ACOMPANHAMENTO_MS);
  });

  it.each(['AGUARDANDO_CONFIRMACAO', 'CONCLUIDA', 'FALHA', 'CANCELADA'] as const)('não consulta em %s', (estado) => {
    expect(intervaloDoAcompanhamento(estado, 0)).toBe(false);
    expect(intervaloDoAcompanhamento(estado, 3)).toBe(false);
  });

  it('não consulta sem dado lido', () => {
    expect(intervaloDoAcompanhamento(undefined, 2)).toBe(false);
  });
});
