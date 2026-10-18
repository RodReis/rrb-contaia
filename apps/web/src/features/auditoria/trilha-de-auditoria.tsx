'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowDownToLine, Check, ChevronLeft, ChevronRight, FileClock, Fingerprint, ShieldCheck } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Campo } from '@/components/ui/campo';
import { EmptyState, ErroDeTela, Skeleton } from '@/components/ui/estados';
import { Select } from '@/components/ui/select';
import { DialogoDeJustificativa } from '@/features/empresa/dialogo-de-justificativa';
import { useSessao } from '@/features/usuarios/queries';
import { cn } from '@/lib/cn';
import { exportarAuditoria, listarAuditoria, obterEstadoDaExportacao, obterEventoDeAuditoria, revelarPayloadDeAuditoria, type EventoDeAuditoria, type FiltrosDeAuditoria } from './api';

const instante = (iso: string) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));
const linha = (e: EventoDeAuditoria, ativa: boolean, selecionar: () => void) => {
  return <li key={e.id}><button type="button" onClick={selecionar} aria-current={ativa ? 'true' : undefined}
    className={cn('grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-md gap-y-xs border-b border-border px-md py-md text-left hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring tablet:grid-cols-[minmax(8rem,1fr)_minmax(8rem,1fr)_minmax(8rem,1fr)_minmax(8rem,1fr)]',ativa&&'bg-accent/50')}>
    <span className="min-w-0"><b className="block truncate text-title-sm text-foreground">{e.agent??e.ator??e.actor_id??e.actor_kind}</b><small className="block truncate font-mono text-code-xs text-muted-foreground">{e.event_type}</small></span>
    <span className="col-span-2 truncate text-body-sm text-foreground tablet:col-span-1">{e.empresa??e.empresa_id}</span>
    <span className="col-span-2 truncate text-body-sm text-muted-foreground tablet:col-span-1">{e.decision??e.state??'Evento registrado'}</span>
    <span className="flex flex-wrap items-center gap-x-xs gap-y-0"><time dateTime={e.occurred_at} className="text-label-sm tabular-nums text-muted-foreground">{instante(e.occurred_at)}</time><small className="flex items-center gap-xs text-label-sm text-muted-foreground"><ShieldCheck aria-hidden="true" className={cn('size-icon-sm',e.integridade==='VALIDA'?'text-success-indicator':e.integridade==='INVALIDA'?'text-danger-indicator':'text-warning-indicator')}/>{e.integridade}</small></span>
  </button></li>;
};

