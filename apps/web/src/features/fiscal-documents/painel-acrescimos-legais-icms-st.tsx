'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Download, FileText, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Campo } from '@/components/ui/campo';
import { Select } from '@/components/ui/select';
import { StatusBadge } from '@/components/ui/status-badge';
import { aprovarFonteF33ParaF34, baixarAcrescimosLegaisF34, calcularAcrescimosLegaisF34, decidirPacoteNormativoF34,
  importarAtoFormalF34, importarPacoteNormativoF34, listarAtosFormaisF34, listarFontesAcrescimosF34, decidirAtoFormalF34,
  listarPacotesNormativosF34, listarResultadosAcrescimosF34, obterResultadoAcrescimosF34, revisarAcrescimosLegaisF34 } from './api';

type RecordValue=Record<string,unknown>;
const value=(record:RecordValue,key:string,fallback='—')=>typeof record[key]==='string'||typeof record[key]==='number'?String(record[key]):fallback;
const money=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)?new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(value/100):'Indeterminado';
const number=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)?value:0;
const JSON_RULES_EXAMPLE='{"version":"versao-identificada","coverageThrough":"AAAA-MM-DD","requiredComponents":{"RESTITUTION":["COMPONENTE"],"COMPLEMENT":["COMPONENTE"]},"rules":[{"id":"identificador-do-ato","version":"versao","component":"COMPONENTE","tracks":["RESTITUTION"],"validFrom":"AAAA-MM-DD","validThrough":"AAAA-MM-DD","formula":"FORMULA_DOCUMENTADA","ratePpm":0,"annualizationDays":1,"termStartBasis":"SOURCE_FACT_DATE","termStartOffsetDays":0,"rounding":"ARREDONDAMENTO_DOCUMENTADO","officialBasis":"Ato e dispositivo aplicáveis","sourceSha256":"<sha256-do-arquivo>"}],"sources":[{"name":"arquivo-oficial.pdf","sha256":"<sha256-do-arquivo>","officialBasis":"Ato e dispositivo aplicáveis","consultedAt":"AAAA-MM-DD"}]}';

