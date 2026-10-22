'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ErroDeTela, Skeleton } from '@/components/ui/estados';
import { StatusBadge } from '@/components/ui/status-badge';
import { Select } from '@/components/ui/select';
import { Campo } from '@/components/ui/campo';
import { ErroDaApi } from '@/lib/http';
import { listarApuracoesIcmsSt, obterApuracaoIcmsSt, processarApuracaoIcmsSt, registrarDevolucaoIcmsSt, type ApuracaoIcmsStSchema } from './api';
import type { z } from 'zod';

type Apuracao = z.infer<typeof ApuracaoIcmsStSchema>;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const asRecord = (value: unknown): Record<string, unknown> => isRecord(value) ? value : {};
const asInteger = (value: unknown): bigint | null => {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === 'string' && /^-?\d+$/u.test(value)) { try { return BigInt(value); } catch { return null; } }
  return null;
};
const moeda = (centavos: unknown) => {
  const value = asInteger(centavos);
  if (value === null || value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) return '—';
  return new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(value)/100);
};
const quantidade = (scaledValue: unknown, scaleValue: unknown) => {
  const scaled = asInteger(scaledValue);
  if (scaled === null || typeof scaleValue !== 'number' || !Number.isInteger(scaleValue) || scaleValue < 0 || scaleValue > 10) return '—';
  const base = 10n ** BigInt(scaleValue);
  const fraction = (scaled < 0n ? -scaled : scaled) % base;
  const decimal = scaleValue === 0 ? '' : fraction.toString().padStart(scaleValue, '0').replace(/0+$/u, '');
  const whole = (scaled < 0n ? -scaled : scaled) / base;
  return `${scaled < 0n ? '-' : ''}${whole}${decimal.length > 0 ? `,${decimal}` : ''}`;
};
const texto = (value: unknown, fallback = '—') => typeof value === 'string' || typeof value === 'number' ? String(value) : fallback;
const kindLabel = (value: unknown) => value === 'RESTITUTION' ? 'Restituição' : value === 'COMPLEMENT' ? 'Complemento' : value === 'NONE' ? 'Sem diferença' : 'Indeterminado';
const rotuloMotivo = (code: string) => ({
  OUTPUT_POST_SALE_EVENTS_UNVERIFIED:'Eventos posteriores à venda não cobertos', INPUT_RECOVERY_INDETERMINATE:'ICMS recuperável sem prova suficiente',
  OUTPUT_INDICATOR_MISSING:'Indicador fiscal idDest ou indFinal ausente', OUTPUT_INDICATOR_CONTRADICTORY:'Indicadores fiscais não comprovam operação interna a consumidor final',
  OUTPUT_DOCUMENT_CANCELLED:'Documento cancelado antes do snapshot',
  NO_APPLICABLE_SETTLEMENT_RULE:'Sem regra oficial publicada aplicável', SETTLEMENT_RULE_AMBIGUOUS:'Mais de uma regra oficial corresponde ao item',
  OUTPUT_ITEM_FACTS_INCOMPLETE:'Dados fiscais ou de produto incompletos', OUTPUT_OPERATION_NOT_COVERED:'Operação fora do escopo aprovado',
  OUTPUT_DOCUMENT_COVERAGE_UNAVAILABLE:'Não há captura de NF-e de saída da empresa para esta competência',
  COMPANY_REGIME_UNSUPPORTED:'Regime histórico não identificado', OUTPUT_DOCUMENT_NOT_ELIGIBLE:'NF-e sem autorização comprovada',
  SETTLEMENT_PACKAGE_AMBIGUOUS:'Mais de um pacote oficial cobre a competência', OFFICIAL_LAYOUT_UNAVAILABLE:'Leiaute oficial do demonstrativo ainda sem mapeamento',
}[code] ?? 'Fato fiscal sem cobertura; revisar documentação');