export const TrilhaDeAuditoria = () => {
  const params=useSearchParams(), router=useRouter();
  const sessao=useSessao();
  const [payloadRevelado,setPayloadRevelado]=useState<Readonly<{id:string;payload:unknown}>|null>(null);
  const [exportacaoId,setExportacaoId]=useState<string|null>(null);
  const filtros: FiltrosDeAuditoria=useMemo(()=>Object.fromEntries([...params.entries()].filter(([k])=>k!=='evento').map(([k,v])=>[k,v])),[params]);
  const pagina=Math.max(1,Number(params.get('pagina')??'1')||1);
  const lista=useQuery({queryKey:['auditoria',filtros],queryFn:()=>listarAuditoria({...filtros,pagina,limite:25}),placeholderData:(old)=>old});
  const id=params.get('evento');
  const detalhe=useQuery({queryKey:['auditoria','detalhe',id],queryFn:()=>obterEventoDeAuditoria(id??''),enabled:id!==null});
  const exportacao=useQuery({queryKey:['auditoria','exportacao',exportacaoId],queryFn:()=>obterEstadoDaExportacao(exportacaoId??''),enabled:exportacaoId!==null,refetchInterval:(query)=>query.state.data?.estado==='PENDENTE'||query.state.data?.estado==='PROCESSANDO'?1_500:false});
  const revelar=useMutation({mutationFn:({eventId,justificativa}:{eventId:string;justificativa:string})=>revelarPayloadDeAuditoria(eventId,justificativa),onSuccess:(resultado)=>{setPayloadRevelado({id:resultado.eventId,payload:resultado.payload});toast.success('Revelação registrada na trilha de auditoria.');},onError:()=>toast.error('Não foi possível revelar o payload. A justificativa foi preservada.')});
  const exportar=useMutation({mutationFn:(formato:'JSON'|'CSV')=>exportarAuditoria({...filtros,pagina,limite:25},formato),onSuccess:(a)=>{
    setExportacaoId(a.id);
    toast.success('Exportação enfileirada. Você pode acompanhar o processamento nesta tela.');
  },onError:()=>toast.error('Não foi possível solicitar a exportação da trilha.')});
  const atualizar=(key:string,value:string)=>{const p=new URLSearchParams(params.toString());if(value)p.set(key,value);else p.delete(key);if(key!=='pagina')p.delete('pagina');router.replace('/auditoria?'+p.toString(),{scroll:false});};
  const eventos=lista.data?.eventos??[], total=lista.data?.total??0, paginas=Math.max(1,Math.ceil(total/25));
  return <main className="flex flex-col gap-lg">
    <header className="flex flex-wrap items-start justify-between gap-md"><div><p className="mb-xs flex items-center gap-xs text-label-md font-medium text-primary"><Fingerprint aria-hidden="true" className="size-icon-sm"/>GOVERNANÇA OPERACIONAL</p><h1 className="text-headline-lg text-foreground">Trilha de auditoria</h1><p className="mt-xs max-w-prose text-body-sm text-muted-foreground">Eventos imutáveis de agentes, decisões humanas e regras. Conteúdo sensível aparece redigido.</p></div><div className="flex gap-xs"><Button variante="contorno" tamanho="compacto" disabled={exportar.isPending} onClick={()=>exportar.mutate('JSON')}><ArrowDownToLine aria-hidden="true"/>JSON</Button><Button variante="contorno" tamanho="compacto" disabled={exportar.isPending} onClick={()=>exportar.mutate('CSV')}><ArrowDownToLine aria-hidden="true"/>CSV</Button></div></header>
    {exportacaoId&&<section aria-live="polite" aria-label="Estado da exportação" className="flex flex-wrap items-center justify-between gap-sm rounded-lg border border-border bg-card px-md py-sm text-body-sm">
      {exportacao.isError?<p>Não foi possível consultar o estado da exportação.</p>:!exportacao.data||exportacao.data.estado==='PENDENTE'||exportacao.data.estado==='PROCESSANDO'?<p className="flex items-center gap-xs"><FileClock aria-hidden="true" className="size-icon-sm"/>Preparando exportação…</p>:exportacao.data.estado==='CONCLUIDA'?<><p>Arquivo pronto · {exportacao.data.item_count?.toLocaleString('pt-BR')??0} eventos · SHA-256 {exportacao.data.artifact_sha256}</p><a className="text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={`/api/proxy/fiscal/auditoria/exportacoes/${exportacaoId}/download`}>Baixar arquivo</a><p>Disponível até {exportacao.data.expires_at?instante(exportacao.data.expires_at):'expiração programada'}</p></>:exportacao.data.estado==='EXPIRADA'?<p>Arquivo expirado e removido.</p>:<p>Falha ao gerar arquivo · {exportacao.data.error_code??'Tente novamente.'}</p>}
    </section>}
    <section aria-label="Filtros de auditoria" className="grid gap-md rounded-lg border border-border bg-card p-md tablet:grid-cols-2 desktop:grid-cols-4">
      {(['inicio','fim','empresaId','atorId','agente','tipo','estado','correlationId'] as const).map(k=><Campo key={k} rotulo={{inicio:'De (AAAA-MM-DD)',fim:'Até (AAAA-MM-DD)',empresaId:'Empresa (ID)',atorId:'Ator (ID)',agente:'Agente',tipo:'Tipo de evento',estado:'Estado',correlationId:'Correlation ID'}[k]} value={params.get(k)??''} onValorChange={v=>atualizar(k,v)}/>)}
      <Select rotulo="Integridade" placeholder="Todos os estados" valor={params.get('integridade')??undefined} onValorChange={v=>atualizar('integridade',v)} opcoes={[{valor:'VALIDA',rotulo:'Válida'},{valor:'INVALIDA',rotulo:'Inválida'},{valor:'NAO_VERIFICAVEL',rotulo:'Não verificável'}]}/>
      <div className="flex items-end"><Button variante="fantasma" tamanho="compacto" onClick={()=>router.replace('/auditoria',{scroll:false})}>Limpar filtros</Button></div>
    </section>
    <section className={cn('grid min-w-0 gap-lg',id&&'desktop:grid-cols-[minmax(0,1.4fr)_minmax(20rem,.9fr)]')} aria-label="Eventos registrados">
      <div className="min-w-0 overflow-hidden rounded-lg border border-border bg-card"><div className="flex items-center justify-between gap-sm border-b border-border px-md py-md"><div><h2 className="text-headline-sm text-foreground">Eventos</h2><p className="text-label-sm text-muted-foreground">{lista.isFetching?'Atualizando…':total.toLocaleString('pt-BR')+' registros no recorte'}</p></div><span className="inline-flex items-center gap-xs rounded-md bg-secondary px-sm py-xs text-label-sm text-secondary-foreground"><ShieldCheck aria-hidden="true" className="size-icon-sm"/>Somente leitura</span></div>
        <div className="hidden grid-cols-4 gap-md bg-muted px-md py-sm text-label-sm font-medium text-muted-foreground tablet:grid"><span>Agente / ator</span><span>Empresa</span><span>Decisão / estado</span><span>Instante e integridade</span></div>
        {lista.isPending?<div className="space-y-sm p-md" aria-label="Carregando"><Skeleton className="h-14"/><Skeleton className="h-14"/><Skeleton className="h-14"/> </div>:lista.isError?<div className="p-md"><ErroDeTela titulo="Falha na consulta" descricao="A trilha não carregou. Filtros continuam na URL."/></div>:eventos.length===0?<div className="p-md"><EmptyState icone={<FileClock/>} titulo="Nenhum evento neste recorte" descricao="Amplie o período ou remova filtros para consultar outros eventos." nivel={3}/></div>:<ul>{eventos.map(e=>linha(e,id===e.id,()=>atualizar('evento',e.id)))}</ul>}
        <footer className="flex items-center justify-between border-t border-border px-md py-sm text-body-sm text-muted-foreground"><span>Página {pagina} de {paginas}</span><div className="flex gap-xs"><Button variante="contorno" tamanho="compacto" aria-label="Página anterior" disabled={pagina<=1} onClick={()=>atualizar('pagina',String(pagina-1))}><ChevronLeft/></Button><Button variante="contorno" tamanho="compacto" aria-label="Próxima página" disabled={pagina>=paginas} onClick={()=>atualizar('pagina',String(pagina+1))}><ChevronRight/></Button></div></footer>
      </div>
      {id?<aside className="min-w-0 rounded-lg border border-border bg-card" aria-label="Detalhe do evento"><div className="flex items-start justify-between gap-sm border-b border-border px-md py-md"><div><p className="text-label-sm text-muted-foreground">DETALHE DO EVENTO</p><h2 className="mt-xs break-all font-mono text-code-sm text-foreground">{id}</h2></div><Button variante="fantasma" tamanho="compacto" onClick={()=>{setPayloadRevelado(null);atualizar('evento','');}}>Fechar</Button></div>
        {detalhe.isPending?<div className="space-y-sm p-md"><Skeleton className="h-8"/><Skeleton className="h-24"/></div>:detalhe.isError||!detalhe.data?<div className="p-md"><ErroDeTela titulo="Detalhe indisponível" descricao="Evento ausente, fora da carteira ou falha parcial de leitura."/></div>:<div className="space-y-md p-md"><p className="flex items-center gap-xs text-body-sm"><Check aria-hidden="true" className={cn('size-icon-sm',detalhe.data.envelope_valido?'text-success-indicator':'text-danger-indicator')}/>Envelope {detalhe.data.envelope_valido?'íntegro':'com hash divergente'}</p><dl className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-sm gap-y-xs text-body-sm"><dt className="text-muted-foreground">Tipo</dt><dd className="break-all font-mono text-code-xs">{detalhe.data.event_type}</dd><dt className="text-muted-foreground">Instante</dt><dd>{instante(detalhe.data.occurred_at)}</dd><dt className="text-muted-foreground">Payload</dt><dd>{String(detalhe.data.payload_status)}</dd><dt className="text-muted-foreground">SHA-256</dt><dd className="break-all font-mono text-code-xs">{String(detalhe.data['envelope_sha256']??'')}</dd></dl>{detalhe.data.payload_status==='DISPONIVEL'?<div><h3 className="mb-xs text-title-sm text-foreground">{payloadRevelado?.id===id?'Payload integral revelado':'Payload redigido'}</h3><pre className="max-h-72 overflow-auto rounded-md bg-muted p-sm font-mono text-code-xs text-foreground">{JSON.stringify(payloadRevelado?.id===id?payloadRevelado.payload:detalhe.data.payload,null,2)}</pre>{payloadRevelado?.id!==id&&sessao.data?.permissoes.includes('usuarios.auditoria_payload.revelar')?<DialogoDeJustificativa gatilho={<Button variante="contorno" tamanho="compacto">Revelar conteúdo integral</Button>} titulo="Revelar payload integral?" descricao="A justificativa e sua identidade serão registradas como evento append-only. Operação somente para admin_escritorio." rotuloDeConfirmacao="Confirmar revelação" ocupado={revelar.isPending} aoConfirmar={(justificativa)=>revelar.mutateAsync({eventId:id,justificativa})}/>:null}</div>:<p className="rounded-md bg-secondary p-sm text-body-sm text-muted-foreground">Conteúdo expirado ou indisponível. Hash e metadados permanecem no ledger.</p>}<p className="text-label-sm text-muted-foreground">Payload: {detalhe.data.payload_valido?'hash confere ou conteúdo ausente':'divergência detectada'}</p></div>}</aside>:null}
    </section>
  </main>;
};
