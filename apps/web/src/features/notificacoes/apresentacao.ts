/**
 * Como cada notificação aparece no sino e no histórico (SPEC-006, SPEC-009 §3.6).
 *
 * A notificação de pendência nomeia a empresa e leva à Central de Pendências. O
 * aviso consolidado de carteira não tem empresa: resume, numa linha só, o que
 * entrou e o que saiu da carteira naquela operação e leva à própria carteira.
 */
import { plural, resumirEmpresas } from '../carteira/rotulos';
import type { Notificacao } from './api';

const RESUMO_POR_TIPO: Readonly<Record<string, string>> = {
  NOVA_PENDENCIA: 'Nova pendência',
  DOCUMENTO_REJEITADO: 'Documento rejeitado',
  DOCUMENTO_VENCIDO: 'Documento vencido',
  NOVA_EXIGENCIA: 'Nova exigência',
  CARTEIRA_ALTERADA: 'Carteira atualizada',
};

export const ehAvisoDeCarteira = (notificacao: Notificacao): boolean =>
  notificacao.tipo === 'CARTEIRA_ALTERADA';

export const tituloDaNotificacao = (notificacao: Notificacao): string =>
  ehAvisoDeCarteira(notificacao) ? 'Sua carteira foi atualizada' : (notificacao.empresaNome ?? '');

export const tipoDaNotificacao = (notificacao: Notificacao): string =>
  RESUMO_POR_TIPO[notificacao.tipo] ?? notificacao.tipo;

/** Linha de apoio do aviso de carteira: o efeito, com nomes e contagem. */
export const resumoDaCarteira = (notificacao: Notificacao): string => {
  const adicionadas = notificacao.adicionadas ?? [];
  const removidas = notificacao.removidas ?? [];
  const partes: string[] = [];

  if (adicionadas.length > 0) {
    partes.push(
      `${plural(adicionadas.length, 'empresa adicionada', 'empresas adicionadas')}: ${resumirEmpresas(adicionadas)}`,
    );
  }
  if (removidas.length > 0) {
    partes.push(
      `${plural(removidas.length, 'empresa removida', 'empresas removidas')}: ${resumirEmpresas(removidas)}`,
    );
  }

  return partes.join(' · ');
};

export const rotaDaNotificacao = (notificacao: Notificacao): string =>
  ehAvisoDeCarteira(notificacao)
    ? '/carteira'
    : `/pendencias?empresaId=${notificacao.empresaId ?? ''}`;