export const PainelApuracaoIcmsSt = ({empresaId,podeProcessar,podeDecidir}:{empresaId:string;podeProcessar:boolean;podeDecidir:boolean}) => {
  const [competencia,setCompetencia]=useState('2018-02');
  const [reason,setReason]=useState('');
  const [active,setActive]=useState<Apuracao|null>(null);
  const [linePage,setLinePage]=useState(1);
  const [modelo,setModelo]=useState<'TODOS'|'55'|'65'>('TODOS');
  const [returnLine,setReturnLine]=useState<Readonly<{id:string;unit:string}>|null>(null);
  const [returnDate,setReturnDate]=useState('');
  const [returnDocument,setReturnDocument]=useState('');
  const [returnItem,setReturnItem]=useState('');
  const [returnQuantity,setReturnQuantity]=useState('');
  const [returnFile,setReturnFile]=useState<File|null>(null);
  const queryClient=useQueryClient();
  const history=useQuery({queryKey:['sessao','eu','apuracoes-icms-st',empresaId,modelo],queryFn:()=>listarApuracoesIcmsSt(empresaId,modelo==='TODOS'?undefined:modelo)});
  const detail=useQuery({queryKey:['sessao','eu','apuracao-icms-st',empresaId,active?.id,linePage,modelo],queryFn:()=>obterApuracaoIcmsSt(empresaId,active!.id,linePage,modelo==='TODOS'?undefined:modelo),enabled:active!==null});
  const run=useMutation({mutationFn:()=>processarApuracaoIcmsSt(empresaId,{competence:competencia,idempotencyKey:crypto.randomUUID(),...(active?{reprocessingReason:reason.trim()}:{})}),onSuccess:(result)=>{setReason('');setLinePage(1);setActive({id:result.id,revision:result.revision,status:result.status,competence:competencia,gross_restitution_cents:null,gross_complement_cents:null,net_amount_cents:null,blocked_line_count:result.blockedLineCount??0,line_count:0,line_page:1,line_page_size:50,line_total_pages:0,facts:{},processed_at:new Date().toISOString(),lines:[],events:[],returnEvents:[]});void queryClient.invalidateQueries({queryKey:['sessao','eu','apuracoes-icms-st',empresaId]});toast.success(result.status==='BLOCKED'?'Apuração bloqueada: faltam fonte ou cobertura documental.':'Apuração pronta para conferência humana.');},onError:(error:unknown)=>{const problem=error instanceof ErroDaApi?error.problema:null;toast.error(problem?.code==='ICMS_ST_SETTLEMENT_REPROCESS_REASON_REQUIRED'?'Informe o motivo com pelo menos 10 caracteres.':'Não foi possível processar apuração.');}});
  const submitReturn=useMutation({mutationFn:()=>{
    const match=/^(\d+)(?:[,.](\d{1,10}))?$/u.exec(returnQuantity.trim());
    if(!active||!returnLine||!returnFile||!match)throw new Error('Preencha quantidade válida e anexe documento comprobatório.');
    const scaled=(BigInt(match[1]??'0')*10_000_000_000n+BigInt((match[2]??'').padEnd(10,'0'))).toString();
    return registrarDevolucaoIcmsSt(empresaId,{originalSnapshotId:active.id,originalLineId:returnLine.id,returnDocumentIdentity:returnDocument.trim(),returnItemIdentity:returnItem.trim(),eventDate:returnDate,unit:returnLine.unit,returnedQuantityScaled:scaled,idempotencyKey:crypto.randomUUID(),arquivo:returnFile});
  },onSuccess:()=>{setReturnLine(null);setReturnDate('');setReturnDocument('');setReturnItem('');setReturnQuantity('');setReturnFile(null);void detail.refetch();void history.refetch();toast.success('Devolução registrada com estorno reproduzível.');},onError:(error:unknown)=>toast.error(error instanceof ErroDaApi?error.problema.title:error instanceof Error?error.message:'Falha ao registrar devolução.')});
  const result=detail.data;
  const currentStatus=result?.status;
  const factsReasons=result&&Array.isArray(result.facts['blockingReasonCodes'])?result.facts['blockingReasonCodes'].filter((item):item is string=>typeof item==='string'):[];
  const reasons=[...new Set([...factsReasons,...(result?.lines??[]).flatMap((line)=>Array.isArray(line['blocking_reason_codes'])?line['blocking_reason_codes'].filter((item):item is string=>typeof item==='string'):[])])];
  return <section aria-labelledby="apuracao-icms-st-title" className="mt-xl space-y-md border-t border-border pt-lg">
    <header className="max-w-3xl"><p className="text-label-sm uppercase tracking-wide text-muted-foreground">F29 + F31 · operações de 27/10/2016 a 28/02/2018</p><h3 id="apuracao-icms-st-title" className="mt-xs font-display text-title-lg text-foreground">Complemento ou restituição de ICMS-ST</h3><p className="mt-xs text-body-sm text-muted-foreground">NF-e 55 e NFC-e 65 compõem a mesma apuração mensal. Itens sem regra publicada ou prova documental permanecem bloqueados, sem total estimado.</p></header>
    <div className="flex flex-wrap items-end gap-sm rounded-lg border border-border bg-card p-md">
      <label className="flex min-w-52 flex-col gap-xs text-label-sm text-foreground">Competência<input type="month" min="2016-10" max="2018-02" value={competencia} onChange={(event)=>setCompetencia(event.currentTarget.value)} className="min-h-11 rounded-md border border-input bg-background px-sm text-body-sm"/></label>
      {podeProcessar?<Button variante="primaria" disabled={run.isPending||active!==null&&reason.trim().length<10} onClick={()=>run.mutate()}>{run.isPending?'Apurando…':currentStatus==='STALE'?'Reprocessar competência':active?'Criar nova revisão':'Apurar competência'}</Button>:null}
      {active?<p className="text-body-sm text-muted-foreground">Revisão {active.revision} · competência {active.competence}</p>:null}
      {active?<label className="flex min-w-64 flex-1 flex-col gap-xs text-label-sm text-foreground">Motivo do reprocessamento<input value={reason} onChange={(event)=>setReason(event.currentTarget.value)} maxLength={500} className="min-h-11 rounded-md border border-input bg-background px-sm text-body-sm" aria-describedby="icms-st-reprocess-hint"/><span id="icms-st-reprocess-hint" className="text-label-sm text-muted-foreground">Mínimo de 10 caracteres.</span></label>:null}
    </div>
    {detail.isPending?<div aria-busy="true"><Skeleton className="h-28 w-full"/></div>:null}
    {detail.isError?<ErroDeTela titulo="Apuração indisponível" descricao="Tente novamente em instantes."/>:null}
      {result?<article className="space-y-md rounded-lg border border-border bg-card p-md" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-sm"><div><h4 className="font-display text-title-sm text-foreground">Resultado · revisão {result.revision}</h4><p className="mt-xs text-label-sm text-muted-foreground">Processada em {new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(new Date(result.processed_at))}</p></div><StatusBadge tom={currentStatus==='BLOCKED'?'critico':currentStatus==='REJECTED'||currentStatus==='STALE'?'atencao':'conforme'} rotulo={currentStatus==='STALE'?'Desatualizada':currentStatus==='BLOCKED'?'Bloqueada':currentStatus==='APPROVED'?'Aprovada':currentStatus==='REJECTED'?'Rejeitada':result.events.some((event)=>event['action']==='SUBMITTED')?'Submetida':'Aguardando conferência'}/></div>
      {currentStatus==='STALE'?<p role="status" className="rounded-md border border-warning/40 bg-warning/10 p-md text-body-sm text-foreground">O conjunto de NFC-e mudou após esta revisão. Reprocesse a competência inteira para usar os documentos atuais; revisão anterior permanece preservada.</p>:null}
      {currentStatus==='BLOCKED'?<div className="rounded-md border border-warning/40 bg-warning/10 p-md"><p className="font-medium text-foreground">Nenhum total foi liberado</p>{reasons.length?<ul className="mt-sm list-disc space-y-xs pl-lg text-body-sm text-foreground">{reasons.map((code)=><li key={code}>{rotuloMotivo(code)}</li>)}</ul>:<p className="mt-xs text-body-sm text-foreground">Não há documentos elegíveis ou não existe pacote normativo publicado para esta competência.</p>}</div>:<dl className="grid gap-sm sm:grid-cols-3"><div className="rounded-md bg-muted/40 p-sm"><dt className="text-label-sm text-muted-foreground">Restituição bruta</dt><dd className="mt-xs font-display text-title-md tabular-nums text-foreground">{moeda(result.gross_restitution_cents)}</dd></div><div className="rounded-md bg-muted/40 p-sm"><dt className="text-label-sm text-muted-foreground">Complemento bruto</dt><dd className="mt-xs font-display text-title-md tabular-nums text-foreground">{moeda(result.gross_complement_cents)}</dd></div><div className="rounded-md bg-muted/40 p-sm"><dt className="text-label-sm text-muted-foreground">Saldo líquido</dt><dd className="mt-xs font-display text-title-md tabular-nums text-foreground">{moeda(result.net_amount_cents)}</dd></div></dl>}
      <section aria-labelledby="icms-st-lines-title" className="space-y-sm">
        <div className="flex flex-wrap items-end justify-between gap-sm"><div><h5 id="icms-st-lines-title" className="font-display text-title-sm text-foreground">Itens da competência</h5><div className="mt-xs w-56"><Select rotulo="Modelo" valor={modelo} onValorChange={(value)=>{setModelo(value as 'TODOS'|'55'|'65');setLinePage(1);}} opcoes={[{valor:'TODOS',rotulo:'Todos'},{valor:'55',rotulo:'NF-e 55'},{valor:'65',rotulo:'NFC-e 65'}]}/></div></div><p className="text-label-sm text-muted-foreground">{result.line_count} item(ns) · página {result.line_page} de {Math.max(result.line_total_pages,1)}</p></div>
        {result.lines.length===0?<p className="rounded-md border border-border p-md text-body-sm text-muted-foreground">Nenhuma linha comprovada nesta página. A competência permanece sem fechamento válido.</p>:<div className="overflow-x-auto rounded-md border border-border" tabIndex={0} aria-label="Itens da apuração; tabela com rolagem horizontal">
          <table className="min-w-[58rem] w-full text-left text-body-sm">
            <caption className="sr-only">Comparação por item entre ICMS da entrada, ICMS efetivo da saída e diferença apurada</caption>
            <thead className="bg-muted/40 text-label-sm text-muted-foreground"><tr><th scope="col" className="p-sm">Saída</th><th scope="col" className="p-sm">Entrada atribuída</th><th scope="col" className="p-sm">ICMS da entrada</th><th scope="col" className="p-sm">ICMS efetivo</th><th scope="col" className="p-sm">Diferença</th><th scope="col" className="p-sm">Estado</th><th scope="col" className="p-sm">Ação</th></tr></thead>
            <tbody className="divide-y divide-border">{result.lines.map((line)=>{
              const rowFacts=asRecord(line['facts']);
              const calculation=asRecord(line['calculation']);
              const recovery=asRecord(line['recovery_memory']);
              const sourceDocuments=Array.isArray(recovery['documents'])?recovery['documents'].filter((item):item is string=>typeof item==='string'):[];
              const itemNumber=texto(rowFacts['itemNumber'],texto(line['output_item_id']));
              const product=texto(rowFacts['productId'],'Produto sem GTIN');
              const quantityText=quantidade(rowFacts['quantityScaled'],rowFacts['quantityScale']);
              const unit=texto(rowFacts['unit'],'unidade não identificada');
              const kind=texto(line['difference_kind']);
              const blocks=Array.isArray(line['blocking_reason_codes'])?line['blocking_reason_codes'].filter((item):item is string=>typeof item==='string'):[];
              return <tr key={`${texto(line['output_document_id'])}:${texto(line['output_item_id'])}`} className="align-top text-foreground">
                <th scope="row" className="p-sm font-normal"><span className="block font-medium">Item {itemNumber}</span><span className="block font-mono text-label-sm tabular-nums text-muted-foreground">{product}</span><span className="block text-label-sm text-muted-foreground">{quantityText} {unit}</span><span className="block text-label-sm text-muted-foreground">{texto(rowFacts['documentModel'])==='65'?'NFC-e 65':'NF-e 55'}</span><span className="block break-all font-mono text-label-sm tabular-nums text-muted-foreground">{texto(rowFacts['accessKey'])}</span>{texto(rowFacts['documentModel'])==='65'&&!(typeof rowFacts['destinationIdentifier']==='string'&&rowFacts['destinationIdentifier'].trim())?<span className="block text-label-sm text-muted-foreground">Consumidor não identificado</span>:null}</th>
                <td className="max-w-56 p-sm"><span className="block">{kindLabel(calculation['recoveryOrigin'])}</span>{sourceDocuments.length?sourceDocuments.map((documentId)=><span key={documentId} className="block break-all font-mono text-label-sm text-muted-foreground">{documentId}</span>):<span className="text-label-sm text-muted-foreground">Sem vínculo comprovado</span>}</td>
                <td className="whitespace-nowrap p-sm tabular-nums"><span className="block">ICMS {moeda(calculation['inputIcmsCents'])}</span><span className="block text-label-sm text-muted-foreground">ICMS-ST {moeda(calculation['inputIcmsStCents'])}</span><span className="block text-label-sm text-muted-foreground">Base presumida {moeda(calculation['presumedBaseCents'])}</span></td>
                <td className="whitespace-nowrap p-sm tabular-nums"><span className="block">{moeda(calculation['effectiveIcmsCents'])}</span><span className="block text-label-sm text-muted-foreground">Base efetiva {moeda(calculation['effectiveBaseCents'])}</span></td>
                <td className="whitespace-nowrap p-sm tabular-nums"><span className="block">{kind==='RESTITUTION'?moeda(calculation['restitutionCents']):kind==='COMPLEMENT'?moeda(calculation['complementCents']):kind==='NONE'?moeda(0):'—'}</span><span className="text-label-sm text-muted-foreground">{kindLabel(kind)}</span></td>
                <td className="min-w-44 p-sm"><span>{blocks.length||kind==='INDETERMINATE'?'Indeterminado':'Conferido'}</span>{blocks.map((code)=><span key={code} className="mt-xs block text-label-sm text-muted-foreground">{rotuloMotivo(code)}</span>)}</td>
                <td className="p-sm">{currentStatus==='APPROVED'&&podeProcessar&&kind!=='INDETERMINATE'?<Button variante="contorno" tamanho="compacto" onClick={()=>setReturnLine({id:texto(line['id']),unit:texto(rowFacts['unit'],'')})}>Registrar devolução</Button>:<span className="text-label-sm text-muted-foreground">—</span>}</td>
              </tr>;
            })}</tbody>
          </table>
        </div>}
        {result.line_total_pages>1?<nav aria-label="Paginação dos itens da apuração" className="flex items-center justify-end gap-sm"><Button variante="contorno" tamanho="compacto" disabled={detail.isFetching||linePage<=1} onClick={()=>setLinePage((page)=>Math.max(1,page-1))}>Anterior</Button><Button variante="contorno" tamanho="compacto" disabled={detail.isFetching||linePage>=result.line_total_pages} onClick={()=>setLinePage((page)=>Math.min(result.line_total_pages,page+1))}>Próxima</Button></nav>:null}
      </section>
      {returnLine?<form className="grid gap-sm rounded-md border border-border bg-card p-md md:grid-cols-2" onSubmit={(event)=>{event.preventDefault();submitReturn.mutate();}} aria-label="Registrar devolução manual">
        <h5 className="font-display text-title-sm text-foreground md:col-span-2">Registrar devolução manual · linha {returnLine.id}</h5>
        <Campo rotulo="Data da devolução (AAAA-MM-DD)" obrigatorio value={returnDate} onValorChange={setReturnDate} maxLength={10}/>
        <Campo rotulo="Identidade do documento de devolução" obrigatorio value={returnDocument} onValorChange={setReturnDocument} maxLength={120}/>
        <Campo rotulo="Item devolvido" obrigatorio value={returnItem} onValorChange={setReturnItem} maxLength={80}/>
        <Campo rotulo={`Quantidade devolvida (${returnLine.unit})`} obrigatorio value={returnQuantity} onValorChange={setReturnQuantity} inputMode="decimal"/>
        <label className="flex flex-col gap-xs text-label-md text-foreground md:col-span-2">Documento comprobatório obrigatório (PDF, XML, PNG ou JPEG)<input type="file" accept="application/pdf,application/xml,text/xml,image/jpeg,image/png" onChange={(event)=>setReturnFile(event.currentTarget.files?.[0]??null)} disabled={submitReturn.isPending} className="min-h-10 rounded-md border border-input bg-background px-sm py-xs text-body-sm file:mr-sm file:rounded file:border-0 file:bg-muted file:px-sm file:py-xs file:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"/></label>
        <p className="text-label-sm text-muted-foreground md:col-span-2">Valores tributários vêm da linha aprovada. Anexo privado, hash SHA-256 e saldo serializado. Nenhum valor fiscal manual.</p>
        <div className="flex gap-sm md:col-span-2"><Button variante="primaria" type="submit" disabled={submitReturn.isPending||!returnDate||!returnDocument||!returnItem||!returnQuantity||!returnFile}>Registrar devolução</Button><Button variante="contorno" type="button" onClick={()=>setReturnLine(null)}>Cancelar</Button></div>
      </form>:null}
      {result.events.length?<ol aria-label="Histórico da revisão" className="space-y-xs">{result.events.map((event,index)=><li key={`${String(event['occurred_at'])}-${index}`} className="border-t border-border/70 pt-xs text-body-sm text-muted-foreground">{String(event['action'])} · {new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(new Date(String(event['occurred_at'])))}</li>)}</ol>:null}
      {result.returnEvents.length?<section aria-labelledby="icms-st-returns-title" className="space-y-sm"><h5 id="icms-st-returns-title" className="font-display text-title-sm text-foreground">Devoluções e estornos</h5><ul className="space-y-xs">{result.returnEvents.map((event,index)=><li key={`${texto(event['id'])}-${index}`} className="rounded-md border border-border bg-card p-sm text-body-sm"><p className="font-medium text-foreground">Devolução em {texto(event['event_date'])} · competência {texto(event['competence'])}</p><p className="text-muted-foreground">Documento {texto(event['return_document_identity'])}, item {texto(event['return_item_identity'])} · {quantidade(event['returned_quantity_scaled'],10)} {texto(event['normalized_unit'])}</p><p className="text-muted-foreground">Estorno da restituição: {moeda(event['reversed_restitution_cents'])} · do complemento: {moeda(event['reversed_complement_cents'])}</p><p className="break-all font-mono text-label-sm text-muted-foreground">Linha original {texto(event['original_line_id'])} · SHA-256 {texto(event['evidence_sha256'])}</p></li>)}</ul></section>:null}
      {currentStatus==='PENDING_REVIEW'&&!result.events.some((event)=>['SUBMITTED','APPROVED','REJECTED'].includes(String(event['action'])))&&podeProcessar?<Button variante="primaria" disabled>{'Submissão indisponível: falta cobertura fiscal e documental'}</Button>:null}
      {currentStatus==='PENDING_REVIEW'&&result.events.some((event)=>event['action']==='SUBMITTED')&&podeDecidir?<p role="status" className="rounded-md border border-warning/40 bg-warning/10 p-md text-body-sm text-foreground">Decisão suspensa: falta validar a cobertura documental e o leiaute oficial do demonstrativo. Nenhuma aprovação será registrada.</p>:null}
      <p className="text-label-sm text-muted-foreground">Revisão humana e rascunho não estão disponíveis: falta captura de NF-e de saída, cobertura dos eventos posteriores e mapeamento do leiaute oficial. Nenhuma transmissão ou efeito financeiro foi iniciado.</p>
    </article>:null}
    <section aria-labelledby="icms-st-history-title" className="space-y-sm"><h4 id="icms-st-history-title" className="font-display text-title-sm text-foreground">Histórico de competências</h4>{history.isPending?<div aria-busy="true"><Skeleton className="h-12 w-full"/></div>:null}{history.isError?<ErroDeTela titulo="Histórico indisponível" descricao="Tente novamente em instantes."/>:null}{history.data?.itens.length===0?<p className="text-body-sm text-muted-foreground">Ainda não há apurações registradas.</p>:null}{history.data?.itens.length?<ul className="grid gap-sm md:grid-cols-2">{history.data.itens.map((item)=><li key={item.id} className="flex items-center justify-between gap-sm rounded-md border border-border bg-card p-sm"><div><p className="font-medium text-foreground">{item.competence} · revisão {item.revision}</p><p className="text-label-sm text-muted-foreground">{item.status==='STALE'?'Desatualizada':item.status==='BLOCKED'?'Bloqueada':item.review_action??'Aguardando conferência'} · {item.blocked_line_count} item(ns) bloqueado(s)</p></div><Button variante="contorno" tamanho="compacto" onClick={()=>{setLinePage(1);setCompetencia(item.competence.slice(0,7));setActive({id:item.id,revision:item.revision,status:item.status,competence:item.competence.slice(0,7),gross_restitution_cents:item.gross_restitution_cents,gross_complement_cents:item.gross_complement_cents,net_amount_cents:item.net_amount_cents,blocked_line_count:item.blocked_line_count,line_count:item.line_count,line_page:1,line_page_size:50,line_total_pages:Math.ceil(item.line_count/50),facts:{},processed_at:item.processed_at,lines:[],events:[],returnEvents:[]});}}>Abrir</Button></li>)}</ul>:null}</section>
  </section>;
};
