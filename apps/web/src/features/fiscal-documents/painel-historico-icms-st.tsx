'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Download, FileArchive } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Campo } from '@/components/ui/campo';
import { Select } from '@/components/ui/select';
import { StatusBadge } from '@/components/ui/status-badge';
import { baixarPacoteHistoricoIcmsSt, gerarPacoteHistoricoIcmsSt } from './api';

type Pacote=Readonly<{id:string;hash:string;reused:boolean;package:Record<string,unknown>}>;
const REGIMES=[{valor:'SIMPLES_NACIONAL',rotulo:'Simples Nacional'},{valor:'LUCRO_PRESUMIDO',rotulo:'Lucro Presumido'}] as const;
const periodoValido=(value:string)=>/^201[6-7]-(0[1-9]|1[0-2])$|^2018-(0[1-2])$/u.test(value);
const asNumber=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)?value:0;
const moeda=(cents:unknown)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(asNumber(cents)/100);
const texto=(value:unknown,fallback='—')=>typeof value==='string'?value:fallback;

export const PainelHistoricoIcmsSt=({empresaId,podeGerar}:{empresaId:string;podeGerar:boolean})=>{
  const [regime,setRegime]=useState<'SIMPLES_NACIONAL'|'LUCRO_PRESUMIDO'>('SIMPLES_NACIONAL');
  const [periodStart,setPeriodStart]=useState('2016-10');
  const [periodEnd,setPeriodEnd]=useState('2018-02');
  const [active,setActive]=useState<Pacote|null>(null);
  const queryClient=useQueryClient();
  const generate=useMutation({mutationFn:()=>gerarPacoteHistoricoIcmsSt(empresaId,{regime,periodStart,periodEnd}),onSuccess:(result)=>{
    setActive(result);void queryClient.invalidateQueries({queryKey:['sessao','eu','apuracoes-icms-st',empresaId]});toast.success(result.reused?'Dossiê reproduzido com o mesmo hash.':'Dossiê interno gerado.');
  },onError:()=>toast.error('Não foi possível gerar o dossiê. Confira o regime histórico e tente novamente.')});
  const download=useMutation({mutationFn:(format:'PDF'|'CSV'|'JSON')=>baixarPacoteHistoricoIcmsSt(empresaId,active!.id,format),onSuccess:(file)=>{
    const url=URL.createObjectURL(file.blob),anchor=document.createElement('a');anchor.href=url;anchor.download=file.filename;anchor.click();URL.revokeObjectURL(url);toast.success('Arquivo privado preparado para conferência.');
  },onError:()=>toast.error('Não foi possível baixar este artefato.')});
  const pkg=active?.package??{};const lines=Array.isArray(pkg['lines'])?pkg['lines'] as Record<string,unknown>[]:[];
  const excluded=Array.isArray(pkg['excludedCompetences'])?pkg['excludedCompetences'] as Record<string,unknown>[]:[];
  const status=texto(pkg['status']);
  return <section aria-labelledby="historico-icms-title" className="flex flex-col gap-md border-t border-border pt-lg">
    <header className="flex flex-wrap items-start justify-between gap-md"><div><p className="text-label-sm uppercase tracking-wide text-muted-foreground">F33 · memória fiscal interna</p>
      <h4 id="historico-icms-title" className="mt-xs font-display text-title-md text-foreground">Reconstrução histórica do ICMS-ST</h4>
      <p className="mt-xs max-w-3xl text-body-sm text-muted-foreground">Consolida somente revisões aprovadas de origem. Principal, estornos, fonte, regra e hashes ficam rastreáveis; não recalcula a F29 nem transmite escrituração.</p></div>
      {active?<StatusBadge tom={status==='POSSIBLY_OUTDATED'?'critico':'atencao'} rotulo={status==='POSSIBLY_OUTDATED'?'Possivelmente desatualizado':'Bloqueado por acréscimos legais · F34'}/>:null}</header>
    <div className="grid gap-md rounded-lg border border-border bg-card p-md tablet:grid-cols-2 desktop:grid-cols-4">
      <Select rotulo="Regime histórico" valor={regime} opcoes={REGIMES} onValorChange={value=>setRegime(value as typeof regime)} disabled={!podeGerar}/>
      <Campo rotulo="Competência inicial" type="month" min="2016-10" max="2018-02" value={periodStart} onValorChange={setPeriodStart} disabled={!podeGerar}/>
      <Campo rotulo="Competência final" type="month" min="2016-10" max="2018-02" value={periodEnd} onValorChange={setPeriodEnd} disabled={!podeGerar}/>
      <div className="flex items-end"><Button className="w-full" disabled={!podeGerar||generate.isPending||!periodoValido(periodStart)||!periodoValido(periodEnd)||periodStart>periodEnd}
        onClick={()=>generate.mutate()}>{generate.isPending?'Reconstruindo…':<><FileArchive aria-hidden="true"/>Gerar dossiê interno</>}</Button></div>
      <p className="text-label-sm text-muted-foreground tablet:col-span-2 desktop:col-span-4">Cobertura fixa: autopeças em Goiás, fato original entre 27/10/2016 e 28/02/2018. Período sem revisão aprovada aparece como excluído, sem estimativa.</p>
    </div>
    {generate.isError?<div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-md text-body-sm text-foreground">A reconstrução não foi concluída. Verifique se o regime informado corresponde ao histórico da empresa.</div>:null}
    {active?<div className="grid gap-md rounded-lg border border-border bg-card p-md">
      <div className="grid gap-md tablet:grid-cols-2 desktop:grid-cols-4"><div><p className="text-label-sm text-muted-foreground">Restituição bruta</p><p className="mt-xs text-title-sm tabular-nums text-foreground">{moeda(pkg['grossRestitutionCents'])}</p></div>
        <div><p className="text-label-sm text-muted-foreground">Complemento bruto</p><p className="mt-xs text-title-sm tabular-nums text-foreground">{moeda(pkg['grossComplementCents'])}</p></div>
        <div><p className="text-label-sm text-muted-foreground">Estornos de restituição / complemento</p><p className="mt-xs text-title-sm tabular-nums text-foreground">{moeda(pkg['reversedRestitutionCents'])} / {moeda(pkg['reversedComplementCents'])}</p></div>
        <div><p className="text-label-sm text-muted-foreground">Saldo líquido de principal</p><p className="mt-xs text-title-sm tabular-nums text-foreground">{moeda(pkg['netPrincipalBalanceCents'])}</p></div></div>
      <div className="rounded-md border border-warning/40 bg-warning/5 p-md"><p className="text-label-sm font-medium text-foreground">Uso externo bloqueado</p><p className="mt-xs text-body-sm text-muted-foreground">O pacote contém apenas principal. Juros, multa, atualização e data efetiva de lançamento/pagamento pertencem à F34/SPEC-034.</p></div>
      <div className="flex flex-wrap items-center justify-between gap-sm"><p className="break-all font-mono text-label-sm text-muted-foreground">Hash SHA-256 · {active.hash}</p>
        <div className="flex flex-wrap gap-xs">{(['PDF','CSV','JSON'] as const).map(format=><Button key={format} variante="contorno" tamanho="compacto" disabled={download.isPending} onClick={()=>download.mutate(format)}><Download aria-hidden="true"/>{format}</Button>)}</div></div>
      {excluded.length?<div><h5 className="font-display text-title-sm text-foreground">Competências excluídas ou com evidência pendente</h5><ul className="mt-xs grid gap-xs tablet:grid-cols-2">{excluded.map((item,index)=><li key={`${texto(item['competence'])}-${index}`} className="rounded-md bg-muted/50 p-sm text-body-sm"><span className="font-medium text-foreground">{texto(item['competence'])}</span><span className="ml-sm text-muted-foreground">{Array.isArray(item['reasonCodes'])?(item['reasonCodes'] as unknown[]).map(String).join(', '):'Fonte sem cobertura'}</span></li>)}</ul></div>:null}
      <div className="overflow-x-auto rounded-md border border-border"><table className="w-full min-w-[800px] text-left text-body-sm"><caption className="sr-only">Linhas e memórias causais do pacote histórico</caption><thead className="bg-muted/60 text-label-sm text-muted-foreground"><tr>{['Competência','Origem','Documento / evento','Item','Restituição','Complemento','Regra / fórmula'].map(label=><th key={label} scope="col" className="px-sm py-sm">{label}</th>)}</tr></thead><tbody>{lines.length?lines.map((line,index)=><tr key={`${texto(line['sourceLineId'])}-${index}`} className="border-t border-border/70"><td className="px-sm py-sm tabular-nums">{texto(line['competence'])}</td><td className="px-sm py-sm">{line['sourceKind']==='APPROVED_RETURN_REVERSAL'?'Estorno aprovado':'Revisão aprovada'}</td><td className="px-sm py-sm font-mono text-label-sm">{texto(line['documentId'],'Evento posterior')}</td><td className="px-sm py-sm">{texto(line['itemId'])}</td><td className="px-sm py-sm tabular-nums">{moeda(line['restitutionPrincipalCents'])}</td><td className="px-sm py-sm tabular-nums">{moeda(line['complementPrincipalCents'])}</td><td className="px-sm py-sm">{texto(line['sourceMemory']&&typeof line['sourceMemory']==='object'?(line['sourceMemory'] as Record<string,unknown>)['ruleId']:null)} · {texto(line['sourceMemory']&&typeof line['sourceMemory']==='object'?(line['sourceMemory'] as Record<string,unknown>)['formulaVersion']:null)}</td></tr>):<tr><td colSpan={7} className="px-md py-lg text-center text-muted-foreground">Nenhuma linha aprovada com memória causal completa no período.</td></tr>}</tbody></table></div>
    </div>:<p className="rounded-md border border-dashed border-border p-md text-body-sm text-muted-foreground">Selecione regime e período para revisar a cobertura antes de gerar o pacote.</p>}
  </section>;
};
