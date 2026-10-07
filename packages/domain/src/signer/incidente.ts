/**
 * Monitor de saúde do Signer e incidentes (SPEC-012 §3.10).
 *
 * Função pura: recebe o estado do monitor e o resultado de uma verificação (a
 * cada minuto) e devolve o próximo estado mais os efeitos que o chamador deve
 * executar. Três falhas consecutivas abrem UM incidente; novas falhas não o
 * duplicam; a primeira verificação válida o encerra e registra a duração.
 */

export const LIMITE_DE_FALHAS_PARA_INCIDENTE = 3;

export type EstadoDoMonitor = Readonly<{
  falhasConsecutivas: number;
  incidenteAbertoEm: Date | null;
}>;

export const MONITOR_INICIAL: EstadoDoMonitor = { falhasConsecutivas: 0, incidenteAbertoEm: null };

export type EfeitoDoMonitor =
  | Readonly<{ tipo: 'ABRIR_INCIDENTE' }>
  | Readonly<{ tipo: 'NOTIFICAR_INDISPONIBILIDADE' }>
  | Readonly<{ tipo: 'ENCERRAR_INCIDENTE'; duracaoMs: number }>
  | Readonly<{ tipo: 'NOTIFICAR_RECUPERACAO'; duracaoMs: number }>;

export type TransicaoDoMonitor = Readonly<{
  proximo: EstadoDoMonitor;
  efeitos: readonly EfeitoDoMonitor[];
}>;

export const avancarIncidente = (
  atual: EstadoDoMonitor,
  verificacao: 'OK' | 'FALHA',
  agora: Date,
): TransicaoDoMonitor => {
  if (verificacao === 'OK') {
    if (atual.incidenteAbertoEm === null) {
      return { proximo: MONITOR_INICIAL, efeitos: [] };
    }
    const duracaoMs = agora.getTime() - atual.incidenteAbertoEm.getTime();

    return {
      proximo: MONITOR_INICIAL,
      efeitos: [
        { tipo: 'ENCERRAR_INCIDENTE', duracaoMs },
        { tipo: 'NOTIFICAR_RECUPERACAO', duracaoMs },
      ],
    };
  }

  const falhasConsecutivas = atual.falhasConsecutivas + 1;
  const abreAgora =
    atual.incidenteAbertoEm === null && falhasConsecutivas >= LIMITE_DE_FALHAS_PARA_INCIDENTE;

  if (abreAgora) {
    return {
      proximo: { falhasConsecutivas, incidenteAbertoEm: agora },
      efeitos: [{ tipo: 'ABRIR_INCIDENTE' }, { tipo: 'NOTIFICAR_INDISPONIBILIDADE' }],
    };
  }

  return { proximo: { ...atual, falhasConsecutivas }, efeitos: [] };
};
