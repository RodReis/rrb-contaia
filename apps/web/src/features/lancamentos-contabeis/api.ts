import { requisitar } from '@/lib/http';
import { novoCorrelationId } from '../importacao/api';

export type EstadoLancamento='DRAFT'|'POSTED'|'DISCARDED'|'CANCELLED'|'REVERSED';
export type LinhaLancamento=Readonly<{lineId?:string;accountId:string;side:'DEBIT'|'CREDIT';amountCents:number|string;costCenterId:string|null;memo:string|null;position:number}>;
export type Lancamento=Readonly<{entryId:string;entryNumber:number|null;accountingDate:string;competence:string;history:string;externalReference?:string|null;status:EstadoLancamento;version:number;debitCents:string;creditCents:string;lines?:readonly LinhaLancamento[];events?:readonly {id:string;action:string;occurredAt:string|null}[]}>;
const cabecalhos=()=>({'content-type':'application/json','x-correlation-id':novoCorrelationId()});
const caminho=(empresaId:string)=>`/empresas/${empresaId}/lancamentos-contabeis`;
export const listarLancamentos=(empresaId:string,competence:string,status:string)=>{const filtros=new URLSearchParams({competence});if(status)filtros.set('status',status);return requisitar<readonly Lancamento[]>(`${caminho(empresaId)}?${filtros}`)};
export const obterLancamento=(empresaId:string,id:string)=>requisitar<Lancamento>(`${caminho(empresaId)}/${id}`);
export const salvarLancamento=(empresaId:string,dados:unknown,id?:string)=>requisitar<{entryId:string;version:number}>(id?`${caminho(empresaId)}/${id}`:caminho(empresaId),{method:id?'PUT':'POST',headers:cabecalhos(),body:JSON.stringify(dados)});
export const efetivarLancamento=(empresaId:string,id:string,version:number)=>requisitar(`${caminho(empresaId)}/${id}/efetivar`,{method:'POST',headers:cabecalhos(),body:JSON.stringify({version})});
export const descartarLancamento=(empresaId:string,id:string,reason:string,version:number)=>requisitar(`${caminho(empresaId)}/${id}/descartar`,{method:'POST',headers:cabecalhos(),body:JSON.stringify({reason,version})});
export const cancelarLancamento=(empresaId:string,id:string,reason:string,version:number)=>requisitar(`${caminho(empresaId)}/${id}/cancelar`,{method:'POST',headers:cabecalhos(),body:JSON.stringify({reason,version})});
export const estornarLancamento=(empresaId:string,id:string,accountingDate:string,competence:string,reason:string)=>requisitar(`${caminho(empresaId)}/${id}/estornar`,{method:'POST',headers:cabecalhos(),body:JSON.stringify({accountingDate,competence,reason})});
export const listarEmpresasDaCarteira=()=>requisitar<{empresas:readonly {id:string;razaoSocial:string|null;nomeFantasia:string|null}[]}>('/empresas?limite=200&deslocamento=0');
export const listarContasAnaliticas=(empresaId:string,busca='')=>requisitar<{items:readonly {accountId:string;code:string;name:string;status:string;type:string;costCenterPolicy:string|null}[]}>(`/empresas/${empresaId}/estrutura-contabil/contas?${new URLSearchParams({busca})}`);
export const listarCentrosAnaliticos=(empresaId:string,busca='')=>requisitar<{items:readonly {costCenterId:string;code:string;name:string;status:string;type:string}[]}>(`/empresas/${empresaId}/estrutura-contabil/centros-de-custo?${new URLSearchParams({busca})}`);
