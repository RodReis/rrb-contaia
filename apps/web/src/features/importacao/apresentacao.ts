/**
 * Estados, tons e formatação da importação por CSV, XLSX ou ODS (SPEC-013/014 §3.11, §5.3), comuns
 * a todo domínio. Fonte única para tela e teste: o estado é sempre dito por texto, nunca só pela cor.
 */
import type { EstadoDaImportacao } from '@contaia/shared';

import type { TomDoStatus } from '@/components/ui/status-badge';

export const APARENCIA_DO_ESTADO: Readonly<Record<EstadoDaImportacao, { rotulo: string; tom: TomDoStatus }>> = {
  RECEBIDA: { rotulo: 'Recebida', tom: 'processando' },
  VALIDANDO: { rotulo: 'Validando', tom: 'processando' },
  AGUARDANDO_CONFIRMACAO: { rotulo: 'Aguardando confirmação', tom: 'atencao' },
  APLICANDO: { rotulo: 'Aplicando', tom: 'processando' },
  CONCLUIDA: { rotulo: 'Concluída', tom: 'conforme' },
  CONCLUIDA_COM_REJEICOES: { rotulo: 'Concluída com rejeições', tom: 'atencao' },
  REJEITADA: { rotulo: 'Rejeitada', tom: 'critico' },
  CANCELADA: { rotulo: 'Cancelada', tom: 'neutro' },
  FALHA: { rotulo: 'Falha técnica', tom: 'critico' },
};

/** Estados em que o worker ou a aplicação ainda trabalham: a tela acompanha por consulta. */
export const ESTADOS_EM_ANDAMENTO: readonly EstadoDaImportacao[] = ['RECEBIDA', 'VALIDANDO', 'APLICANDO'];

export const emAndamento = (estado: EstadoDaImportacao | undefined): boolean =>
  estado !== undefined && ESTADOS_EM_ANDAMENTO.includes(estado);

/** Ainda não terminou: aparece como aviso para retomar quando a aba abre sem tentativa. */
export const naoTerminada = (estado: EstadoDaImportacao): boolean =>
  emAndamento(estado) || estado === 'AGUARDANDO_CONFIRMACAO';

/** Estados em que a base ganhou registros: a pendência deixa de ser promessa. */
export const ESTADOS_COM_LINHAS_APLICADAS: readonly string[] = ['CONCLUIDA', 'CONCLUIDA_COM_REJEICOES'];

const NUMERO = new Intl.NumberFormat('pt-BR');

export const formatarNumero = (valor: number): string => NUMERO.format(valor);

/** `14/03/2026 09:30`, sempre no horário de Brasília (FRONTEND.md §12). */
export const formatarInstante = (iso: string): string =>
  new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
    .format(new Date(iso))
    .replace(',', '');

/** Hash SHA-256 truncado: 8 + … + 4 (PATTERNS.md §3); o completo fica no `title` e na cópia. */
export const hashCurto = (hash: string): string =>
  hash.length <= 12 ? hash : `${hash.slice(0, 8)}…${hash.slice(-4)}`;

export const plural = (quantidade: number, singular: string, varios: string): string =>
  `${formatarNumero(quantidade)} ${quantidade === 1 ? singular : varios}`;
