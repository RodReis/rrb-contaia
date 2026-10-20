'use client';

import { Fragment, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { AreaDeTexto } from '@/components/ui/area-de-texto';
import { CaixaDeSelecao } from '@/components/ui/caixa-de-selecao';
import { ErroDeTela, Skeleton } from '@/components/ui/estados';
import { StatusBadge } from '@/components/ui/status-badge';
import { ErroDaApi } from '@/lib/http';
import { orientarDadoResolucaoTributaria, orientarMotivoResolucaoTributaria } from './orientacao-resolucao-tributaria';
import { compararResolucaoTributaria, listarResolucaoTributaria, processarResolucaoTributaria, type DocumentoFiscalDetalhe } from './api';

const formatarData = (value: string | null) => value
  ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date(`${value.slice(0,10)}T12:00:00-03:00`))
  : '—';
const formatarDataHora = (value: string | null) => value
  ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date(value))
  : '—';

type FonteFiscal = Readonly<{ id: string; authority: string; title: string; url: string; provision: string; validFrom: string; validUntil: string | null }>;
const fontesDoPacote = (value: unknown): readonly FonteFiscal[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((source): FonteFiscal[] => {
    if (typeof source !== 'object' || source === null) return [];
    const item = source as Record<string, unknown>;
    if (typeof item['id'] !== 'string' || typeof item['authority'] !== 'string' || typeof item['title'] !== 'string' ||
        typeof item['url'] !== 'string' || typeof item['provision'] !== 'string' || typeof item['validFrom'] !== 'string' ||
        !(typeof item['validUntil'] === 'string' || item['validUntil'] === null)) return [];
    let url: URL;
    try { url = new URL(item['url']); } catch { return []; }
    if (url.protocol !== 'https:') return [];
    return [{ id: item['id'], authority: item['authority'], title: item['title'], url: url.href,
      provision: item['provision'], validFrom: item['validFrom'], validUntil: item['validUntil'] }];
  });
};

