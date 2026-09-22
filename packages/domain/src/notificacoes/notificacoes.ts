/**
 * Derivacao pura de notificacao a partir de causa de pendencia reconciliada
 * (SPEC-006 secao 2). Sem banco, sem relogio — o caso de uso decide quando
 * chamar e com que `agora`.
 */

export type TipoDeNotificacao =
  | 'NOVA_PENDENCIA'
  | 'DOCUMENTO_REJEITADO'
  | 'DOCUMENTO_VENCIDO'
  | 'NOVA_EXIGENCIA';

export type CausaParaNotificar = Readonly<{
  chave: string;
  tipo: TipoDeNotificacao;
}>;

const MAPA_DE_TIPO: Readonly<Record<string, TipoDeNotificacao>> = {
  CAMPO_AUSENTE: 'NOVA_PENDENCIA',
  CAMPO_INVALIDO: 'NOVA_PENDENCIA',
  DOCUMENTO_AUSENTE: 'NOVA_PENDENCIA',
  DOCUMENTO_REJEITADO: 'DOCUMENTO_REJEITADO',
  DOCUMENTO_VENCIDO: 'DOCUMENTO_VENCIDO',
  EXIGENCIA_ESPECIFICA: 'NOVA_EXIGENCIA',
};

export const tipoDeNotificacaoParaCausa = (tipoDePendencia: string): TipoDeNotificacao | null =>
  MAPA_DE_TIPO[tipoDePendencia] ?? null;