export const PainelAcrescimosLegaisIcmsSt=({empresaId,podeGerar}:{empresaId:string;podeGerar:boolean})=>{
  const [sourceId,setSourceId]=useState('');const [ruleId,setRuleId]=useState('');const [referenceDate,setReferenceDate]=useState('');
  const [manifestFile,setManifestFile]=useState<File|null>(null);const [sourceFiles,setSourceFiles]=useState<readonly File[]>([]);
  const [actFile,setActFile]=useState<File|null>(null);const [actIssuer,setActIssuer]=useState('');const [actNumber,setActNumber]=useState('');
  const [actDate,setActDate]=useState('');const [actStart,setActStart]=useState('');const [actEnd,setActEnd]=useState('');const [actBasis,setActBasis]=useState('');
  const [actFacts,setActFacts]=useState('{"components":["INFRACTION_PENALTY"],"penaltyAmounts":[]}');const [active, setActive]=useState<{id:string;hash:string;result:RecordValue}|null>(null);
  const queryClient=useQueryClient();const sources=useQuery({queryKey:['f34','sources',empresaId],queryFn:()=>listarFontesAcrescimosF34(empresaId)});
  const rules=useQuery({queryKey:['f34','rules',empresaId],queryFn:()=>listarPacotesNormativosF34(empresaId)});
  const acts=useQuery({queryKey:['f34','acts',empresaId,sourceId],queryFn:()=>listarAtosFormaisF34(empresaId,sourceId),enabled:Boolean(sourceId)});
  const results=useQuery({queryKey:['f34','results',empresaId,sourceId],queryFn:()=>listarResultadosAcrescimosF34(empresaId,sourceId),enabled:Boolean(sourceId)});
  const refresh=async()=>{await Promise.all([queryClient.invalidateQueries({queryKey:['f34','sources',empresaId]}),queryClient.invalidateQueries({queryKey:['f34','rules',empresaId]}),queryClient.invalidateQueries({queryKey:['f34','acts',empresaId,sourceId]}),queryClient.invalidateQueries({queryKey:['f34','results',empresaId,sourceId]})]);};
  const approveSource=useMutation({mutationFn:(id:string)=>aprovarFonteF33ParaF34(empresaId,id),onSuccess:async()=>{toast.success('Fonte F33 aprovada para cálculo F34.');await refresh();},onError:()=>toast.error('Não foi possível aprovar a fonte F33.')});
  const importRules=useMutation({mutationFn:async()=>{
    if(!manifestFile)throw new Error('Selecione o manifesto JSON do pacote normativo.');
    const manifest=JSON.parse(await manifestFile.text()) as Record<string,unknown>;
    return importarPacoteNormativoF34(empresaId,manifest,sourceFiles);
  },onSuccess:async()=>{setManifestFile(null);setSourceFiles([]);toast.success('Pacote normativo importado. Aguarda revisão humana.');await refresh();},onError:()=>toast.error('Pacote não importado. Confira manifesto, anexos e hashes.')});
  const reviewRules=useMutation({mutationFn:(id:string)=>decidirPacoteNormativoF34(empresaId,id,'APPROVED'),onSuccess:async()=>{toast.success('Pacote normativo aprovado.');await refresh();},onError:()=>toast.error('Não foi possível aprovar o pacote normativo.')});
  const importAct=useMutation({mutationFn:()=>{
    if(!sourceId||!actFile)throw new Error('Fonte F33 e ato formal são obrigatórios.');
    return importarAtoFormalF34(empresaId,sourceId,{issuer:actIssuer,actNumber,actType:'OTHER',actDate,periodStart:actStart,periodEnd:actEnd,officialBasis:actBasis,canonicalFacts:JSON.parse(actFacts) as Record<string,unknown>,arquivo:actFile});
  },onSuccess:async()=>{toast.success('Ato formal importado. Aguarda revisão humana.');setActFile(null);await refresh();},onError:()=>toast.error('Ato não importado. Confira dados e arquivo.')});
  const calculate=useMutation({mutationFn:()=>calcularAcrescimosLegaisF34(empresaId,{sourcePackageId:sourceId,referenceDate,rulePackageId:ruleId||null,
    formalActIds:(acts.data?.itens??[]).filter(item=>item.status==='APPROVED').map(item=>item.id)}),onSuccess:async result=>{
      setActive({id:result.id,hash:result.hash,result:result.result});toast.success(result.reused?'Resultado reproduzido com o mesmo hash.':'Resultado de acréscimos gerado.');await refresh();
    },onError:()=>toast.error('Cálculo não concluído. Confira fontes, pacote e data de referência.')});
  const review=useMutation({mutationFn:()=>active?revisarAcrescimosLegaisF34(empresaId,active.id,'Revisado para conferência interna.'):Promise.reject(),onSuccess:()=>toast.success('Revisão interna registrada.'),onError:()=>toast.error('Revisão não registrada.')});
  const download=useMutation({mutationFn:(format:'PDF'|'CSV'|'JSON')=>active?baixarAcrescimosLegaisF34(empresaId,active.id,format):Promise.reject(),onSuccess:file=>{
    const href=URL.createObjectURL(file.blob),link=document.createElement('a');link.href=href;link.download=file.filename;link.click();URL.revokeObjectURL(href);toast.success('Artefato interno exportado.');
  },onError:()=>toast.error('Exportação falhou.')});
  const selectedSource=sources.data?.itens.find(item=>item.id===sourceId);const data=active?.result??{};const restitution=(data['restitution']&&typeof data['restitution']==='object'?data['restitution']:{}) as RecordValue;
  const complement=(data['complement']&&typeof data['complement']==='object'?data['complement']:{}) as RecordValue;
  const memory=Array.isArray(data['memory'])?data['memory'] as RecordValue[]:[];const gaps=Array.isArray(data['gaps'])?data['gaps'] as RecordValue[]:[];
  const ruleOptions=[{valor:'',rotulo:'Sem pacote normativo aprovado'},...(rules.data?.itens.filter(item=>item.status==='APPROVED').map(item=>({valor:item.id,rotulo:`${item.version} · cobertura até ${item.coverageThrough}`}))??[])];
  return <section aria-labelledby="acrescimos-f34-title" className="flex flex-col gap-md border-t border-border pt-lg">
      <header className="flex flex-wrap items-start justify-between gap-md"><div><p className="text-label-sm uppercase tracking-wide text-muted-foreground">F34 · cálculo fiscal interno</p>
      <h4 id="acrescimos-f34-title" className="mt-xs font-display text-title-md text-foreground">Acréscimos legais do ICMS-ST histórico</h4>
      <p className="mt-xs max-w-3xl text-body-sm text-muted-foreground">Acréscimos separados do principal F33, com linha do tempo legal e memória causal. Pronto significa apenas revisão interna.</p></div>
      {active?<StatusBadge tom={data['status']==='READY_FOR_INTERNAL_REVIEW'?'conforme':'atencao'} rotulo={value(data,'status')}/>:null}</header>

    <div className="grid gap-md rounded-lg border border-border bg-card p-md tablet:grid-cols-2 desktop:grid-cols-4">
      <label className="flex flex-col gap-xs text-label-sm text-foreground">Pacote F33
        <select aria-label="Pacote F33" className="min-h-10 rounded-md border border-input bg-background px-sm text-body-sm" value={sourceId} onChange={event=>{setSourceId(event.target.value);setActive(null);}}>
          <option value="">Selecione uma reconstrução</option>{sources.data?.itens.map(item=><option key={item.id} value={item.id}>{item.periodStart}–{item.periodEnd} · {item.regime} · {item.status}</option>)}
        </select></label>
      <Campo rotulo="Data de referência" type="date" value={referenceDate} onValorChange={setReferenceDate} disabled={!podeGerar}/>
      <Select rotulo="Pacote normativo aprovado" valor={ruleId} opcoes={ruleOptions} onValorChange={setRuleId} disabled={!podeGerar}/>
      <div className="flex items-end"><Button className="w-full" disabled={!podeGerar||!sourceId||!referenceDate||calculate.isPending} onClick={()=>calculate.mutate()}>{calculate.isPending?'Calculando…':'Calcular acréscimos'}</Button></div>
      {selectedSource&&!selectedSource.approved?<div className="flex flex-wrap items-center justify-between gap-sm rounded-md border border-warning/40 bg-warning/5 p-sm text-body-sm tablet:col-span-2 desktop:col-span-4">
        <p className="text-foreground">Aprovação humana da fonte F33 necessária. O cálculo segue indeterminado até aprovação.</p>
        <Button variante="contorno" tamanho="compacto" disabled={!podeGerar||approveSource.isPending||!selectedSource.periodComplete||selectedSource.superseded} onClick={()=>approveSource.mutate(sourceId)}><ShieldCheck aria-hidden="true"/>Aprovar fonte F33</Button></div>:null}
      {!rules.data?.itens.some(item=>item.status==='APPROVED')&&<p className="rounded-md border border-warning/40 bg-warning/5 p-sm text-body-sm text-foreground tablet:col-span-2 desktop:col-span-4">Nenhum pacote normativo aprovado. Não há taxa presumida; resultado será INDETERMINATE.</p>}
    </div>

    <details className="rounded-md border border-border bg-card p-md"><summary className="cursor-pointer text-title-sm text-foreground">Importar pacote normativo oficial</summary>
      <p className="mt-sm max-w-3xl text-body-sm text-muted-foreground">Manifesto JSON descreve vigências, fórmulas, arredondamento e hash. Exemplo estrutural: substitua todos os marcadores pela regra e evidência oficiais; valores de exemplo não são regra legal. Anexe cada fonte com nome e hash idênticos. Importação fica pendente até revisão humana.</p>
      <pre className="mt-sm overflow-x-auto rounded bg-muted/50 p-sm text-label-sm text-muted-foreground">{JSON_RULES_EXAMPLE}</pre>
      <div className="mt-md grid gap-md tablet:grid-cols-2"><label className="flex flex-col gap-xs text-label-sm text-foreground">Manifesto do pacote<input aria-label="Manifesto JSON" type="file" accept="application/json,.json" onChange={event=>setManifestFile(event.target.files?.[0]??null)} className="text-body-sm file:mr-sm file:rounded-md file:border-0 file:bg-muted file:px-sm file:py-xs file:text-foreground"/></label>
        <label className="flex flex-col gap-xs text-label-sm text-foreground">Fontes oficiais<input aria-label="Fontes oficiais" type="file" multiple onChange={event=>setSourceFiles(Array.from(event.target.files??[]))} className="text-body-sm file:mr-sm file:rounded-md file:border-0 file:bg-muted file:px-sm file:py-xs file:text-foreground"/></label></div>
      <div className="mt-md flex flex-wrap items-center justify-between gap-sm"><p className="text-label-sm text-muted-foreground">{manifestFile?.name??'Nenhum manifesto'} · {sourceFiles.length} fontes anexadas</p>
        <Button variante="contorno" disabled={!podeGerar||!manifestFile||importRules.isPending} onClick={()=>importRules.mutate()}><FileText aria-hidden="true"/>Importar e conferir hashes</Button></div>
      {rules.data?.itens.map(item=><div key={item.id} className="mt-sm flex flex-wrap items-center justify-between gap-sm border-t border-border pt-sm text-body-sm"><span className="text-foreground">{item.version} · cobertura {item.coverageThrough} · {item.status}</span>
        {item.status==='IMPORTED'?<Button variante="contorno" tamanho="compacto" disabled={!podeGerar} onClick={()=>reviewRules.mutate(item.id)}>Aprovar pacote</Button>:null}</div>)}
    </details>

    {sourceId?<details className="rounded-md border border-border bg-card p-md"><summary className="cursor-pointer text-title-sm text-foreground">Atos formais para penalidade por infração</summary>
      <p className="mt-sm text-body-sm text-muted-foreground">Penalidade exige ato íntegro, vinculado à fonte F33, com fatos e fundamento suficientes. Ato ausente ou incompleto mantém componente indeterminado.</p>
      <div className="mt-md grid gap-md tablet:grid-cols-2 desktop:grid-cols-4"><Campo rotulo="Órgão emissor" value={actIssuer} onValorChange={setActIssuer}/><Campo rotulo="Número do ato" value={actNumber} onValorChange={setActNumber}/>
        <Campo rotulo="Data do ato" type="date" value={actDate} onValorChange={setActDate}/><Campo rotulo="Início do período" type="date" value={actStart} onValorChange={setActStart}/>
        <Campo rotulo="Fim do período" type="date" value={actEnd} onValorChange={setActEnd}/><Campo rotulo="Fundamento oficial" value={actBasis} onValorChange={setActBasis}/>
        <label className="flex flex-col gap-xs text-label-sm text-foreground tablet:col-span-2">Fatos estruturados do ato<textarea aria-label="Fatos do ato formal" value={actFacts} onChange={event=>setActFacts(event.target.value)} rows={3} className="rounded-md border border-input bg-background p-sm font-mono text-label-sm text-foreground"/></label>
        <label className="flex flex-col gap-xs text-label-sm text-foreground">Arquivo do ato<input aria-label="Arquivo do ato formal" type="file" onChange={event=>setActFile(event.target.files?.[0]??null)} className="text-body-sm file:mr-sm file:rounded-md file:border-0 file:bg-muted file:px-sm file:py-xs file:text-foreground"/></label></div>
      <div className="mt-md flex justify-end"><Button variante="contorno" disabled={!podeGerar||!actFile||importAct.isPending} onClick={()=>importAct.mutate()}>Importar ato formal</Button></div>
      {acts.data?.itens.map(item=><div key={item.id} className="mt-sm flex flex-wrap items-center justify-between gap-sm border-t border-border pt-sm text-body-sm"><span className="text-foreground">{item.issuer} · {item.actNumber} · {item.actDate} · {item.components.join(', ')||'sem componentes'} · {item.status}</span>
        {item.status==='IMPORTED'?<Button variante="contorno" tamanho="compacto" disabled={!podeGerar} onClick={()=>decidirAtoFormalF34(empresaId,item.id,'APPROVED').then(refresh).catch(()=>toast.error('Revisão do ato formal falhou.'))}>Aprovar ato</Button>:null}</div>)}
    </details>:null}

    {active?<div className="flex flex-col gap-md rounded-lg border border-border bg-card p-md">
      <div className="grid gap-md tablet:grid-cols-2"><Track title="Restituição" track={restitution}/><Track title="Complemento" track={complement}/></div>
      {gaps.length?<div role="status" className="rounded-md border border-warning/40 bg-warning/5 p-md"><h5 className="font-medium text-foreground">Lacunas que mantêm o resultado indeterminado</h5><ul className="mt-xs grid gap-xs">{gaps.map((gap,index)=><li key={`${value(gap,'component')}-${index}`} className="text-body-sm text-foreground">{value(gap,'track')} · {value(gap,'component')} · {value(gap,'from')}–{value(gap,'through')} · {value(gap,'reason')}</li>)}</ul></div>:null}
      <div className="overflow-x-auto rounded-md border border-border"><table className="w-full min-w-[900px] text-left text-body-sm"><caption className="sr-only">Memória causal de acréscimos por competência e vigência</caption><thead className="bg-muted/60 text-label-sm text-muted-foreground"><tr>{['Trilha','Componente','Vigência','Regra','Principal','Acréscimo','Fundamento','Hash da fonte'].map(label=><th key={label} scope="col" className="px-sm py-sm">{label}</th>)}</tr></thead>
        <tbody>{memory.map((item,index)=><tr key={`${value(item,'ruleId')}-${index}`} className="border-t border-border/70"><td className="px-sm py-sm">{value(item,'track')}</td><td className="px-sm py-sm">{value(item,'component')}</td><td className="px-sm py-sm tabular-nums">{value(item,'from')}–{value(item,'through')}</td><td className="px-sm py-sm">{value(item,'ruleId')} · v{value(item,'ruleVersion')}</td><td className="px-sm py-sm tabular-nums">{money(number(item['principalCents']))}</td><td className="px-sm py-sm tabular-nums">{money(number(item['amountCents']))}</td><td className="px-sm py-sm">{value(item,'officialBasis')}</td><td className="px-sm py-sm font-mono text-label-sm">{value(item,'sourceSha256')}</td></tr>)}
        {!memory.length?<tr><td colSpan={8} className="px-md py-lg text-center text-muted-foreground">Sem trecho calculável; consulte lacunas e cobertura normativa.</td></tr>:null}</tbody></table></div>
      <div className="flex flex-wrap items-center justify-between gap-sm"><p className="break-all font-mono text-label-sm text-muted-foreground">Hash reproduzível · {active.hash}</p><div className="flex flex-wrap gap-xs">
      <Button variante="contorno" tamanho="compacto" disabled={review.isPending||data['status']!=='READY_FOR_INTERNAL_REVIEW'} onClick={()=>review.mutate()}>Registrar revisão</Button>{(['PDF','CSV','JSON'] as const).map(format=><Button key={format} variante="contorno" tamanho="compacto" disabled={download.isPending} onClick={()=>download.mutate(format)}><Download aria-hidden="true"/>{format}</Button>)}</div></div>
      <p className="text-label-sm text-muted-foreground">Rascunho interno. Sem transmissão, escrituração, apropriação, guia, pagamento ou lançamento financeiro.</p>
    </div>:<p className="rounded-md border border-dashed border-border p-md text-body-sm text-muted-foreground">Selecione fonte F33, data de referência e pacote aprovado. Cobertura ausente preserva principal e marca componentes desconhecidos.</p>}
    {results.data?.itens.length?<div><h5 className="font-display text-title-sm text-foreground">Histórico de resultados</h5><ul className="mt-xs grid gap-xs">{results.data.itens.map(result=><li key={result.id} className="flex flex-wrap items-center justify-between gap-sm border-b border-border py-sm text-body-sm"><span className="text-foreground">{result.referenceDate} · {result.status} · {result.hash.slice(0,16)}…</span><Button variante="contorno" tamanho="compacto" onClick={()=>obterResultadoAcrescimosF34(empresaId,result.id).then(value=>setActive({id:value.id,hash:value.hash,result:value.result})).catch(()=>toast.error('Resultado não carregado.'))}>Abrir resultado</Button></li>)}</ul></div>:null}
  </section>;
};

const Track=({title,track}:{title:string;track:RecordValue})=><section className="rounded-md border border-border p-md"><h5 className="font-display text-title-sm text-foreground">{title}</h5>
  <dl className="mt-sm grid gap-sm tablet:grid-cols-2">{([['Principal','principalCents'],['Atualização monetária','monetaryUpdateCents'],['Juros de mora','lateInterestCents'],['Multa de mora','latePaymentFineCents'],['Penalidade por infração','infractionPenaltyCents'],['Total da trilha','totalCents']] as const).map(([label,key])=><div key={key} className="flex items-baseline justify-between gap-sm border-b border-border/70 pb-xs"><dt className="text-body-sm text-muted-foreground">{label}</dt><dd className="tabular-nums text-body-sm font-medium text-foreground">{track[key]===null?'Indeterminado':money(number(track[key]))}</dd></div>)}</dl></section>;
