'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Search, ShieldCheck, ShieldAlert, RefreshCw, X } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Campo } from '@/components/ui/campo';
import { Skeleton } from '@/components/ui/estados';
import { cn } from '@/lib/cn';
import { concede } from '../cofre/permissoes';
import { listarContasAnaliticas, listarCentrosAnaliticos } from '../lancamentos-contabeis/api';
import { listarEmpresas } from '../empresa/api';
import { useSessao } from '../usuarios/queries';
import { listarMovimentosRazao, obterBalancete, obterDetalheDoMovimento, reconstruirRazao, verificarIntegridadeRazao, type LinhaBalancete } from './api';

const CAMPO = 'h-10 w-full min-w-0 rounded-md border border-input bg-background px-md text-body-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';
const rotuloSaldo = (nature: 'DEBIT' | 'CREDIT' | 'ZERO') => nature === 'DEBIT' ? 'Devedor' : nature === 'CREDIT' ? 'Credor' : 'Zero';
const dinheiro = (centavos: number | string) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(centavos) / 100);
const compAtual = () => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`; };

export const RazaoContabil = ({ empresaId, nomeEmpresa }: { empresaId: string; nomeEmpresa?: string | null }) => {
  const router = useRouter(); const pathname = usePathname(); const search = useSearchParams();
  const { data: session } = useSessao(); const client = useQueryClient();
  const [movementId, setMovementId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const from = search.get('de') ?? compAtual(); const to = search.get('ate') ?? compAtual();
  const view = search.get('visao') === 'balancete' ? 'balancete' : 'razao';
  const accountFilter = search.get('contaId') ?? '';
  const centerFilter = search.get('centroId') ?? 'todos';
  const sideFilter = search.get('lado') ?? '';
  const textFilter = search.get('busca') ?? '';
  const page = Number(search.get('pagina') ?? 1);
  const onlyWithMovement = search.get('somenteMovimento') === 'true';
  const canRead = session !== undefined && concede(session, 'contabil.razao.consultar');
  const canVerify = session !== undefined && concede(session, 'contabil.razao.verificar_integridade');
  const canRebuild = session !== undefined && concede(session, 'contabil.razao.reconstruir_projecao');
  const accounts = useQuery({ queryKey: ['ledger-accounts', empresaId], queryFn: () => listarContasAnaliticas(empresaId), enabled: Boolean(empresaId && canRead) });
  const centers = useQuery({ queryKey: ['ledger-cost-centers', empresaId], queryFn: () => listarCentrosAnaliticos(empresaId), enabled: Boolean(empresaId && canRead) });
  const movementQuery = useQuery({
    queryKey: ['ledger-movements', empresaId, from, to, accountFilter, centerFilter, sideFilter, textFilter, page],
    queryFn: () => listarMovimentosRazao(empresaId, from, to, { contaId: accountFilter, centroId: centerFilter, lado: sideFilter, busca: textFilter, pagina: String(page), limite: '50' }),
    enabled: Boolean(empresaId && canRead && view === 'razao' && from <= to),
  });
  const trialQuery = useQuery({
    queryKey: ['ledger-trial-balance', empresaId, from, to, centerFilter, onlyWithMovement],
    queryFn: () => obterBalancete(empresaId, from, to, centerFilter, onlyWithMovement),
    enabled: Boolean(empresaId && canRead && view === 'balancete' && from <= to),
  });
  const detailQuery = useQuery({ queryKey: ['ledger-movement-detail', empresaId, movementId], queryFn: () => obterDetalheDoMovimento(empresaId, movementId!), enabled: Boolean(movementId) });
  const verify = useMutation({ mutationFn: () => verificarIntegridadeRazao(empresaId), onSuccess: (result) => { toast.success(result.status === 'CONSISTENT' ? 'Projeção consistente com os lançamentos.' : 'Divergência encontrada. Detalhes registrados.'); void client.invalidateQueries({ queryKey: ['ledger-movements', empresaId] }); void client.invalidateQueries({ queryKey: ['ledger-trial-balance', empresaId] }); }, onError: () => toast.error('Não foi possível verificar a projeção.') });
  const rebuild = useMutation({ mutationFn: () => reconstruirRazao(empresaId, from, to), onSuccess: (result) => { if (result.status === 'CONSISTENT') toast.success(`Projeção reconstruída na versão ${result.projectionVersion}.`); else toast.error('Reconstrução falhou. Versão ativa preservada.'); void client.invalidateQueries({ queryKey: ['ledger-movements', empresaId] }); void client.invalidateQueries({ queryKey: ['ledger-trial-balance', empresaId] }); }, onError: () => toast.error('Reconstrução falhou. Versão ativa preservada.') });
  const current = view === 'razao' ? movementQuery.data : trialQuery.data;
  const accountsForFilter = accounts.data?.items ?? [];
  const lines = useMemo(() => trialQuery.data?.lines ?? [], [trialQuery.data?.lines]);
  const visibleTree = useMemo(() => lines.filter((line) => {
    let parent = line.parentAccountId;
    while (parent) {
      if (!expanded.has(parent)) return false;
      parent = lines.find((candidate) => candidate.accountId === parent)?.parentAccountId ?? null;
    }
    return true;
  }), [expanded, lines]);

  const setParams = (updates: Record<string, string | null>) => {
    const params = new URLSearchParams(search.toString());
    for (const [key, value] of Object.entries(updates)) { if (value === null || value === '') params.delete(key); else params.set(key, value); }
    const query = params.toString(); router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  if (!canRead) return <section className="rounded-lg border border-border bg-card p-lg" role="status"><h2 className="text-title-md">Permissão insuficiente</h2><p className="mt-sm text-body-sm text-muted-foreground">Seu perfil não pode consultar o razão desta empresa.</p></section>;

  const projection = current;
  const sourceStart = projection?.firstCompetence ?? null;
  const periodValid = from <= to;
  const loading = periodValid && (view === 'razao' ? movementQuery.isPending : trialQuery.isPending);
  const failed = view === 'razao' ? movementQuery.isError : trialQuery.isError;
  const integrity = projection?.integrity;
  const toggle = (line: LinhaBalancete) => setExpanded((previous) => { const next = new Set(previous); if (next.has(line.accountId)) next.delete(line.accountId); else next.add(line.accountId); return next; });

  return <div className="flex min-w-0 flex-col gap-lg">
    <header className="flex flex-wrap items-start justify-between gap-md">
      <div className="min-w-0"><p className="text-label-sm uppercase tracking-wider text-muted-foreground">Contabilidade · {nomeEmpresa ?? 'Empresa'}</p><h1 className="mt-xs text-headline-md">Razão contábil</h1><p className="mt-xs max-w-3xl text-body-sm text-muted-foreground">Movimentos efetivados e saldos derivados desde o primeiro lançamento disponível.</p></div>
      <div className="flex flex-wrap gap-sm">
        {canVerify && <Button variante="contorno" disabled={verify.isPending} onClick={() => verify.mutate()}><ShieldCheck aria-hidden="true" />{verify.isPending ? 'Verificando…' : 'Verificar integridade'}</Button>}
        {canRebuild && <Dialog.Root><Dialog.Trigger asChild><Button variante="secundaria" disabled={rebuild.isPending}><RefreshCw aria-hidden="true" />Reconstruir projeção</Button></Dialog.Trigger><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-foreground/40"/><Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-[32rem] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-card p-lg shadow-xl focus:outline-none"><Dialog.Title className="text-title-lg">Reconstruir projeção do razão?</Dialog.Title><Dialog.Description className="mt-sm text-body-sm text-muted-foreground">A projeção completa de <strong className="text-foreground">{nomeEmpresa ?? 'esta empresa'}</strong> será calculada de novo a partir dos lançamentos fonte. Período informado: {from} a {to}. A versão ativa só troca após validação integral.</Dialog.Description><div className="mt-lg flex justify-end gap-sm"><Dialog.Close asChild><Button variante="contorno">Cancelar</Button></Dialog.Close><Dialog.Close asChild><Button disabled={rebuild.isPending} onClick={() => rebuild.mutate()}>{rebuild.isPending ? 'Reconstruindo…' : 'Confirmar reconstrução'}</Button></Dialog.Close></div><Dialog.Close aria-label="Fechar" className="absolute right-md top-md rounded p-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><X size={18}/></Dialog.Close></Dialog.Content></Dialog.Portal></Dialog.Root>}
      </div>
    </header>

    <section className="grid gap-md rounded-lg border border-border bg-card p-md tablet:grid-cols-[minmax(9rem,1fr)_minmax(9rem,1fr)_minmax(12rem,1.4fr)] tablet:items-end" aria-label="Filtros do razão">
      <Campo rotulo="Competência inicial" type="month" value={from} onValorChange={(value) => setParams({ de: value, pagina: '1' })}/>
      <Campo rotulo="Competência final" type="month" value={to} onValorChange={(value) => setParams({ ate: value, pagina: '1' })}/>
      <label className="grid min-w-0 gap-xs text-label-md">Centro de custo<select className={CAMPO} value={centerFilter} onChange={(event) => setParams({ centroId: event.target.value, pagina: '1' })}><option value="todos">Todos os centros</option><option value="sem-centro">Sem centro</option>{centers.data?.items.map((center) => <option key={center.costCenterId} value={center.costCenterId}>{center.code} · {center.name}</option>)}</select></label>
      {view === 'razao' && <><label className="grid min-w-0 gap-xs text-label-md">Conta<select className={CAMPO} value={accountFilter} onChange={(event) => setParams({ contaId: event.target.value, pagina: '1' })}><option value="">Todas as contas</option>{accountsForFilter.map((account) => <option key={account.accountId} value={account.accountId}>{account.code} · {account.name}</option>)}</select></label><label className="grid min-w-0 gap-xs text-label-md">Lado<select className={CAMPO} value={sideFilter} onChange={(event) => setParams({ lado: event.target.value, pagina: '1' })}><option value="">Débitos e créditos</option><option value="DEBIT">Débito</option><option value="CREDIT">Crédito</option></select></label><label className="grid min-w-0 gap-xs text-label-md">Histórico ou referência<span className="relative"><Search aria-hidden="true" size={16} className="absolute left-sm top-1/2 -translate-y-1/2 text-muted-foreground"/><input className={cn(CAMPO, 'pl-xl')} value={textFilter} maxLength={160} onChange={(event) => setParams({ busca: event.target.value, pagina: '1' })} placeholder="Buscar movimento"/></span></label></>}
      {view === 'balancete' && <label className="flex min-h-10 items-center gap-sm text-body-sm"><input type="checkbox" checked={onlyWithMovement} onChange={(event) => setParams({ somenteMovimento: String(event.target.checked) })} className="size-4 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"/>Somente contas com movimento ou saldo</label>}
    </section>

    <section className="flex flex-col gap-md" aria-label="Consultas contábeis">
      <div role="tablist" aria-label="Visão contábil" className="flex w-fit gap-xs rounded-md bg-muted/50 p-xs">
        {(['razao', 'balancete'] as const).map((tab) => <button key={tab} role="tab" aria-selected={view === tab} className={cn('rounded px-md py-sm text-label-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', view === tab ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')} onClick={() => setParams({ visao: tab, pagina: '1' })}>{tab === 'razao' ? 'Razão' : 'Balancete'}</button>)}
      </div>
      <p className="rounded-md bg-muted/40 px-md py-sm text-body-sm text-muted-foreground">{sourceStart ? <>Marco inicial disponível: <strong className="text-foreground">{sourceStart}</strong>. Posição anterior a esse marco é desconhecida; nenhum saldo de abertura foi presumido.</> : 'Nenhum lançamento efetivado define o marco inicial disponível.'}</p>
      {integrity === 'INCONSISTENT' && <p role="alert" className="flex items-center gap-sm rounded-md border border-destructive/50 bg-destructive/10 px-md py-sm text-body-sm"><ShieldAlert aria-hidden="true"/>Projeção inconsistente. Divergências seguem visíveis até resolução.</p>}
      {verify.data?.status === 'INCONSISTENT' && <p role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-md py-sm text-body-sm">Verificação identificou {verify.data.differences.length} divergências objetivas entre fontes e projeção.</p>}
      {integrity === 'CONSISTENT' && <p role="status" className="flex items-center gap-sm text-label-sm text-muted-foreground"><ShieldCheck aria-hidden="true" size={16}/>Projeção v{projection?.projectionVersion} · integridade consistente</p>}
      {rebuild.isPending && <p role="status" aria-live="polite" className="rounded-md border border-border bg-muted/40 px-md py-sm text-body-sm">Reconstruindo uma versão isolada. A versão ativa continua disponível até a validação terminar.</p>}
      {!periodValid && <p role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-md py-sm text-body-sm">Período inválido: competência inicial posterior à final.</p>}
      {loading && <div className="flex flex-col gap-sm" aria-busy="true"><span className="sr-only">Carregando consulta do razão</span><Skeleton className="h-12 w-full"/><Skeleton className="h-72 w-full"/></div>}
      {failed && <p role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 p-md text-body-sm">Não foi possível carregar a consulta. Tente novamente.</p>}
      {!loading && !failed && view === 'razao' && (movementQuery.data?.items.length ?? 0) === 0 && <p className="rounded-md border border-border bg-card p-lg text-body-sm text-muted-foreground">Nenhum movimento efetivado no período e filtros informados.</p>}
      {!loading && !failed && view === 'razao' && (movementQuery.data?.items.length ?? 0) > 0 && <>
        <div className="hidden overflow-x-auto rounded-lg border border-border bg-card tablet:block"><table className="w-full min-w-[60rem] text-left text-body-sm"><caption className="sr-only">Movimentos do razão contábil</caption><thead className="bg-muted/40 text-label-sm text-muted-foreground"><tr>{['Data', 'Nº', 'Conta', 'Centro', 'Histórico', 'Débito', 'Crédito'].map((column) => <th key={column} scope="col" className="px-md py-sm">{column}</th>)}</tr></thead><tbody>{movementQuery.data!.items.map((movement) => <tr key={movement.movementId} className="border-t border-border"><td className="whitespace-nowrap px-md py-sm tabular-nums">{movement.accountingDate}</td><td className="px-md py-sm tabular-nums">{movement.entryNumber}</td><td className="px-md py-sm">{movement.accountCode} · {movement.accountName}</td><td className="px-md py-sm">{movement.costCenterCode ? `${movement.costCenterCode} · ${movement.costCenterName}` : 'Sem centro'}</td><td className="max-w-[22rem] px-md py-sm"><button type="button" onClick={() => setMovementId(movement.movementId)} className="max-w-full truncate text-left underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Detalhar movimento ${movement.entryNumber}: ${movement.history}`}>{movement.history}{movement.kind === 'CANCELLATION_ADJUSTMENT' && <span className="ml-xs rounded bg-muted px-xs py-0.5 text-label-sm">Ajuste de cancelamento</span>}</button></td><td className="whitespace-nowrap px-md py-sm text-right tabular-nums">{movement.side === 'DEBIT' ? dinheiro(movement.amountCents) : '—'}</td><td className="whitespace-nowrap px-md py-sm text-right tabular-nums">{movement.side === 'CREDIT' ? dinheiro(movement.amountCents) : '—'}</td></tr>)}</tbody></table></div>
        <ul className="flex flex-col gap-sm tablet:hidden">{movementQuery.data!.items.map((movement) => <li key={movement.movementId} className="rounded-md border border-border bg-card p-md"><button className="w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setMovementId(movement.movementId)}><span className="flex justify-between gap-sm text-label-md"><span>{movement.accountingDate} · {movement.entryNumber}</span><span>{movement.side === 'DEBIT' ? 'Débito' : 'Crédito'}</span></span><span className="mt-xs block text-body-sm">{movement.accountCode} · {movement.accountName}</span><span className="mt-xs block text-body-sm text-muted-foreground">{movement.history}</span><span className="mt-sm block font-medium tabular-nums">{dinheiro(movement.amountCents)}</span></button></li>)}</ul>
        <div className="flex items-center justify-between gap-sm"><p className="text-label-sm text-muted-foreground">Página {page} · até 50 movimentos por página</p><div className="flex gap-sm"><Button variante="contorno" disabled={page <= 1} onClick={() => setParams({ pagina: String(page - 1) })}>Anterior</Button><Button variante="contorno" disabled={!movementQuery.data?.hasMore} onClick={() => setParams({ pagina: String(page + 1) })}>Próxima</Button></div></div>
      </>}
      {!loading && !failed && view === 'balancete' && (trialQuery.data?.lines.length ?? 0) === 0 && <p className="rounded-md border border-border bg-card p-lg text-body-sm text-muted-foreground">Nenhuma conta com movimento ou saldo no período.</p>}
    {!loading && !failed && view === 'balancete' && (trialQuery.data?.lines.length ?? 0) > 0 && <div className="overflow-x-auto rounded-lg border border-border bg-card"><table className="w-full min-w-[58rem] text-left text-body-sm"><caption className="sr-only">Balancete hierárquico por período</caption><thead className="bg-muted/40 text-label-sm text-muted-foreground"><tr>{['Conta', 'Saldo anterior', 'Débitos', 'Créditos', 'Saldo final', 'Natureza'].map((column) => <th key={column} scope="col" className="px-md py-sm">{column}</th>)}</tr></thead><tbody>{visibleTree.map((line) => { const hasChildren = lines.some((candidate) => candidate.parentAccountId === line.accountId); return <tr key={line.accountId} className="border-t border-border"><th scope="row" className="px-md py-sm font-medium"><span className="flex items-center gap-xs" style={{ paddingInlineStart: `${Math.min(line.level, 5) * 1.25}rem` }}>{hasChildren ? <button type="button" aria-label={`${expanded.has(line.accountId) ? 'Recolher' : 'Expandir'} ${line.name}`} aria-expanded={expanded.has(line.accountId)} onClick={() => toggle(line)} className="rounded p-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{expanded.has(line.accountId) ? <ChevronDown size={16}/> : <ChevronRight size={16}/>}</button> : <span className="inline-block w-6"/>}<span className="grid"><span>{line.code} · {line.name}</span><span className="text-label-sm text-muted-foreground">Saldo normal: {line.normalBalance === 'DEBIT' ? 'devedor' : 'credor'}</span></span>{line.type === 'SYNTHETIC' && <span className="rounded bg-muted px-xs py-0.5 text-label-sm">Sintética</span>}</span></th><td className="whitespace-nowrap px-md py-sm text-right tabular-nums">{dinheiro(line.openingBalanceCents)}</td><td className="whitespace-nowrap px-md py-sm text-right tabular-nums">{dinheiro(line.debitCents)}</td><td className="whitespace-nowrap px-md py-sm text-right tabular-nums">{dinheiro(line.creditCents)}</td><td className="whitespace-nowrap px-md py-sm text-right tabular-nums font-medium">{dinheiro(line.closingBalanceCents)}</td><td className="px-md py-sm">{rotuloSaldo(line.closingNature)}</td></tr>; })}</tbody><tfoot className="border-t-2 border-border bg-muted/30 font-semibold"><tr><th scope="row" className="px-md py-sm">Totais do período · contas analíticas</th><td></td><td className="px-md py-sm text-right tabular-nums">{dinheiro(trialQuery.data!.totalDebitCents)}</td><td className="px-md py-sm text-right tabular-nums">{dinheiro(trialQuery.data!.totalCreditCents)}</td><td></td><td>{trialQuery.data!.totalDebitCents === trialQuery.data!.totalCreditCents ? 'Equilibrado' : 'Divergente'}</td></tr></tfoot></table></div>}
    </section>

    <Dialog.Root open={movementId !== null} onOpenChange={(open) => { if (!open) setMovementId(null); }}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-foreground/40"/><Dialog.Content className="fixed inset-y-0 right-0 z-50 flex h-full w-full max-w-[36rem] flex-col overflow-y-auto border-l border-border bg-background shadow-xl focus:outline-none"><div className="flex items-start justify-between gap-md border-b border-border bg-card p-lg"><div><p className="text-label-sm uppercase tracking-wider text-muted-foreground">Detalhe auditável</p><Dialog.Title className="mt-xs text-headline-sm">Movimento do razão</Dialog.Title><Dialog.Description className="mt-xs text-body-sm text-muted-foreground">Lançamento, partida fonte e eventos relacionados.</Dialog.Description></div><Dialog.Close aria-label="Fechar detalhe" className="rounded p-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><X/></Dialog.Close></div>{detailQuery.isPending ? <div className="flex flex-col gap-sm p-lg" aria-busy="true"><Skeleton className="h-10 w-full"/><Skeleton className="h-32 w-full"/></div> : detailQuery.isError ? <p role="alert" className="m-lg rounded-md bg-destructive/10 p-md text-body-sm">Não foi possível carregar o detalhe.</p> : detailQuery.data && <div className="flex flex-col gap-md p-lg"><dl className="grid grid-cols-2 gap-md text-body-sm"><div><dt className="text-muted-foreground">Lançamento</dt><dd className="font-medium">{detailQuery.data.entryNumber}</dd></div><div><dt className="text-muted-foreground">Data e competência</dt><dd>{detailQuery.data.accountingDate} · {detailQuery.data.competence}</dd></div><div><dt className="text-muted-foreground">Conta</dt><dd>{detailQuery.data.accountCode} · {detailQuery.data.accountName}</dd></div><div><dt className="text-muted-foreground">Centro</dt><dd>{detailQuery.data.costCenterName ?? 'Sem centro'}</dd></div><div><dt className="text-muted-foreground">Lado e valor</dt><dd>{detailQuery.data.side === 'DEBIT' ? 'Débito' : 'Crédito'} · {dinheiro(detailQuery.data.amountCents)}</dd></div><div><dt className="text-muted-foreground">Partida</dt><dd>{detailQuery.data.entryLineId}</dd></div></dl><div className="rounded-md bg-muted/40 p-md"><h3 className="text-label-md">Histórico</h3><p className="mt-xs text-body-sm">{detailQuery.data.history}</p>{detailQuery.data.memo && <p className="mt-xs text-body-sm text-muted-foreground">{detailQuery.data.memo}</p>}</div><section><h3 className="text-label-md">Eventos do lançamento fonte</h3><ol className="mt-sm flex flex-col gap-sm">{detailQuery.data.events?.map((event, index) => <li key={`${event.action}-${index}`} className="border-l-2 border-border pl-md text-body-sm"><strong>{event.action}</strong><span className="block text-muted-foreground">{event.occurredAt}</span>{event.reason && <span className="block">{event.reason}</span>}</li>)}</ol></section></div>}</Dialog.Content></Dialog.Portal></Dialog.Root>
  </div>;
};

export const RazaoContabilGlobal = () => {
  const router = useRouter(); const pathname = usePathname(); const search = useSearchParams();
  const { data: session } = useSessao();
  const companySearch = search.get('empresaBusca') ?? '';
  const companies = useQuery({ queryKey: ['ledger-companies', companySearch], queryFn: () => listarEmpresas({ busca: companySearch, status: null, limite: 100, deslocamento: 0 }), enabled: session !== undefined && concede(session, 'contabil.razao.consultar') });
  const companyId = search.get('empresaId') ?? '';
  const selected = companies.data?.empresas.find((company) => company.id === companyId);
  const changeCompany = (next: string) => { const params = new URLSearchParams(search.toString()); if (next) params.set('empresaId', next); else params.delete('empresaId'); router.replace(`${pathname}?${params.toString()}`, { scroll: false }); };
  const changeSearch = (value: string) => { const params = new URLSearchParams(search.toString()); if (value) params.set('empresaBusca', value); else params.delete('empresaBusca'); params.delete('empresaId'); router.replace(`${pathname}?${params.toString()}`, { scroll: false }); };
  return <div className="flex min-w-0 flex-col gap-lg"><section className="grid max-w-3xl gap-md tablet:grid-cols-2"><Campo rotulo="Buscar empresa da carteira" value={companySearch} maxLength={160} onValorChange={changeSearch} placeholder="Nome ou CNPJ"/><label className="grid gap-xs text-label-md">Empresa<select className={CAMPO} value={companyId} onChange={(event) => changeCompany(event.target.value)} disabled={companies.isPending}><option value="">Selecione uma empresa</option>{companies.data?.empresas.map((company) => <option key={company.id} value={company.id}>{company.nomeFantasia ?? company.razaoSocial ?? 'Empresa sem nome'}</option>)}</select></label>{companies.isError && <p role="alert" className="mt-xs text-body-sm text-destructive">Não foi possível carregar empresas autorizadas pela carteira.</p>}</section>{selected ? <RazaoContabil empresaId={selected.id} nomeEmpresa={selected.nomeFantasia ?? selected.razaoSocial}/> : <p className="rounded-lg border border-border bg-card p-lg text-body-sm text-muted-foreground">Selecione uma empresa autorizada pela carteira para consultar razão e balancete.</p>}</div>;
};
