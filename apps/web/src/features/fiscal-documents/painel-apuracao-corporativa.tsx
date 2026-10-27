'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Download, FileCheck2, FileUp, RefreshCw, ShieldCheck } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { CorporateTaxDeclarationSchema, CorporateTaxRulePackageSchema } from '@contaia/shared';

import { Button } from '@/components/ui/button';
import { ErroDeTela, Skeleton } from '@/components/ui/estados';
import { Select, type OpcaoDoSelect } from '@/components/ui/select';
import { StatusBadge, type TomDoStatus } from '@/components/ui/status-badge';
import {
  baixarArtefatoCorporativo, baixarArtefatoCorporativoPersistido, declararApuracaoCorporativa, decidirApuracaoCorporativa, historicoApuracaoCorporativa,
  importarPacoteCorporativo, listarPacotesCorporativos, obterApuracaoCorporativa, prepararApuracaoCorporativa,
  revisarPacoteCorporativo, type CorporateTaxAssessment,
} from './corporate-tax-assessments-api';

const quarterOptions: readonly OpcaoDoSelect[] = [
  { valor: '2026-Q1', rotulo: '1º trimestre · jan–mar/2026' }, { valor: '2026-Q2', rotulo: '2º trimestre · abr–jun/2026' },
  { valor: '2026-Q3', rotulo: '3º trimestre · jul–set/2026' }, { valor: '2026-Q4', rotulo: '4º trimestre · out–dez/2026' },
];
const statusText: Record<CorporateTaxAssessment['status'], string> = {
  DRAFT: 'Rascunho', INCOMPLETE: 'Incompleta', INDETERMINATE: 'Indeterminada', READY_FOR_REVIEW: 'Pronta para revisão',
  APPROVED: 'Aprovada', REJECTED: 'Rejeitada', POSSIBLY_OUTDATED: 'Possivelmente desatualizada', SUPERSEDED: 'Superada',
};
const statusTone: Record<CorporateTaxAssessment['status'], TomDoStatus> = {
  DRAFT: 'neutro', INCOMPLETE: 'atencao', INDETERMINATE: 'critico', READY_FOR_REVIEW: 'atencao',
  APPROVED: 'conforme', REJECTED: 'critico', POSSIBLY_OUTDATED: 'atencao', SUPERSEDED: 'neutro',
};
const money = (cents: number | null) => cents === null ? 'Indeterminado' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
const fieldClass = 'min-h-11 w-full rounded-md border border-input bg-background px-md py-sm text-body-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const textAreaClass = `${fieldClass} min-h-40 font-mono`;
const declarationStart = JSON.stringify({ quarter: '2026-Q1', recognition: null, recognitionOptionValid: false, regimeVerified: false,
  activityVerified: false, revenueReconciled: false, revenue: [], deductions: [], evidence: [], justification: '', supersedesId: null }, null, 2);

