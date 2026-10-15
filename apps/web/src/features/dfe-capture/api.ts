import { ler } from '../importacao/api';
import { requisitar } from '@/lib/http';

export type EstadoDaCapturaDfe = Readonly<{
  companyId: string; state: 'READY' | 'WAITING' | 'CAPTURING' | 'BLOCKED_656' | 'FAILED' | 'DISABLED';
  lastNsu: string; maxNsu: string; averageTimeMs: number; nextAllowedAt: string; blockedUntil: string | null;
  consecutiveFailures: number; lastSuccessAt: string | null; lastErrorCode: string | null; code?: string | null;
  metrics30d?: Readonly<{ totalExecucoes: number; documentosRecebidos: number; duplicadosEvitados: number; duracaoMediaMs: number; atrasoMedioFilaMs: number; falhas: number; dlq: number; rejeicoes656: number }>;
}>;
export type HistoricoDaCapturaDfe = Readonly<{ pagina: number; itens: readonly Readonly<Record<string, string | number | null>>[] }>;

export const obterEstadoDaCapturaDfe = async (empresaId: string): Promise<EstadoDaCapturaDfe> =>
  (await ler(`/companies/${empresaId}/dfe-capture`)) as EstadoDaCapturaDfe;

export const obterHistoricoDaCapturaDfe = async (empresaId: string, pagina: number): Promise<HistoricoDaCapturaDfe> =>
  (await ler(`/companies/${empresaId}/dfe-capture/runs?pagina=${pagina}`)) as HistoricoDaCapturaDfe;

export const iniciarConsultaDfe = (empresaId: string) => requisitar<{ runId: string; status: 'QUEUED' | 'ALREADY_QUEUED' | 'COMPLETED' }>(
  `/companies/${empresaId}/dfe-capture/queries`,
  { method: 'POST', headers: { 'idempotency-key': globalThis.crypto.randomUUID() }, body: JSON.stringify({}) },
);

export const reprocessarCapturaDfe = (empresaId: string, runId: string) => requisitar<{ runId: string; status: 'QUEUED' }>(
  `/companies/${empresaId}/dfe-capture/runs/${runId}/reprocess`,
  { method: 'POST', body: JSON.stringify({}) },
);
