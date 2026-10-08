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

/** Incidente do Signer (SPEC-012 §3.10): serviço global, sem empresa. */
export const ehAvisoDoSigner = (notificacao: Notificacao): boolean =>
  notificacao.tipo === 'SIGNER_INDISPONIVEL' || notificacao.tipo === 'SIGNER_RECUPERADO';

const RESUMO_DO_SIGNER: Readonly<Record<string, string>> = {
  SIGNER_INDISPONIVEL: 'Signer indisponível',
  SIGNER_RECUPERADO: 'Signer recuperado',
};

/** Fim da importação do plano de contas (SPEC-013 §3.10): da empresa, só do iniciador. */
export const ehAvisoDeImportacao = (notificacao: Notificacao): boolean =>
  notificacao.tipo === 'IMPORTACAO_PLANO_CONTAS_CONCLUIDA';

const RESUMO_DA_IMPORTACAO: Readonly<Record<string, string>> = {
  CONCLUIDA: 'Importação do plano de contas concluída',
  CONCLUIDA_COM_REJEICOES: 'Importação do plano de contas concluída com rejeições',
  REJEITADA: 'Importação do plano de contas rejeitada',
  FALHA: 'Importação do plano de contas com falha',
};

const RESUMO_GENERICO_DA_IMPORTACAO = 'Importação do plano de contas';

export const tituloDaNotificacao = (notificacao: Notificacao): string => {
  if (ehAvisoDeCarteira(notificacao)) {
    return 'Sua carteira foi atualizada';
  }

  return ehAvisoDoSigner(notificacao) ? 'Microserviço Signer' : (notificacao.empresaNome ?? '');
};

export const tipoDaNotificacao = (notificacao: Notificacao): string => {
  if (ehAvisoDeImportacao(notificacao)) {
    return RESUMO_DA_IMPORTACAO[notificacao.importacao?.estado ?? ''] ?? RESUMO_GENERICO_DA_IMPORTACAO;
  }

  if (ehAvisoDoSigner(notificacao)) {
    return RESUMO_DO_SIGNER[notificacao.tipo] ?? notificacao.tipo;
  }

  return ehAvisoDeCertificado(notificacao)
    ? (RESUMO_DO_CERTIFICADO[notificacao.tipo] ?? RESUMO_GENERICO_DO_CERTIFICADO)
    : (RESUMO_POR_TIPO[notificacao.tipo] ?? notificacao.tipo);
};

/** `65 min` → `1 h 5 min`; menos de um minuto não vira `0 min`. */
const duracaoEmTexto = (milissegundos: number): string => {
  const minutos = Math.floor(milissegundos / 60_000);

  if (minutos < 1) {
    return 'menos de 1 min';
  }

  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;

  if (horas === 0) {
    return `${minutos} min`;
  }

  return resto === 0 ? `${horas} h` : `${horas} h ${resto} min`;
};

/** Linha de apoio do aviso do Signer: o que houve e, na recuperação, por quanto tempo. */
export const resumoDoSigner = (notificacao: Notificacao): string => {
  if (notificacao.tipo === 'SIGNER_INDISPONIVEL') {
    return 'Três verificações seguidas sem resposta.';
  }

  return notificacao.duracaoMs === null || notificacao.duracaoMs === undefined
    ? 'O Signer voltou a responder.'
    : `O Signer voltou a responder. Ficou indisponível por ${duracaoEmTexto(notificacao.duracaoMs)}.`;
};

/**
 * Linha de apoio do aviso de importação: só o que a tentativa registrou, sem promessa. Concluída
 * diz o que entrou; rejeitada diz que nada mudou; falha não inventa causa nem totais.
 */
export const resumoDaImportacao = (notificacao: Notificacao): string => {
  const { estado, totais } = notificacao.importacao ?? { estado: '', totais: null };

  if (estado === 'FALHA') {
    return 'O processamento do arquivo falhou.';
  }
  if (estado === 'REJEITADA') {
    return totais === null
      ? 'Nenhuma conta foi alterada.'
      : `Nenhuma conta foi alterada: ${plural(totais.rejeitadas, 'linha rejeitada', 'linhas rejeitadas')}`;
  }
  if (totais === null) {
    return '';
  }

  return [
    plural(totais.novas, 'incluída', 'incluídas'),
    plural(totais.atualizadas, 'atualizada', 'atualizadas'),
    plural(totais.rejeitadas, 'rejeitada', 'rejeitadas'),
  ].join(', ');
};

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

  if (ehAvisoDeImportacao(notificacao)) {
    // Abre a tentativa no plano de contas da empresa: lá está o relatório completo.
    return `/empresas/${notificacao.empresaId ?? ''}?aba=plano-contas&tentativa=${notificacao.importacao?.tentativaId ?? ''}`;
  }

  if (ehAvisoDoSigner(notificacao)) {
    // O cartão do Signer fica no topo do cofre: é onde se vê o estado de agora.
    return '/configuracoes/cofre';
  }

  if (ehAvisoDeCertificado(notificacao)) {
    return `/configuracoes/cofre?empresa=${notificacao.empresaId ?? ''}`;
  }

  return `/pendencias?empresaId=${notificacao.empresaId ?? ''}`;
};