export const PainelApuracaoCorporativa = ({ empresaId, somenteLeitura, podePreparar, podeRevisar }: {
  empresaId: string; somenteLeitura: boolean; podePreparar: boolean; podeRevisar: boolean;
}) => {
  const [quarter, setQuarter] = useState('2026-Q1');
  const [recognition, setRecognition] = useState<'ACCRUAL' | 'CASH'>('ACCRUAL');
  const [packageJson, setPackageJson] = useState('');
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [declarationJson, setDeclarationJson] = useState(declarationStart);
  const [evidenceFiles, setEvidenceFiles] = useState<File[]>([]);
  const [packageId, setPackageId] = useState('');
  const [declarationId, setDeclarationId] = useState('');
  const [deductionEvidenceIds, setDeductionEvidenceIds] = useState<string[]>([]);
  const [installmentCount, setInstallmentCount] = useState('1');
  const [assessmentId, setAssessmentId] = useState('');
  const [reviewReason, setReviewReason] = useState('');
  const [packageReviewReason, setPackageReviewReason] = useState('');
  const [declarationsConfirmed, setDeclarationsConfirmed] = useState(false);
  const [localDraftsAcknowledged, setLocalDraftsAcknowledged] = useState(false);
  const queryClient = useQueryClient();
  const packagesKey = ['f38-corporate-rule-packages', empresaId] as const;
  const historyKey = ['f38-corporate-history', empresaId, quarter] as const;
  const packages = useQuery({ queryKey: packagesKey, queryFn: () => listarPacotesCorporativos(empresaId) });
  const history = useQuery({ queryKey: historyKey, queryFn: () => historicoApuracaoCorporativa(empresaId, quarter) });
  const current = useQuery({ queryKey: ['f38-corporate-assessment', empresaId, assessmentId], queryFn: () => obterApuracaoCorporativa(empresaId, assessmentId), enabled: Boolean(assessmentId) });
  const approvedPackages = useMemo(() => (packages.data ?? []).filter((item) => item.status === 'APPROVED'), [packages.data]);

  const importPackage = useMutation({ mutationFn: async () => {
    if (!sourceFile) throw new Error('Anexe a fonte normativa oficial em PDF.');
    const content: unknown = CorporateTaxRulePackageSchema.parse(JSON.parse(packageJson));
    return importarPacoteCorporativo(empresaId, content, sourceFile);
  }, onSuccess: () => { toast.success('Pacote enviado para revisão humana.'); setSourceFile(null); void queryClient.invalidateQueries({ queryKey: packagesKey }); },
    onError: () => toast.error('Pacote inválido ou fonte indisponível.') });

  const decidePackage = useMutation({ mutationFn: ({ id, action }: { id: string; action: 'APPROVED' | 'REJECTED' }) =>
    revisarPacoteCorporativo(empresaId, id, action, packageReviewReason), onSuccess: () => {
      toast.success('Decisão do pacote registrada.'); setPackageReviewReason(''); void queryClient.invalidateQueries({ queryKey: packagesKey });
    }, onError: () => toast.error('Não foi possível revisar o pacote.') });

  const declare = useMutation({ mutationFn: async () => {
    if (evidenceFiles.length === 0) throw new Error('Anexe as evidências declaradas no JSON.');
    const input = CorporateTaxDeclarationSchema.parse(JSON.parse(declarationJson));
    if (input.quarter !== quarter) throw new Error('O trimestre da declaração diverge da seleção.');
    if (input.recognition !== null) setRecognition(input.recognition);
    return declararApuracaoCorporativa(empresaId, input, evidenceFiles);
  }, onSuccess: (result) => {
    const saved = result as { id: string; evidence: readonly { id: string }[] };
    setDeclarationId(saved.id); setDeductionEvidenceIds(saved.evidence.map((item) => item.id));
    toast.success('Declaração e evidências anexadas em revisão imutável.'); void queryClient.invalidateQueries({ queryKey: historyKey });
  }, onError: () => toast.error('Declaração inválida ou evidência não anexada.') });

  const prepare = useMutation({ mutationFn: () => {
    if (!packageId || !declarationId) throw new Error('Selecione pacote aprovado e declaração vigente.');
    return prepararApuracaoCorporativa(empresaId, { quarter, recognition, packageId, revenueDeclarationId: declarationId,
      deductionEvidenceIds, installmentCount: Number(installmentCount), idempotencyKey: crypto.randomUUID() });
  }, onSuccess: (item) => {
    setAssessmentId(item.assessmentId); toast.success(item.status === 'INDETERMINATE' ? 'Revisão preparada com lacunas explícitas.' : 'Apuração preparada para revisão.');
    void queryClient.invalidateQueries({ queryKey: historyKey });
  }, onError: () => toast.error('Não foi possível preparar a apuração.') });

  const review = useMutation({ mutationFn: ({ item, action }: { item: CorporateTaxAssessment; action: 'APPROVED' | 'REJECTED' | 'RETURNED' }) =>
    decidirApuracaoCorporativa(empresaId, item, action, reviewReason, declarationsConfirmed, localDraftsAcknowledged),
  onSuccess: async () => {
    toast.success('Decisão registrada.'); setReviewReason(''); setDeclarationsConfirmed(false); setLocalDraftsAcknowledged(false);
    await Promise.all([current.refetch(), history.refetch()]);
  }, onError: () => toast.error('A decisão exige conferência, reconhecimento dos rascunhos e revisão vigente.') });

  const download = async (item: CorporateTaxAssessment, format: 'PDF' | 'CSV' | 'JSON' | 'IRPJ_DARF_DRAFT' | 'CSLL_DARF_DRAFT') => {
    try { await baixarArtefatoCorporativo(empresaId, item, format); toast.success(`${format} exportado.`); }
    catch { toast.error('Não foi possível exportar; confirme se a revisão continua vigente e aprovada.'); }
  };

  if (packages.isPending || history.isPending) return <div className="flex flex-col gap-md" aria-busy="true"><Skeleton className="h-20 w-full"/><Skeleton className="h-56 w-full"/></div>;
  if (packages.isError || history.isError) return <ErroDeTela titulo="Apuração trimestral indisponível" descricao="Não foi possível carregar pacotes e revisões desta empresa." acao={<Button variante="contorno" onClick={() => { void packages.refetch(); void history.refetch(); }}>Tentar novamente</Button>} />;

  return <div role="region" aria-label="Apuração trimestral de IRPJ e CSLL" className="flex flex-col gap-xl">
    <div className="flex flex-col gap-sm tablet:flex-row tablet:items-end tablet:justify-between">
      <div className="max-w-3xl space-y-xs"><p className="text-label-md uppercase tracking-wide text-muted-foreground">Fiscal · F38 / SPEC-038</p>
        <h2 className="font-display text-headline-lg text-foreground">IRPJ e CSLL · Lucro Presumido</h2>
        <p className="text-body-md text-muted-foreground">Apuração interna por trimestre de 2026. Regra sem fonte e lacuna de evidência bloqueiam o resultado. Aprovação humana não transmite declaração nem emite DARF oficial.</p></div>
      <Button variante="contorno" tamanho="compacto" onClick={() => { void packages.refetch(); void history.refetch(); if (assessmentId) void current.refetch(); }} aria-label="Atualizar apurações trimestrais"><RefreshCw aria-hidden="true"/> Atualizar</Button>
    </div>

    <section className="grid gap-md rounded-lg border border-border bg-card p-lg shadow-[var(--elevation-1)] tablet:grid-cols-2 desktop:grid-cols-[1fr_1fr_1fr] desktop:items-end" aria-label="Período e reconhecimento anual">
      <Select rotulo="Trimestre" valor={quarter} onValorChange={(value) => {
        setQuarter(value); setDeclarationId(''); setAssessmentId('');
        try { const draft: unknown = JSON.parse(declarationJson); if (typeof draft === 'object' && draft !== null && !Array.isArray(draft))
          setDeclarationJson(JSON.stringify({ ...draft, quarter: value }, null, 2)); } catch { /* preserva o rascunho para correção explícita */ }
      }} opcoes={quarterOptions}/>
      <Select rotulo="Reconhecimento anual comprovado" valor={recognition} onValorChange={(value) => setRecognition(value as 'ACCRUAL'|'CASH')}
        opcoes={[{ valor: 'ACCRUAL', rotulo: 'Competência' }, { valor: 'CASH', rotulo: 'Caixa' }]}/>
      <div className="rounded-md bg-secondary/60 p-md text-body-sm text-muted-foreground"><span className="font-medium text-foreground">Um critério por ano.</span> Mudança ou conflito entre trimestres deixa a revisão indeterminada.</div>
    </section>

    <section className="grid gap-lg desktop:grid-cols-2" aria-label="Pacote normativo e declaração">
      <article className="flex flex-col gap-md rounded-lg border border-border bg-card p-lg shadow-[var(--elevation-1)]">
        <div><h3 className="font-display text-headline-sm text-foreground">1 · Pacote normativo oficial</h3><p className="mt-xs text-body-sm text-muted-foreground">Percentuais, limites, deduções e vencimentos entram apenas com fonte anexada e aprovação humana.</p></div>
        <label className="flex flex-col gap-xs text-label-md text-foreground" htmlFor="f38-package-json">Contrato do pacote (JSON)<textarea id="f38-package-json" disabled={somenteLeitura || !podePreparar} value={packageJson} onChange={(event) => setPackageJson(event.target.value)} className={textAreaClass} placeholder="Regras de IRPJ/CSLL, fontes, vigências e termos de quotas" /></label>
        <label className="flex flex-col gap-xs text-label-md text-foreground" htmlFor="f38-package-source">Fonte oficial em PDF<input id="f38-package-source" disabled={somenteLeitura || !podePreparar} type="file" accept="application/pdf,.pdf" onChange={(event) => setSourceFile(event.currentTarget.files?.[0] ?? null)} className={fieldClass}/></label>
        <Button disabled={!podePreparar || somenteLeitura || !sourceFile || !packageJson.trim() || importPackage.isPending} onClick={() => importPackage.mutate()}><FileUp aria-hidden="true"/> Importar para revisão</Button>
        {packages.data?.length ? <div className="overflow-x-auto rounded-md border border-border"><table className="w-full min-w-[28rem] text-left text-body-sm"><thead className="bg-secondary text-label-md text-muted-foreground"><tr><th className="p-sm">Versão</th><th className="p-sm">Vigência</th><th className="p-sm">Estado</th><th className="p-sm">Ação</th></tr></thead><tbody>
          {(packages.data ?? []).map((item) => <tr key={item.id} className="border-t border-border"><td className="p-sm font-medium text-foreground">{item.version}<span className="block font-mono text-body-xs text-muted-foreground">{item.id}</span></td><td className="p-sm text-foreground">{item.valid_from} – {item.valid_through ?? 'aberta'}</td><td className="p-sm"><StatusBadge tom={item.status === 'APPROVED' ? 'conforme' : item.status === 'REJECTED' ? 'critico' : 'atencao'} rotulo={item.status === 'APPROVED' ? 'Aprovado' : item.status === 'REJECTED' ? 'Rejeitado' : 'Aguardando revisão'}/></td>
            <td className="p-sm"><div className="flex flex-wrap gap-xs"><Button variante="contorno" tamanho="compacto" onClick={() => setPackageId(item.id)} disabled={item.status !== 'APPROVED'}>Usar</Button>{item.status === 'PENDING_REVIEW' && podeRevisar && !somenteLeitura ? <><Button tamanho="compacto" disabled={packageReviewReason.trim().length < 10 || decidePackage.isPending} onClick={() => decidePackage.mutate({ id: item.id, action: 'APPROVED' })}>Aprovar</Button><Button variante="destrutiva" tamanho="compacto" disabled={packageReviewReason.trim().length < 10 || decidePackage.isPending} onClick={() => decidePackage.mutate({ id: item.id, action: 'REJECTED' })}>Rejeitar</Button></> : null}</div></td></tr>)}
          {packages.data?.length === 0 ? <tr><td colSpan={4} className="p-md text-center text-muted-foreground">Nenhum pacote. Sem pacote aprovado, cálculo fica indeterminado.</td></tr> : null}
        </tbody></table></div> : <p className="rounded-md border border-dashed border-border p-lg text-center text-body-sm text-muted-foreground">Nenhum pacote importado. Fonte oficial aprovada é necessária para calcular.</p>}
        {packages.data?.some((item) => item.status === 'PENDING_REVIEW') && podeRevisar ? <label htmlFor="f38-review-reason-package" className="flex flex-col gap-xs text-label-md text-foreground">Justificativa da revisão do pacote<textarea id="f38-review-reason-package" value={packageReviewReason} onChange={(event) => setPackageReviewReason(event.target.value)} minLength={10} maxLength={1000} className={`${fieldClass} min-h-20`}/></label> : null}
      </article>

      <article className="flex flex-col gap-md rounded-lg border border-border bg-card p-lg shadow-[var(--elevation-1)]">
        <div><h3 className="font-display text-headline-sm text-foreground">2 · Declaração e reconciliação</h3><p className="mt-xs text-body-sm text-muted-foreground">Cada linha informa natureza, mês, valores e fontes. Use `evidence-index:N` para vincular um anexo pela posição começando em zero; documentos fiscais usam `UUID:SHA256:item:NÚMERO`.</p></div>
        <label className="flex flex-col gap-xs text-label-md text-foreground" htmlFor="f38-declaration-json">Declaração estruturada (JSON)<textarea id="f38-declaration-json" disabled={somenteLeitura || !podePreparar} value={declarationJson} onChange={(event) => setDeclarationJson(event.target.value)} className={`${textAreaClass} min-h-64`} /></label>
        <label className="flex flex-col gap-xs text-label-md text-foreground" htmlFor="f38-evidence-files">Anexos na mesma ordem de `evidence` no JSON<input id="f38-evidence-files" disabled={somenteLeitura || !podePreparar} type="file" multiple accept="application/pdf,image/png,image/jpeg" onChange={(event) => setEvidenceFiles(Array.from(event.currentTarget.files ?? []))} className={fieldClass}/></label>
        <p className="text-body-xs text-muted-foreground">Categorias de evidência necessárias: opção anual, Lucro Presumido, comércio de autopeças, reconciliação, cancelamentos/devoluções e recebimentos por caixa.</p>
        <Button variante="contorno" disabled={!podePreparar || somenteLeitura || evidenceFiles.length === 0 || declare.isPending} onClick={() => declare.mutate()}><FileUp aria-hidden="true"/> Registrar declaração imutável</Button>
        {declarationId ? <p className="break-all font-mono text-body-xs text-muted-foreground" role="status">Revisão da declaração: {declarationId}</p> : null}
      </article>
    </section>

    <section className="grid gap-md rounded-lg border border-border bg-card p-lg shadow-[var(--elevation-1)] tablet:grid-cols-2 desktop:grid-cols-[1fr_1fr_1fr_auto] desktop:items-end" aria-label="Preparar apuração">
      <Select rotulo="Pacote aprovado" valor={packageId} onValorChange={setPackageId} opcoes={approvedPackages.map((item) => ({ valor: item.id, rotulo: `${item.version} · ${item.valid_from}` }))}/>
      <div className="flex flex-col gap-xs"><label htmlFor="f38-declaration-id" className="text-label-md text-foreground">ID da declaração trimestral vigente</label><input id="f38-declaration-id" className={fieldClass} value={declarationId} onChange={(event) => setDeclarationId(event.target.value.trim())} placeholder="UUID retornado ao registrar"/></div>
      <Select rotulo="Quantidade de quotas coberta" valor={installmentCount} onValorChange={setInstallmentCount} opcoes={[1,2,3].map((value) => ({ valor: String(value), rotulo: value === 1 ? 'Quota única' : `${value} quotas` }))}/>
      <Button disabled={!podePreparar || somenteLeitura || !packageId || !declarationId || prepare.isPending} onClick={() => prepare.mutate()}><ShieldCheck aria-hidden="true"/> Preparar apuração</Button>
    </section>

    {assessmentId && current.isPending ? <div aria-busy="true"><Skeleton className="h-64 w-full"/></div> : null}
    {assessmentId && current.isError ? <ErroDeTela titulo="Revisão indisponível" descricao="O servidor não carregou a apuração selecionada." acao={<Button variante="contorno" onClick={() => void current.refetch()}>Tentar novamente</Button>}/> : null}
    {current.data ? <section className="flex flex-col gap-md rounded-lg border border-border bg-card p-lg shadow-[var(--elevation-1)]" aria-label="Resultado da revisão">
      <header className="flex flex-col gap-sm tablet:flex-row tablet:items-center tablet:justify-between"><div><p className="text-label-md uppercase tracking-wide text-muted-foreground">{current.data.quarter} · {current.data.revenueRecognition === 'CASH' ? 'Caixa' : 'Competência'} · revisão {current.data.revision}</p><h3 className="mt-xs font-display text-headline-sm text-foreground">Memória causal por tributo</h3><p className="break-all font-mono text-body-xs text-muted-foreground">SHA-256 {current.data.canonicalJsonHash}</p></div><StatusBadge tom={statusTone[current.data.status]} rotulo={statusText[current.data.status]}/></header>
      <div className="grid gap-md tablet:grid-cols-2"><div className="rounded-md bg-secondary/60 p-md"><p className="text-label-md text-muted-foreground">IRPJ preliminar</p><p className="mt-xs font-display text-headline-md tabular-nums text-foreground">{money(current.data.irpjPayableCents)}</p></div><div className="rounded-md bg-secondary/60 p-md"><p className="text-label-md text-muted-foreground">CSLL preliminar</p><p className="mt-xs font-display text-headline-md tabular-nums text-foreground">{money(current.data.csllPayableCents)}</p></div></div>
      {current.data.gapCodes.length ? <div className="rounded-md border border-destructive/30 bg-destructive/5 p-md" role="status"><p className="flex items-center gap-xs text-label-md text-destructive"><AlertTriangle aria-hidden="true"/> Lacunas que bloqueiam decisão</p><ul className="mt-sm list-inside list-disc text-body-sm text-foreground">{current.data.gapCodes.map((gap) => <li key={gap}>{gap}</li>)}</ul></div> : null}
      <div className="overflow-x-auto rounded-md border border-border"><table className="w-full min-w-[54rem] text-left text-body-sm"><thead className="bg-secondary text-label-md text-muted-foreground"><tr><th className="p-sm">Tributo</th><th className="p-sm">Atividade / natureza</th><th className="p-sm">Receita</th><th className="p-sm">Base presumida</th><th className="p-sm">Adição direta</th><th className="p-sm">Alíquotas</th><th className="p-sm">Imposto bruto</th><th className="p-sm">Regra / fontes</th></tr></thead><tbody>{current.data.components.length ? current.data.components.map((item, index) => <tr key={`${item.ruleId}-${index}`} className="border-t border-border"><td className="p-sm font-medium text-foreground">{item.tax}</td><td className="p-sm text-foreground">{item.activityCode}<span className="block text-muted-foreground">{item.revenueNatureCode}</span></td><td className="p-sm tabular-nums text-foreground">{money(item.grossRevenueCents)}</td><td className="p-sm tabular-nums text-foreground">{money(item.presumedBaseCents)}</td><td className="p-sm tabular-nums text-foreground">{money(item.directAdditionCents)}</td><td className="p-sm font-mono tabular-nums text-foreground">{item.presumptionRateScaled ?? '—'} / {item.taxRateScaled ?? '—'}</td><td className="p-sm tabular-nums text-foreground">{money(item.grossTaxCents)}</td><td className="p-sm text-muted-foreground"><span className="block font-medium text-foreground">{item.ruleId}</span>{item.sourceIds.map((source) => <span key={source} className="block break-all font-mono text-body-xs">{source}</span>)}</td></tr>) : <tr><td colSpan={8} className="p-lg text-center text-muted-foreground">Nenhum componente calculável; revise pacotes e evidências.</td></tr>}</tbody></table></div>
      {current.data.components.length ? <details className="rounded-md border border-border p-md"><summary className="cursor-pointer text-label-md text-foreground">Fórmula, valores usados e arredondamento</summary><ul className="mt-sm flex flex-col gap-sm">{current.data.components.map((item, index) => <li key={`${item.ruleId}-trace-${index}`} className="break-all text-body-xs text-muted-foreground"><span className="font-medium text-foreground">{item.tax} · {item.ruleId}</span><code className="mt-xs block font-mono">{item.calculationTrace.formula}<br/>Numerador: {item.calculationTrace.numerator}<br/>Denominador: {item.calculationTrace.denominator} · {item.calculationTrace.rounding}</code></li>)}</ul></details> : null}
      <div className="grid gap-md tablet:grid-cols-2"><div className="rounded-md border border-border p-md"><h4 className="text-label-md text-foreground">Deduções de IRPJ</h4>{current.data.deductions.filter((item) => item.tax === 'IRPJ').length ? current.data.deductions.filter((item) => item.tax === 'IRPJ').map((item) => <p key={`${item.evidenceId}-${item.ruleId}`} className="mt-xs break-all text-body-sm text-muted-foreground">{item.kind} · {money(item.amountCents)} · regra {item.ruleId} · evidência {item.evidenceId}<span className="block font-mono text-body-xs">{item.sourceIds.join(' · ')}</span></p>) : <p className="mt-xs text-body-sm text-muted-foreground">Nenhuma dedução comprovada declarada.</p>}</div><div className="rounded-md border border-border p-md"><h4 className="text-label-md text-foreground">Deduções de CSLL</h4>{current.data.deductions.filter((item) => item.tax === 'CSLL').length ? current.data.deductions.filter((item) => item.tax === 'CSLL').map((item) => <p key={`${item.evidenceId}-${item.ruleId}`} className="mt-xs break-all text-body-sm text-muted-foreground">{item.kind} · {money(item.amountCents)} · regra {item.ruleId} · evidência {item.evidenceId}<span className="block font-mono text-body-xs">{item.sourceIds.join(' · ')}</span></p>) : <p className="mt-xs text-body-sm text-muted-foreground">Nenhuma dedução comprovada declarada.</p>}</div></div>
      <div className="overflow-x-auto rounded-md border border-border"><table className="w-full min-w-[36rem] text-left text-body-sm"><thead className="bg-secondary text-label-md text-muted-foreground"><tr><th className="p-sm">Tributo</th><th className="p-sm">Quota</th><th className="p-sm">Principal</th><th className="p-sm">Acréscimo</th><th className="p-sm">Total preliminar</th><th className="p-sm">Vencimento</th></tr></thead><tbody>{current.data.installments.map((item) => <tr key={`${item.tax}-${item.installmentNumber}`} className="border-t border-border"><td className="p-sm text-foreground">{item.tax}</td><td className="p-sm text-foreground">{item.installmentNumber}</td><td className="p-sm tabular-nums text-foreground">{money(item.principalCents)}</td><td className="p-sm tabular-nums text-foreground">{money(item.additionCents)}</td><td className="p-sm tabular-nums text-foreground">{money(item.totalCents)}</td><td className="p-sm text-foreground">{item.dueDate}</td></tr>)}{current.data.installments.length === 0 ? <tr><td colSpan={6} className="p-md text-center text-muted-foreground">Quotas indisponíveis enquanto houver lacuna.</td></tr> : null}</tbody></table></div>
      <div className="flex flex-wrap gap-sm">{(['PDF','CSV','JSON'] as const).map((format) => <Button key={format} variante="contorno" disabled={current.data?.status !== 'APPROVED'} onClick={() => void download(current.data!, format)}><Download aria-hidden="true"/> {format}</Button>)}{(['READY_FOR_REVIEW','APPROVED'] as const).includes(current.data.status as 'READY_FOR_REVIEW'|'APPROVED') ? current.data.draftArtifactIds.map((id) => { const tax = current.data!.installments.find((item) => item.draftArtifactId === id)?.tax ?? 'IRPJ'; return <Button key={id} variante="contorno" onClick={() => void baixarArtefatoCorporativoPersistido(empresaId, current.data!.assessmentId, id, current.data!.preparationJsonHash).then(() => toast.success('Rascunho local salvo baixado.')).catch(() => toast.error('Artefato salvo indisponível ou hash divergente.'))}>Baixar rascunho {tax}</Button>; }) : null}</div>
      <p className="text-body-xs text-muted-foreground">Rascunhos locais sem valor oficial, autenticação, código de barras, pagamento, transmissão ou escrituração.</p>
      {current.data.status === 'READY_FOR_REVIEW' && podeRevisar && !somenteLeitura ? <div className="flex flex-col gap-md border-t border-border pt-lg"><label htmlFor="f38-review-justification" className="text-label-md text-foreground">Justificativa da decisão<textarea id="f38-review-justification" value={reviewReason} onChange={(event) => setReviewReason(event.target.value)} minLength={10} maxLength={2000} className={`${fieldClass} min-h-24`} placeholder="Registre a conferência das fontes e da memória."/></label>
        <label className="flex items-start gap-sm text-body-sm text-foreground"><input type="checkbox" checked={declarationsConfirmed} onChange={(event) => setDeclarationsConfirmed(event.currentTarget.checked)} className="mt-1 accent-primary"/> Confirmei as declarações, opções anuais, fontes e evidências anexadas.</label>
        <label className="flex items-start gap-sm text-body-sm text-foreground"><input type="checkbox" checked={localDraftsAcknowledged} onChange={(event) => setLocalDraftsAcknowledged(event.currentTarget.checked)} className="mt-1 accent-primary"/> Reconheço que arquivos são rascunhos locais não oficiais e não pagáveis.</label>
        <div className="flex flex-wrap gap-sm"><Button disabled={reviewReason.trim().length < 10 || !declarationsConfirmed || !localDraftsAcknowledged || review.isPending} onClick={() => review.mutate({ item: current.data!, action: 'APPROVED' })}><FileCheck2 aria-hidden="true"/> Aprovar apuração</Button><Button variante="contorno" disabled={reviewReason.trim().length < 10 || !declarationsConfirmed || !localDraftsAcknowledged || review.isPending} onClick={() => review.mutate({ item: current.data!, action: 'RETURNED' })}>Devolver</Button><Button variante="destrutiva" disabled={reviewReason.trim().length < 10 || !declarationsConfirmed || !localDraftsAcknowledged || review.isPending} onClick={() => review.mutate({ item: current.data!, action: 'REJECTED' })}>Rejeitar</Button></div></div> : null}
    </section> : null}

    <section className="flex flex-col gap-md"><h3 className="font-display text-headline-sm text-foreground">Revisões do trimestre</h3><ul className="divide-y divide-border rounded-lg border border-border bg-card">{(history.data ?? []).map((item) => <li key={item.id} className="flex flex-col gap-sm p-md tablet:flex-row tablet:items-center tablet:justify-between"><div className="min-w-0"><p className="font-mono text-body-sm text-foreground">Rev. {item.revision} · {item.id}</p><p className="break-all font-mono text-body-xs text-muted-foreground">{item.canonicalJsonHash}</p></div><div className="flex items-center gap-sm"><span className="text-body-xs text-muted-foreground">{new Date(item.createdAtUtc).toLocaleString('pt-BR')}</span><StatusBadge tom={item.status === 'APPROVED' ? 'conforme' : item.status === 'INDETERMINATE' ? 'critico' : 'atencao'} rotulo={item.status}/><Button variante="contorno" tamanho="compacto" onClick={() => setAssessmentId(item.id)}>Abrir</Button></div></li>)}{history.data?.length === 0 ? <li className="p-lg text-center text-body-sm text-muted-foreground">Nenhuma revisão para este trimestre.</li> : null}</ul></section>
  </div>;
};
