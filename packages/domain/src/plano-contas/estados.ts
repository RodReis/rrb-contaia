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

const TRANSICOES = new Map<EstadoDaImportacao, Map<EventoDaImportacao, EstadoDaImportacao>>([
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

const ehEstadoTerminal = (estado: EstadoDaImportacao): boolean => ESTADOS_TERMINAIS.includes(estado);

/**
 * O evento é aceito no estado atual? Estado terminal não transiciona. O repositório usa esta regra
 * antes de levar a tentativa a FALHA; as demais transições são UPDATEs condicionais no banco.
 */
export const podeTransicionar = (estado: EstadoDaImportacao, evento: EventoDaImportacao): boolean => {
  if (ehEstadoTerminal(estado)) return false;
  const eventos = TRANSICOES.get(estado);
  return eventos?.has(evento) ?? false;
};