export const PainelResolucaoTributaria = ({ empresaId, documento, podeResolver }: {
  empresaId: string;
  documento: DocumentoFiscalDetalhe;
  podeResolver: boolean;
}) => {
  const [reason, setReason] = useState('');
  const [compareRevisions, setCompareRevisions] = useState<{ de: number; para: number } | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [resaleItems, setResaleItems] = useState<Set<number>>(() => new Set());
  const snapshotsQuery = useQuery({
    queryKey: ['sessao', 'eu', 'resolucao-tributaria', empresaId, documento.id],
    queryFn: () => listarResolucaoTributaria(empresaId, documento.id),
  });
  const snapshots = snapshotsQuery.data?.itens ?? [];
  const processing = useMutation({
    mutationFn: (key: string) => processarResolucaoTributaria(empresaId, documento.id, {
      expectedDocumentRevision: documento.parser_version,
      resaleItemNumbers: [...resaleItems],
      idempotencyKey: key,
      ...(snapshots.length ? { reprocessingReason: reason.trim() } : {}),
    }),
    onSuccess: (result) => {
      setReason(''); setCompareRevisions(null); setIdempotencyKey(null);
      void snapshotsQuery.refetch();
      toast.success(result.reused ? `Revisão ${result.revision} já estava registrada.` : `Revisão ${result.revision} registrada; itens sem contexto suficiente ficaram indeterminados.`);
    },
    onError: (error: unknown) => {
      const problem = error instanceof ErroDaApi ? error.problema : null;
      toast.error(problem?.code === 'TAX_RESOLUTION_REPROCESSING_REASON_REQUIRED'
        ? 'Informe um motivo com pelo menos 10 caracteres para reprocessar.'
        : problem?.code === 'TAX_TREATMENT_DOCUMENT_NOT_ENTRY'
          ? 'Esta resolução só aceita uma NF-e de entrada destinada à empresa selecionada.'
          : problem?.code === 'TAX_TREATMENT_DOCUMENT_UNAUTHORIZED'
            ? 'A NF-e precisa ter protocolo de autorização antes da resolução.'
            : problem?.code === 'TAX_RESOLUTION_DOCUMENT_REVISION_MISMATCH'
              ? 'O documento mudou; atualize os detalhes antes de processar.'
              : 'Não foi possível registrar a resolução tributária.');
    },
  });
  const comparison = useQuery({
    queryKey: ['sessao', 'eu', 'resolucao-tributaria-comparacao', empresaId, documento.id, compareRevisions],
    queryFn: () => compararResolucaoTributaria(empresaId, documento.id, compareRevisions!.de, compareRevisions!.para),
    enabled: compareRevisions !== null,
  });
  const revisions = [...new Set(snapshots.map((snapshot) => snapshot.revision))].sort((a, b) => b - a);
  const latest = revisions[0] ?? 0;
  const previous = revisions[1] ?? 0;
  const items = documento.itens.filter((item) => item['tipo'] === 'ITEM' && typeof item['numero'] === 'number');
  return (
    <section aria-labelledby="resolucao-tributaria-titulo" className="rounded-md border border-border bg-card p-md">
      <div>
        <h4 id="resolucao-tributaria-titulo" className="font-display text-title-sm text-foreground">Tratamento tributário por item</h4>
        <p className="mt-xs max-w-3xl text-body-sm text-muted-foreground">Marque na lista acima cada item adquirido para revenda. A declaração fica vinculada ao seu usuário e à revisão; itens sem declaração ou sem cobertura permanecem indeterminados. Esta resolução não apura valores devidos.</p>
      </div>
      {podeResolver ? <div className="mt-md flex flex-wrap items-center gap-sm">
        {items.map((item) => <CaixaDeSelecao key={item['numero']} rotulo={`Declarar item ${item['numero']} para revenda`} marcada={resaleItems.has(item['numero'] as number)} onMarcadaChange={(checked) => setResaleItems((current) => { const next = new Set(current); if (checked) next.add(item['numero'] as number); else next.delete(item['numero'] as number); return next; })} />)}
        {items.length > 0 ? <Button variante="contorno" tamanho="compacto" onClick={() => setResaleItems(new Set(items.map((item) => item['numero'] as number)))}>Declarar {items.length} {items.length === 1 ? 'item' : 'itens'} desta NF-e para revenda</Button> : null}
        <Button variante="primaria" disabled={processing.isPending || documento.estado !== 'PROCESSADO' || (snapshots.length > 0 && reason.trim().length < 10)} onClick={() => {
          const key = idempotencyKey ?? crypto.randomUUID(); setIdempotencyKey(key); processing.mutate(key);
        }}>{processing.isPending ? 'Registrando…' : snapshots.length > 0 ? 'Reprocessar itens' : 'Processar itens'}</Button>
      </div> : null}
      {snapshotsQuery.isPending ? <div className="mt-md" aria-busy="true"><Skeleton className="h-16 w-full" /></div> : null}
      {snapshotsQuery.isError ? <div className="mt-md"><ErroDeTela titulo="Histórico de resolução indisponível" descricao="Tente novamente em instantes." /></div> : null}
      {!snapshotsQuery.isPending && !snapshotsQuery.isError && snapshots.length === 0 ? <p className="mt-md rounded-md border border-dashed border-border p-md text-body-sm text-muted-foreground">Nenhuma resolução foi registrada para este documento.</p> : null}
      {snapshots.length > 0 ? <div className="mt-md space-y-md">
        {revisions.length > 1 ? <div className="flex flex-wrap items-center gap-sm"><Button variante="contorno" tamanho="compacto" onClick={() => setCompareRevisions({ de: previous, para: latest })}>Comparar revisões {previous} → {latest}</Button></div> : null}
        {compareRevisions ? comparison.isPending ? <div aria-busy="true"><Skeleton className="h-12 w-full" /></div>
          : comparison.isError ? <ErroDeTela titulo="Comparação indisponível" descricao="Tente novamente em instantes." />
            : comparison.data ? <p role="status" className="rounded-md bg-muted/50 p-sm text-body-sm text-foreground">{comparison.data.diff.filter((item) => item.changed).length} de {comparison.data.diff.length} itens com fatos ou decisões diferentes entre as revisões {compareRevisions.de} e {compareRevisions.para}.</p> : null : null}
        {revisions.map((revision) => <section key={revision} className="rounded-md border border-border/70 p-md">
          <div className="flex flex-wrap items-center justify-between gap-sm"><h5 className="font-medium text-foreground">Revisão {revision}</h5><span className="text-label-sm text-muted-foreground">{formatarDataHora(snapshots.find((snapshot) => snapshot.revision === revision)?.processed_at ?? null)}</span></div>
          <ul className="mt-sm grid gap-sm md:grid-cols-2">{snapshots.filter((snapshot) => snapshot.revision === revision).map((snapshot) => {
            const guidance = snapshot.decisions.flatMap((decision) => [
              ...decision.missingInputs.map(orientarDadoResolucaoTributaria),
              ...decision.reasons.map(orientarMotivoResolucaoTributaria).filter((item) => item !== null),
            ]).filter((item, index, items) => items.findIndex((candidate) => candidate.campo === item.campo) === index);
            const sources = fontesDoPacote(snapshot.facts['packageSources']);
            const context: readonly (readonly [string, unknown])[] = [
              ['Data do fato', snapshot.facts['factDate']], ['Regime', snapshot.facts['regime']],
              ['Origem', snapshot.facts['originUf']], ['Destino', snapshot.facts['destinationUf']],
              ['CFOP', snapshot.facts['cfop']], ['NCM', snapshot.facts['ncm']], ['CEST', snapshot.facts['cest']],
              ['CST/CSOSN', snapshot.facts['cstCsosn']], ['Finalidade', snapshot.facts['purpose']],
            ];
            const indeterminate = snapshot.decisions.some((decision) => decision.status === 'INDETERMINATE');
            return <li key={snapshot.id} className="rounded-md bg-muted/30 p-sm">
              <div className="flex flex-wrap items-center justify-between gap-xs"><span className="font-medium text-foreground">Item {snapshot.item_number}</span><StatusBadge tom={indeterminate ? 'atencao' : 'conforme'} rotulo={indeterminate ? 'Indeterminado' : 'Resolvido'} /></div>
              <dl aria-label={`Contexto fiscal do item ${snapshot.item_number}`} className="mt-xs grid grid-cols-[auto_minmax(0,1fr)] gap-x-sm gap-y-xs text-label-sm sm:grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)]">
                {context.map(([label, value]) => <Fragment key={label}><dt className="text-muted-foreground">{label}</dt><dd className="break-words text-foreground">{label === 'Data do fato' && typeof value === 'string' ? formatarData(value) : typeof value === 'string' ? value : '—'}</dd></Fragment>)}
              </dl>
              {snapshot.decisions.find((decision) => decision.tax === 'ICMS')?.declaredEvidence ? <section aria-label={`Evidência declarada de ICMS-ST do item ${snapshot.item_number}`} className="mt-sm rounded-sm border border-border p-sm text-body-sm">
                <h6 className="font-medium text-foreground">ICMS-ST declarado na NF-e</h6>
                <p className="mt-xs text-muted-foreground">Base: {String(snapshot.decisions.find((decision) => decision.tax === 'ICMS')?.declaredEvidence?.['taxableBaseCents'] ?? '—')} centavos · alíquota: {String(snapshot.decisions.find((decision) => decision.tax === 'ICMS')?.declaredEvidence?.['ratePercent'] ?? '—')}% · valor retido: {String(snapshot.decisions.find((decision) => decision.tax === 'ICMS')?.declaredEvidence?.['retainedAmountCents'] ?? '—')} centavos.</p>
                <p className="mt-xs text-muted-foreground">Coerência dos dados declarados não recalcula o imposto nem constitui crédito ou apuração.</p>
                {snapshot.decisions.find((decision) => decision.tax === 'ICMS')?.checks?.map((check) => <p key={check.code} className="mt-xs text-muted-foreground">{check.code}: {check.status}{check.reasons.length ? ` · ${check.reasons.join(', ')}` : ''}</p>)}
              </section> : null}
              {guidance.length ? <ul aria-label={`Dados e próximos passos para item ${snapshot.item_number}`} className="mt-xs space-y-xs rounded-sm bg-muted/40 p-sm text-body-sm text-muted-foreground">{guidance.map((item) => <li key={item.campo}><span className="font-medium text-foreground">{item.campo}</span><p>Origem esperada: {item.origem}</p><p>Próximo passo: {item.proximoPasso}</p></li>)}</ul> : null}
              <ul className="mt-xs space-y-xs text-body-sm">{snapshot.decisions.map((decision) => <li key={decision.tax} className="border-t border-border/50 pt-xs">
                <span className="font-medium text-foreground">{decision.tax}</span><span className="ml-xs text-muted-foreground">{decision.status} · crédito {decision.creditEligibility}</span><p className="text-muted-foreground">{decision.rationale}</p>
                {decision.sourceIds.map((sourceId) => { const source = sources.find((item) => item.id === sourceId); return source ? <p key={source.id} className="mt-xs text-label-sm"><a className="font-medium text-primary underline" href={source.url} target="_blank" rel="noreferrer">{source.authority} · {source.title} · {source.provision}</a><span className="block text-muted-foreground">Vigência {formatarData(source.validFrom)} a {source.validUntil ? formatarData(source.validUntil) : 'indeterminada'}</span></p> : null; })}
              </li>)}</ul>
              {snapshot.package_sha256 ? <p className="mt-xs break-all font-mono text-label-sm text-muted-foreground">Pacote SHA-256: {snapshot.package_sha256}</p> : <p className="mt-xs text-label-sm text-muted-foreground">Sem pacote curado associado.</p>}
            </li>;
          })}</ul>
        </section>)}
        {podeResolver ? <div className="max-w-2xl"><AreaDeTexto rotulo="Motivo do reprocessamento" obrigatorio value={reason} onValorChange={setReason} maxLength={500} ajuda="Obrigatório a partir da segunda revisão; mínimo de 10 caracteres." /></div> : null}
      </div> : null}
    </section>
  );
};
