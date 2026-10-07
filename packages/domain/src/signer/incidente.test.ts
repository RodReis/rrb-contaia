import { describe, expect, it } from 'vitest';

import {
  LIMITE_DE_FALHAS_PARA_INCIDENTE,
  MONITOR_INICIAL,
  avancarIncidente,
  type EstadoDoMonitor,
} from './incidente.js';

const T0 = new Date('2026-10-07T10:00:00.000Z');
const minutos = (n: number): Date => new Date(T0.getTime() + n * 60_000);

const aplicar = (
  estado: EstadoDoMonitor,
  verificacoes: readonly ('OK' | 'FALHA')[],
): { estado: EstadoDoMonitor; efeitos: string[] } => {
  const efeitos: string[] = [];
  let atual = estado;
  verificacoes.forEach((verificacao, indice) => {
    const transicao = avancarIncidente(atual, verificacao, minutos(indice));
    atual = transicao.proximo;
    efeitos.push(...transicao.efeitos.map((efeito) => efeito.tipo));
  });
  return { estado: atual, efeitos };
};

describe('monitor de saúde do Signer (SPEC-012 §3.10)', () => {
  it('o limite é de três falhas consecutivas', () => {
    expect(LIMITE_DE_FALHAS_PARA_INCIDENTE).toBe(3);
  });

  it('duas falhas não abrem incidente', () => {
    const { estado, efeitos } = aplicar(MONITOR_INICIAL, ['FALHA', 'FALHA']);

    expect(efeitos).toEqual([]);
    expect(estado.incidenteAbertoEm).toBeNull();
    expect(estado.falhasConsecutivas).toBe(2);
  });

  it('a terceira falha abre um incidente e notifica a indisponibilidade uma única vez', () => {
    const { estado, efeitos } = aplicar(MONITOR_INICIAL, ['FALHA', 'FALHA', 'FALHA']);

    expect(efeitos).toEqual(['ABRIR_INCIDENTE', 'NOTIFICAR_INDISPONIBILIDADE']);
    expect(estado.incidenteAbertoEm).toEqual(minutos(2));
  });

  it('novas falhas do mesmo incidente não duplicam notificação', () => {
    const { efeitos } = aplicar(MONITOR_INICIAL, ['FALHA', 'FALHA', 'FALHA', 'FALHA', 'FALHA']);

    expect(efeitos).toEqual(['ABRIR_INCIDENTE', 'NOTIFICAR_INDISPONIBILIDADE']);
  });

  it('uma verificação válida zera a contagem antes de abrir incidente', () => {
    const { estado, efeitos } = aplicar(MONITOR_INICIAL, ['FALHA', 'FALHA', 'OK', 'FALHA', 'FALHA']);

    expect(efeitos).toEqual([]);
    expect(estado.falhasConsecutivas).toBe(2);
  });

  it('a primeira verificação válida encerra o incidente e notifica a recuperação com a duração', () => {
    const aberto = aplicar(MONITOR_INICIAL, ['FALHA', 'FALHA', 'FALHA']).estado;

    const transicao = avancarIncidente(aberto, 'OK', minutos(7));

    expect(transicao.efeitos).toEqual([
      { tipo: 'ENCERRAR_INCIDENTE', duracaoMs: 5 * 60_000 },
      { tipo: 'NOTIFICAR_RECUPERACAO', duracaoMs: 5 * 60_000 },
    ]);
    expect(transicao.proximo).toEqual(MONITOR_INICIAL);
  });

  it('verificação válida sem incidente aberto não gera efeito', () => {
    expect(avancarIncidente(MONITOR_INICIAL, 'OK', T0)).toEqual({ proximo: MONITOR_INICIAL, efeitos: [] });
  });

  it('um novo incidente depois da recuperação volta a notificar', () => {
    const { efeitos } = aplicar(MONITOR_INICIAL, [
      'FALHA', 'FALHA', 'FALHA', 'OK', 'FALHA', 'FALHA', 'FALHA',
    ]);

    expect(efeitos).toEqual([
      'ABRIR_INCIDENTE', 'NOTIFICAR_INDISPONIBILIDADE',
      'ENCERRAR_INCIDENTE', 'NOTIFICAR_RECUPERACAO',
      'ABRIR_INCIDENTE', 'NOTIFICAR_INDISPONIBILIDADE',
    ]);
  });
});
