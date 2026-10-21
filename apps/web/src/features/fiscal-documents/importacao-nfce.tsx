'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { baixarRelatorioNfce, enviarLoteNfce, obterLoteNfce, type LoteNfceUI } from './api';

const labelStatus:Record<LoteNfceUI['status'],string>={QUEUED:'Na fila',PROCESSING:'Processando',COMPLETED:'Concluído',COMPLETED_WITH_REJECTIONS:'Concluído com rejeições',REJECTED:'Rejeitado',FAILED:'Falha técnica'};
const labelItem:Record<LoteNfceUI['itens'][number]['status'],string>={QUEUED:'Na fila',PROCESSING:'Processando',IMPORTED:'Importado',REUSED:'Reutilizado',PENDING_LINK:'Aguardando vínculo',REJECTED:'Rejeitado',CONFLICT:'Conflito',FAILED:'Falha técnica'};

export const ImportacaoNfce=({empresaId,somenteLeitura}:{empresaId:string;somenteLeitura:boolean})=>{
  const [files,setFiles]=useState<readonly File[]>([]);const [origem,setOrigem]=useState<'PORTAL_GO'|'ERP'|'EMISSOR'>('PORTAL_GO');const [batchId,setBatchId]=useState<string|null>(null);
  const cache=useQueryClient();
  const lote=useQuery({queryKey:['sessao','eu','nfce-import',empresaId,batchId],queryFn:()=>obterLoteNfce(empresaId,batchId!),enabled:batchId!==null,refetchInterval:(query)=>query.state.data&&['COMPLETED','COMPLETED_WITH_REJECTIONS','REJECTED','FAILED'].includes(query.state.data.status)?false:2000});
  const enviar=useMutation({mutationFn:()=>enviarLoteNfce(empresaId,files,origem),onSuccess:(result)=>{setBatchId(result.batchId);toast.success('Lote NFC-e enviado para processamento.');void cache.invalidateQueries({queryKey:['sessao','eu','documentos-fiscais',empresaId]});},onError:()=>toast.error('Não foi possível enviar o lote NFC-e.')});
  const status=lote.data?.status;
  return <section aria-labelledby="nfce-import-title" className="flex flex-col gap-sm border-t border-border pt-lg">
    <div><h4 id="nfce-import-title" className="font-display text-title-md text-foreground">Importar NFC-e</h4><p className="mt-xs max-w-2xl text-body-sm text-muted-foreground">XML individual, até 10 arquivos ou ZIP sem senha. Máximo 10 MB por XML e 100 MB expandidos por lote. Apenas NFC-e autorizada, modelo 65, emitente de Goiás.</p></div>
    <div className="flex flex-wrap items-end gap-md">
      <label className="flex min-w-52 flex-col gap-xs text-label-sm text-foreground">Origem declarada<select className="h-10 rounded-md border border-input bg-background px-sm text-body-sm" value={origem} onChange={(event)=>setOrigem(event.target.value as typeof origem)} disabled={somenteLeitura||enviar.isPending}><option value="PORTAL_GO">Portal Goiás</option><option value="ERP">ERP</option><option value="EMISSOR">Emissor</option></select></label>
      <label className="flex min-w-64 flex-1 flex-col gap-xs text-label-sm text-foreground">Arquivos XML ou ZIP<input className="min-h-10 rounded-md border border-input bg-background px-sm py-xs text-body-sm file:mr-sm file:rounded file:border-0 file:bg-muted file:px-sm file:py-xs file:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" type="file" accept=".xml,.zip,application/xml,application/zip" multiple onChange={(event)=>setFiles(Array.from(event.currentTarget.files??[]))} disabled={somenteLeitura||enviar.isPending}/></label>
      <Button disabled={somenteLeitura||files.length===0||enviar.isPending} onClick={()=>enviar.mutate()}>{enviar.isPending?'Enviando…':'Enviar lote'}</Button>
    </div>
    {files.length>0?<p className="text-body-sm text-muted-foreground" aria-live="polite">{files.length} arquivo(s) selecionado(s): {files.map(file=>file.name).join(', ')}</p>:null}
    {lote.isError?<p role="alert" className="text-body-sm text-destructive">Não foi possível atualizar o lote. Tente novamente.</p>:null}
    {lote.data?<div aria-live="polite" aria-busy={status==='QUEUED'||status==='PROCESSING'} className="flex flex-col gap-sm rounded-md border border-border bg-card p-md">
      <div className="flex flex-wrap items-center justify-between gap-sm"><div><p className="font-medium text-foreground">{labelStatus[lote.data.status]} · {lote.data.total} arquivo(s)</p><p className="text-label-sm text-muted-foreground">{Object.entries(lote.data.totais).map(([key,count])=>`${labelItem[key as LoteNfceUI['itens'][number]['status']]??key}: ${count}`).join(' · ')}</p></div><Button variante="contorno" tamanho="compacto" disabled={['QUEUED','PROCESSING'].includes(lote.data.status)} onClick={()=>void baixarRelatorioNfce(empresaId,lote.data.id).catch(()=>toast.error('Não foi possível baixar o relatório NFC-e.'))}>Baixar relatório CSV</Button></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-left text-body-sm"><caption className="sr-only">Resultado por arquivo do lote NFC-e</caption><thead><tr className="border-b border-border text-label-sm text-muted-foreground"><th scope="col" className="py-xs pr-sm">Arquivo</th><th scope="col" className="py-xs pr-sm">Estado</th><th scope="col" className="py-xs pr-sm">Código</th><th scope="col" className="py-xs">Detalhe</th></tr></thead><tbody>{lote.data.itens.map(item=><tr key={item.id} className="border-b border-border/70"><td className="max-w-72 break-all py-xs pr-sm">{item.nome_sanitizado}</td><td className="py-xs pr-sm">{labelItem[item.status]}</td><td className="py-xs pr-sm font-mono text-label-sm">{item.codigo??'—'}</td><td className="py-xs">{item.detalhe_sanitizado??'—'}</td></tr>)}</tbody></table></div>
    </div>:null}
  </section>;
};
