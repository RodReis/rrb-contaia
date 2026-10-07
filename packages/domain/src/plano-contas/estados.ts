/**
 * Estados da importação do plano de contas (SPEC-013 §3.11, I-7, I-9).
 *
 * RECEBIDA
 *   └─▶ VALIDANDO
 *        ├─▶ AGUARDANDO_CONFIRMACAO
 *        │    ├─▶ APLICANDO ──▶ CONCLUIDA | CONCLUIDA_COM_REJEICOES | FALHA
 *        │    └─▶ CANCELADA
 *        ├─▶ REJEITADA
 *        └─▶ FALHA
 *
 * Estados terminais: CONCLUIDA, CONCLUIDA_COM_REJEICOES, REJEITADA, CANCELADA, FALHA.
 * Estados terminais não são reabertos nem apagados. Nova correção gera nova tentativa.
 */

export type EstadoDaImportacao =
  | 'RECEBIDA'
  | 'VALIDANDO'
  | 'AGUARDANDO_CONFIRMACAO'
  | 'APLICANDO'
  | 'CONCLUIDA'
  | 'CONCLUIDA_COM_REJEICOES'
  | 'REJEITADA'
  | 'CANCELADA'
  | 'FALHA';

export type EventoDaImportacao =
  | 'INICIAR_VALIDACAO'
  | 'VALIDACAO_SUCESSO'
  | 'VALIDACAO_REJEITADA'
  | 'FALHA_TECNICA'
  | 'CONFIRMAR'
  | 'CANCELAR'
  | 'APLICACAO_SUCESSO'
  | 'APLICACAO_SUCESSO_COM_REJEICOES';

export interface TransicaoInvalida {
  readonly codigo: 'ESTADO_TERMINAL_NAO_TRANSICIONA' | 'TRANSICAO_INVALIDA';
  readonly estadoAtual: EstadoDaImportacao;
  readonly evento: string;
}

type ProximoEstado = EstadoDaImportacao | TransicaoInvalida;

const TRANSICOES: ReadonlyMap<EstadoDaImportacao, ReadonlyMap<EventoDaImportacao, EstadoDaImportacao>> = new Map([
  ['RECEBIDA', new Map([['INICIAR_VALIDACAO', 'VALIDANDO']])],
  [
    'VALIDANDO',
    new Map([
      ['VALIDACAO_SUCESSO', 'AGUARDANDO_CONFIRMACAO'],
      ['VALIDACAO_REJEITADA', 'REJEITADA'],
      ['FALHA_TECNICA', 'FALHA'],
    ]),
  ],
  [
    'AGUARDANDO_CONFIRMACAO',
    new Map([
      ['CONFIRMAR', 'APLICANDO'],
      ['CANCELAR', 'CANCELADA'],
    ]),
  ],
  [
    'APLICANDO',
    new Map([
      ['APLICACAO_SUCESSO', 'CONCLUIDA'],
      ['APLICACAO_SUCESSO_COM_REJEICOES', 'CONCLUIDA_COM_REJEICOES'],
      ['FALHA_TECNICA', 'FALHA'],
    ]),
  ],
]);

const ESTADOS_TERMINAIS: readonly EstadoDaImportacao[] = [
  'CONCLUIDA',
  'CONCLUIDA_COM_REJEICOES',
  'REJEITADA',
  'CANCELADA',
  'FALHA',
];

export const ehEstadoTerminal = (estado: EstadoDaImportacao): boolean =>
  ESTADOS_TERMINAIS.includes(estado);

export const proximoEstado = (estado: EstadoDaImportacao, evento: EventoDaImportacao | string): ProximoEstado => {
  if (ehEstadoTerminal(estado)) {
    return { codigo: 'ESTADO_TERMINAL_NAO_TRANSICIONA', estadoAtual: estado, evento };
  }
  const eventos = TRANSICOES.get(estado);
  if (!eventos) {
    return { codigo: 'TRANSICAO_INVALIDA', estadoAtual: estado, evento };
  }
  const proximo = eventos.get(evento as EventoDaImportacao);
  if (!proximo) {
    return { codigo: 'TRANSICAO_INVALIDA', estadoAtual: estado, evento };
  }
  return proximo;
};

export const podeTransicionar = (estado: EstadoDaImportacao, evento: EventoDaImportacao): boolean => {
  if (ehEstadoTerminal(estado)) return false;
  const eventos = TRANSICOES.get(estado);
  return eventos?.has(evento) ?? false;
};