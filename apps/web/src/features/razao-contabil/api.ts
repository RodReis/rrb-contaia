import { requisitar } from '@/lib/http';
import { novoCorrelationId } from '../importacao/api';

export type MovimentoRazao = Readonly<{
  movementId: string; accountingDate: string; competence: string; entryNumber: string; accountId: string;
  accountCode: string; accountName: string; costCenterId: string | null; costCenterCode: string | null;
  costCenterName: string | null; history: string; externalReference: string | null; side: 'DEBIT' | 'CREDIT';
  amountCents: string; kind: 'POSTING' | 'CANCELLATION_ADJUSTMENT'; entryId: string; entryLineId: string;
  adjustmentOfMovementId: string | null; position: number;
}>;

export type LinhaBalancete = Readonly<{
  accountId: string; code: string; name: string; type: 'ANALYTICAL' | 'SYNTHETIC'; normalBalance: 'DEBIT' | 'CREDIT'; level: number;
  parentAccountId: string | null; openingBalanceCents: number; debitCents: number; creditCents: number;
  closingBalanceCents: number; closingNature: 'DEBIT' | 'CREDIT' | 'ZERO'; movementCount: number;
}>;

const caminho = (empresaId: string) => `/empresas/${empresaId}/razao`;
const periodParams = (from: string, to: string, extra: Record<string, string | undefined> = {}) => {
  const query = new URLSearchParams({ de: from, ate: to });
  for (const [key, value] of Object.entries(extra)) if (value !== undefined && value !== '') query.set(key, value);
  return query.toString();
};

export const listarMovimentosRazao = (empresaId: string, from: string, to: string, filters: Record<string, string | undefined>) =>
  requisitar<{ items: readonly MovimentoRazao[]; hasMore: boolean; page: number; pageSize: number; firstCompetence: string | null; projectionVersion: number; integrity: 'CONSISTENT' | 'INCONSISTENT' }>(`${caminho(empresaId)}?${periodParams(from, to, filters)}`);

export const obterBalancete = (empresaId: string, from: string, to: string, costCenterId: string, onlyWithMovement: boolean) =>
  requisitar<{ lines: readonly LinhaBalancete[]; totalDebitCents: number; totalCreditCents: number; firstCompetence: string | null; projectionVersion: number; integrity: 'CONSISTENT' | 'INCONSISTENT' }>(`${caminho(empresaId)}/balancete?${periodParams(from, to, { centroId: costCenterId, somenteMovimento: String(onlyWithMovement) })}`);

export const obterDetalheDoMovimento = (empresaId: string, movementId: string) =>
  requisitar<MovimentoRazao & { memo: string | null; entryStatus: string; events: readonly { action: string; reason: string | null; correlationId: string; occurredAt: string }[] }>(`${caminho(empresaId)}/${movementId}`);

const headers = () => ({ 'content-type': 'application/json', 'x-correlation-id': novoCorrelationId() });
export const verificarIntegridadeRazao = (empresaId: string) => requisitar<{ status: 'CONSISTENT' | 'INCONSISTENT'; differences: readonly unknown[]; projectionVersion: number; correlationId: string }>(`${caminho(empresaId)}/verificar`, { method: 'POST', headers: headers() });
export const reconstruirRazao = (empresaId: string, from: string, to: string) => requisitar<{ status: 'CONSISTENT' | 'FAILED'; code?: string; projectionVersion: number; movementCount?: number; correlationId: string }>(`${caminho(empresaId)}/reconstruir`, { method: 'POST', headers: headers(), body: JSON.stringify({ confirmacaoEmpresa: empresaId, confirmacaoPeriodoDe: from, confirmacaoPeriodoAte: to }) });
