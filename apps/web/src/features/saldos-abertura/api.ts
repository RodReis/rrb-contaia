import { requisitar } from '@/lib/http';
import { novoCorrelationId } from '../importacao/api';

export type LinhaAbertura=Readonly<{accountId:string;costCenterId:string|null;debitCents:number;creditCents:number;note:string|null;lineNumber?:number;accountCode?:string;accountName?:string;costCenterCode?:string|null;costCenterName?:string|null}>;
export type VersaoAbertura=Readonly<{openingBalanceId:string;version:number|string;baseDate:string;source:'MANUAL'|'CSV';status:'DRAFT'|'APPROVED'|'SUPERSEDED';revision:number;debitCents:string;creditCents:string;contentHash:string|null;createdBy:string;createdByName?:string;approvedBy:string|null;approvedByName?:string;approvedAt:string|null;supersedesId:string|null;replacementReason:string|null;lines:readonly LinhaAbertura[]}>;
export type DadosAbertura=Readonly<{active:VersaoAbertura|null;drafts:readonly VersaoAbertura[];history:readonly VersaoAbertura[];events:readonly {id:string;versionId:string;action:string;result:string;actorName:string|null;occurredAt:string;reason:string|null}[]}>;
const root=(company:string)=>`/empresas/${company}/saldos-abertura`;
const headers=()=>({'content-type':'application/json','x-correlation-id':novoCorrelationId(),'idempotency-key':novoCorrelationId()});
export const consultarAbertura=(company:string)=>requisitar<DadosAbertura>(root(company));
export const criarAbertura=(company:string,body:unknown)=>requisitar(root(company),{method:'POST',headers:headers(),body:JSON.stringify(body)});
export const salvarAbertura=(company:string,id:string,body:unknown)=>requisitar(root(company)+`/${id}/editar`,{method:'POST',headers:headers(),body:JSON.stringify(body)});
export const previsualizarAberturaCsv=(company:string,id:string,file:File)=>{const data=new FormData();data.set('arquivo',file);return requisitar<{previewId:string;fileHash:string;status:string;expectedRevision:number;expectedPreviewRevision:number;acceptedRows:number;rejectedRows:number;totals:{debitCents:number;creditCents:number;balanced:boolean};errors:readonly {code:string;line:number|null;message:string}[]}>(root(company)+`/${id}/csv/previsualizar`,{method:'POST',headers:headers(),body:data});};
export const confirmarAberturaCsv=(company:string,id:string,body:unknown)=>requisitar(root(company)+`/${id}/csv/confirmar`,{method:'POST',headers:headers(),body:JSON.stringify(body)});
export const aprovarAbertura=(company:string,id:string,body:unknown)=>requisitar(root(company)+`/${id}/aprovar`,{method:'POST',headers:headers(),body:JSON.stringify(body)});
