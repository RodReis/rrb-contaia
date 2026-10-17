import { requisitar } from '@/lib/http';

export type EstadoObrigacao='PENDENTE'|'BLOQUEADA_POR_DEPENDENCIA'|'ENTREGUE'|'VENCIDA'|'NAO_EXIGIVEL'|'COBERTURA_INCOMPLETA';
export type Ocorrencia={id:string;empresaId:string;empresaNome:string;cnpj:string;codigo:string;nome:string;competencia:string;vencimentoNominal:string|null;vencimentoAjustado:string|null;estado:EstadoObrigacao;motivo:string|null;dependenciasPendentes:string[];prioridade:string;versao:number};
export type PaginaAgenda={ocorrencias:Ocorrencia[];total:number};
export const listarAgenda=(params:URLSearchParams,signal?:AbortSignal)=>requisitar<PaginaAgenda>(`/fiscal/obrigacoes?${params.toString()}`,signal?{signal}:{});
export const gerarAgenda=(competencia:string)=>requisitar<number>('/fiscal/obrigacoes/geracoes',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({competencia:`${competencia}-01`})});
export const obterOcorrencia=(id:string,signal?:AbortSignal)=>requisitar<{ocorrencia:Ocorrencia;eventos:Array<Record<string,unknown>>;alertas:Array<Record<string,unknown>>}>(`/fiscal/obrigacoes/${id}`,signal?{signal}:{});
export const registrarBaixa=(id:string,entrada:{versao:number;dataEntrega:string;referencia:string})=>requisitar<void>(`/fiscal/obrigacoes/${id}/baixa`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(entrada)});
export const reabrirOcorrencia=(id:string,entrada:{versao:number;motivo:string})=>requisitar<void>(`/fiscal/obrigacoes/${id}/reabertura`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(entrada)});
