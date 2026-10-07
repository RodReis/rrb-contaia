/**
 * Estado agregado do serviço Signer para o cartão geral (SPEC-012 §5.2): `Operacional`,
 * `Degradado` ou `Indisponível`. Função pura: o "agora" entra por parâmetro.
 *
 * Nunca se afirma `Operacional` sem uma verificação válida e RECENTE: sem nenhuma verificação, ou
 * com o monitor parado, o cartão diz `Degradado` e marca `desatualizado` — a tela não mente um
 * "tudo certo" que ninguém está conferindo. O incidente aberto (três falhas) vence tudo.
 */

/** Três intervalos do monitor (a cada minuto): além disso, o monitor não está mais conferindo. */
export const LIMITE_DE_DESATUALIZACAO_MS = 3 * 60_000;

export type EstadoDoServicoSigner = 'OPERACIONAL' | 'DEGRADADO' | 'INDISPONIVEL';

export type EntradaDoEstadoDoServico = Readonly<{
  ultimaVerificacaoEm: Date | null;
  ultimoResultado: 'OK' | 'FALHA' | null;
  incidenteAberto: boolean;
  agora: Date;
}>;

export const estadoDoServico = (
  entrada: EntradaDoEstadoDoServico,
): Readonly<{ estado: EstadoDoServicoSigner; desatualizado: boolean }> => {
  const idade =
    entrada.ultimaVerificacaoEm === null ? null : entrada.agora.getTime() - entrada.ultimaVerificacaoEm.getTime();
  const desatualizado = idade === null || idade > LIMITE_DE_DESATUALIZACAO_MS;

  if (entrada.incidenteAberto) {
    return { estado: 'INDISPONIVEL', desatualizado: false };
  }
  if (desatualizado || entrada.ultimoResultado !== 'OK') {
    return { estado: 'DEGRADADO', desatualizado };
  }

  return { estado: 'OPERACIONAL', desatualizado: false };
};
