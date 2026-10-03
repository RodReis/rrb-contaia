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

/** Alertas de vencimento do cofre (SPEC-011 §3.6): rótulo por marco, com fallback para marco novo. */
const RESUMO_DO_CERTIFICADO: Readonly<Record<string, string>> = {
  CERTIFICADO_D30: 'Certificado vence em 30 dias',
  CERTIFICADO_D15: 'Certificado vence em 15 dias',
  CERTIFICADO_D7: 'Certificado vence em 7 dias',
  CERTIFICADO_VENCIDO: 'Certificado vencido',
  CERTIFICADO_RESPONSAVEL_INCONSISTENTE: 'Certificado sem responsável ativo',
};

const RESUMO_GENERICO_DO_CERTIFICADO = 'Certificado digital';

export const ehAvisoDeCarteira = (notificacao: Notificacao): boolean =>
  notificacao.tipo === 'CARTEIRA_ALTERADA';

export const ehAvisoDeCertificado = (notificacao: Notificacao): boolean =>
  notificacao.tipo.startsWith('CERTIFICADO_');

export const tituloDaNotificacao = (notificacao: Notificacao): string =>
  ehAvisoDeCarteira(notificacao) ? 'Sua carteira foi atualizada' : (notificacao.empresaNome ?? '');

export const tipoDaNotificacao = (notificacao: Notificacao): string =>
  ehAvisoDeCertificado(notificacao)
    ? (RESUMO_DO_CERTIFICADO[notificacao.tipo] ?? RESUMO_GENERICO_DO_CERTIFICADO)
    : (RESUMO_POR_TIPO[notificacao.tipo] ?? notificacao.tipo);

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

/**
 * Cada aviso abre o lugar onde a pessoa age: a carteira, o registro da empresa no
 * cofre (que sempre mostra o estado de agora, mesmo depois de lida a notificação) ou
 * as pendências da empresa.
 */
export const rotaDaNotificacao = (notificacao: Notificacao): string => {
  if (ehAvisoDeCarteira(notificacao)) {
    return '/carteira';
  }

  if (ehAvisoDeCertificado(notificacao)) {
    return `/configuracoes/cofre?empresa=${notificacao.empresaId ?? ''}`;
  }

  return `/pendencias?empresaId=${notificacao.empresaId ?? ''}`;
};
