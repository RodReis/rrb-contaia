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
export type FechamentoContabil = Readonly<{closeId:string;competence:string;version:number;projectionVersion:number;kind:'REGULAR'|'EMPTY_CONFIRMED';debitCents:number|string;creditCents:number|string;movementCount:number|string;entryCount:number|string;firstCompetence:string;contentHash:string;closedBy:string;closedAt:string;correlationId:string;content:Record<string,unknown>;closedByName:string|null;cycleStatus:'OPEN'|'CLOSED'|'REOPENED';snapshotValid:boolean}>;
export type CicloContabil = Readonly<{competence:string;status:'OPEN'|'CLOSED'|'REOPENED';activeCloseId:string|null;latestVersion:number}>;

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

export const consultarFechamentos = (empresaId:string,from:string,to:string) => requisitar<{cycles:readonly CicloContabil[];closes:readonly FechamentoContabil[];events:readonly {competence:string;action:string;result:string;version:number|null;reason:string|null;blockers:readonly string[];actorId:string;actorName:string|null;correlationId:string;occurredAt:string}[];correlationId:string}>(`${caminho(empresaId)}/fechamentos?${periodParams(from,to)}`);
export const fecharCompetencia=(empresaId:string,competence:string,expectedVersion:number,confirmEmpty:boolean)=>{const idempotencyKey=crypto.randomUUID();return requisitar<{status:string;competence:string;version?:number;contentHash?:string;blockers?:readonly string[];correlationId:string;code?:string}>(`${caminho(empresaId)}/fechamentos`,{method:'POST',headers:{...headers(),'idempotency-key':idempotencyKey},body:JSON.stringify({competence,expectedVersion,confirmEmpty,idempotencyKey})});};
export const reabrirCompetencia=(empresaId:string,competence:string,expectedVersion:number,reason:string)=>{const idempotencyKey=crypto.randomUUID();return requisitar<{status:string;competence:string;version:number;correlationId:string;code?:string}>(`${caminho(empresaId)}/fechamentos/${competence}/reabrir`,{method:'POST',headers:{...headers(),'idempotency-key':idempotencyKey},body:JSON.stringify({competence,expectedVersion,reason,idempotencyKey})});};

export const obterDetalheDoMovimento = (empresaId: string, movementId: string) =>
  requisitar<MovimentoRazao & { memo: string | null; entryStatus: string; events: readonly { action: string; reason: string | null; correlationId: string; occurredAt: string }[] }>(`${caminho(empresaId)}/${movementId}`);

const headers = () => ({ 'content-type': 'application/json', 'x-correlation-id': novoCorrelationId() });
export const verificarIntegridadeRazao = (empresaId: string) => requisitar<{ status: 'CONSISTENT' | 'INCONSISTENT'; differences: readonly unknown[]; projectionVersion: number; correlationId: string }>(`${caminho(empresaId)}/verificar`, { method: 'POST', headers: headers() });
export const reconstruirRazao = (empresaId: string, from: string, to: string) => requisitar<{ status: 'CONSISTENT' | 'FAILED'; code?: string; projectionVersion: number; movementCount?: number; correlationId: string }>(`${caminho(empresaId)}/reconstruir`, { method: 'POST', headers: headers(), body: JSON.stringify({ confirmacaoEmpresa: empresaId, confirmacaoPeriodoDe: from, confirmacaoPeriodoAte: to }) });
