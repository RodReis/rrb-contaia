'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Calculator, Download, FileCheck2, FileUp, RefreshCw, ShieldCheck } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { MonthlyRulePackageSchema } from '@contaia/shared';

import { Button } from '@/components/ui/button';
import { ErroDeTela, Skeleton } from '@/components/ui/estados';
import { Select, type OpcaoDoSelect } from '@/components/ui/select';
import { StatusBadge, type TomDoStatus } from '@/components/ui/status-badge';
import {
  baixarRelatorioApuracao, declararApuracaoIcms, declararApuracaoSimples, importarPacoteMensal, listarApuracoesMensais,
  listarPacotesMensais, prepararApuracaoMensal, revisarApuracaoMensal, decidirPacoteMensal,
  type MonthlyAssessment,
} from './monthly-assessments-api';

const tipos = [
  { valor: 'SIMPLES_NACIONAL_DAS', rotulo: 'Simples Nacional · DAS' },
  { valor: 'LUCRO_PRESUMIDO_ICMS_DARE', rotulo: 'Lucro Presumido · ICMS próprio' },
] as const;
const rotulos: Record<MonthlyAssessment['status'], string> = {
  DRAFT: 'Rascunho', INCOMPLETE: 'Incompleta', INDETERMINATE: 'Indeterminada', READY_FOR_REVIEW: 'Pronta para revisão',
  APPROVED: 'Aprovada', REJECTED: 'Rejeitada', POSSIBLY_OUTDATED: 'Possivelmente desatualizada', SUPERSEDED: 'Superada',
};
const tons: Record<MonthlyAssessment['status'], TomDoStatus> = {
  DRAFT: 'neutro', INCOMPLETE: 'atencao', INDETERMINATE: 'critico', READY_FOR_REVIEW: 'atencao',
  APPROVED: 'conforme', REJECTED: 'critico', POSSIBLY_OUTDATED: 'atencao', SUPERSEDED: 'neutro',
};
const dinheiro = (cents: number | null) => cents === null ? 'Indeterminado' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
const competenciaAtual = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }).slice(0, 7);
const opcoesCompetencia: readonly OpcaoDoSelect[] = Array.from({ length: 18 }, (_, index) => {
  const [year, month] = competenciaAtual().split('-').map(Number);
  const date = new Date(Date.UTC(year!, month! - 1 - index, 1));
  const value = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  return { valor: value, rotulo: new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date) };
}).filter((item) => item.valor >= '2026-09');

export const PainelApuracaoMensal = ({ empresaId, somenteLeitura, podePreparar, podeRevisar }: {
  empresaId: string; somenteLeitura: boolean; podePreparar: boolean; podeRevisar: boolean;
}) => {
  const [competence, setCompetence] = useState(opcoesCompetencia[0]?.valor ?? '2026-09');
  const [kind, setKind] = useState<MonthlyAssessment['kind']>('SIMPLES_NACIONAL_DAS');
  const [rulePackageId, setRulePackageId] = useState('');
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [version, setVersion] = useState('');
  const [validFrom, setValidFrom] = useState(competence + '-01');
  const [officialBasis, setOfficialBasis] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [ruleRowsJson, setRuleRowsJson] = useState('');
  const [declarationJson, setDeclarationJson] = useState('');
  const [declarationJustification, setDeclarationJustification] = useState('');
  const [reason, setReason] = useState('');
  const queryClient = useQueryClient();
  const queryKey = ['f36-monthly-assessments', empresaId, competence, kind] as const;
  const assessments = useQuery({ queryKey, queryFn: () => listarApuracoesMensais(empresaId, competence, kind) });
  const packages = useQuery({ queryKey: ['f36-rule-packages', empresaId, kind], queryFn: () => listarPacotesMensais(empresaId, kind) });
  const refresh = () => queryClient.invalidateQueries({ queryKey });
  const prepare = useMutation({ mutationFn: () => prepararApuracaoMensal(empresaId, { competence, kind, rulePackageId }), onSuccess: () => { toast.success('Apuração preparada para revisão.'); void refresh(); }, onError: () => toast.error('Não foi possível preparar a apuração.') });
  const importPackage = useMutation({ mutationFn: async () => {
    if (!sourceFile) throw new Error('Anexe a fonte oficial.');
    const structure: unknown = JSON.parse(ruleRowsJson);
    const common = { kind, version, validFrom, validThrough: null, consultedAt: new Date().toISOString().slice(0, 10), officialBasis, sourceUrl, rounding: 'HALF_UP' };
    const pack = MonthlyRulePackageSchema.parse({ ...common, ...(typeof structure === 'object' && structure !== null ? structure : {}) });
    return importarPacoteMensal(empresaId, pack, sourceFile);
  }, onSuccess: () => { toast.success('Pacote importado para revisão; cobertura vazia não calcula.'); setSourceFile(null); void queryClient.invalidateQueries({ queryKey: ['f36-rule-packages', empresaId, kind] }); }, onError: () => toast.error('Não foi possível importar o pacote.') });
  const declare = useMutation({ mutationFn: async () => {
    if (!evidenceFile) throw new Error('Anexe a evidência.');
    let declaration: unknown;
    try { declaration = JSON.parse(declarationJson) as unknown; } catch { throw new Error('A declaração precisa ser um JSON válido.'); }
    if (typeof declaration !== 'object' || declaration === null || Array.isArray(declaration)) throw new Error('A declaração precisa ser um objeto JSON.');
    if (declarationJustification.trim().length < 10) throw new Error('Informe a justificativa da declaração.');
    return kind === 'SIMPLES_NACIONAL_DAS'
      ? declararApuracaoSimples(empresaId, { competence, justification: declarationJustification, declaration: declaration as Record<string, unknown>, file: evidenceFile })
      : declararApuracaoIcms(empresaId, { competence, justification: declarationJustification, declaration: declaration as Record<string, unknown>, file: evidenceFile });
  }, onSuccess: () => { toast.success('Declaração complementar e evidência registradas.'); setEvidenceFile(null); void refresh(); }, onError: () => toast.error('Não foi possível registrar a declaração.') });
  const decidePackage = useMutation({ mutationFn: ({ id, action }: { id: string; action: 'APPROVED' | 'REJECTED' }) => decidirPacoteMensal(empresaId, id, action, reason), onSuccess: () => { toast.success('Decisão do pacote registrada.'); setReason(''); void queryClient.invalidateQueries({ queryKey: ['f36-rule-packages', empresaId, kind] }); }, onError: () => toast.error('Não foi possível decidir o pacote.') });
  const review = useMutation({ mutationFn: ({ item, action }: { item: MonthlyAssessment; action: 'APPROVED' | 'REJECTED' | 'RETURNED_FOR_EVIDENCE' }) => revisarApuracaoMensal(empresaId, item, action, reason), onSuccess: () => { toast.success('Decisão registrada em nova revisão.'); setReason(''); void refresh(); }, onError: () => toast.error('A decisão não foi registrada.') });
  const current = assessments.data?.[0];
  const download = async (item: MonthlyAssessment, format: 'PDF' | 'CSV' | 'JSON') => { try { await baixarRelatorioApuracao(empresaId, item.assessmentId, item.canonicalJsonHash, format); toast.success(`${format} baixado.`); } catch { toast.error('Não foi possível baixar este arquivo.'); } };
  const options = useMemo(() => tipos.map((item) => ({ valor: item.valor, rotulo: item.rotulo })), []);

  if (assessments.isPending) return <div className="flex flex-col gap-md" aria-busy="true"><Skeleton className="h-20 w-full" /><Skeleton className="h-64 w-full" /></div>;
  if (assessments.isError) return <ErroDeTela titulo="Apuração indisponível" descricao="Não foi possível carregar as revisões mensais desta empresa." acao={<Button variante="contorno" onClick={() => void assessments.refetch()}>Tentar novamente</Button>} />;

  return (
    <div role="region" aria-label="Apuração fiscal mensal" className="flex flex-col gap-xl">
      <header className="flex flex-col gap-sm tablet:flex-row tablet:items-end tablet:justify-between">
        <div className="max-w-3xl space-y-xs">
          <p className="text-label-md uppercase tracking-wide text-muted-foreground">Fiscal · F36</p>
          <h2 className="font-display text-headline-lg text-foreground">Apuração fiscal mensal</h2>
          <p className="text-body-md text-muted-foreground">Memória de cálculo rastreável, revisão humana e rascunho local. Não transmite nem emite guia oficial.</p>
        </div>
        <Button variante="contorno" tamanho="compacto" onClick={() => void assessments.refetch()} aria-label="Atualizar apurações"><RefreshCw aria-hidden="true" /> Atualizar</Button>
      </header>

      <section className="grid gap-md rounded-lg border border-border bg-card p-lg shadow-[var(--elevation-1)] tablet:grid-cols-[1fr_1fr_1.4fr_auto] tablet:items-end" aria-label="Parâmetros da apuração">
        <Select rotulo="Competência" valor={competence} onValorChange={setCompetence} opcoes={opcoesCompetencia} />
        <Select rotulo="Trilha fiscal" valor={kind} onValorChange={(value) => setKind(value as MonthlyAssessment['kind'])} opcoes={options} />
        <div className="flex flex-col gap-xs">
          <label htmlFor="f36-rule-package" className="text-label-md text-foreground">ID do pacote normativo aprovado</label>
          <input id="f36-rule-package" value={rulePackageId} onChange={(event) => setRulePackageId(event.target.value.trim())} placeholder="UUID do pacote importado e revisado" className="h-11 rounded-md border border-input bg-background px-md text-body-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          <span className="text-body-xs text-muted-foreground">Pacotes dependem de fonte oficial carregada e aprovação do contador.</span>
        </div>
        <Button disabled={somenteLeitura || !podePreparar || !rulePackageId || prepare.isPending} onClick={() => prepare.mutate()}><Calculator aria-hidden="true" /> Preparar</Button>
      </section>

      <section className="grid gap-lg desktop:grid-cols-2">
        <article className="flex flex-col gap-md rounded-lg border border-border bg-card p-lg shadow-[var(--elevation-1)]">
          <div><h3 className="font-display text-headline-sm text-foreground">Pacote normativo</h3><p className="mt-xs text-body-sm text-muted-foreground">Importe fonte oficial e estrutura revisada. O formulário não preenche alíquotas nem regras por conta própria.</p></div>
          <div className="grid gap-md tablet:grid-cols-2"><label className="flex flex-col gap-xs text-label-md text-foreground">Versão<input value={version} onChange={(event) => setVersion(event.target.value)} className="h-11 rounded-md border border-input bg-background px-md text-body-sm" placeholder="Identificação oficial"/></label><label className="flex flex-col gap-xs text-label-md text-foreground">Início da vigência<input type="date" value={validFrom} onChange={(event) => setValidFrom(event.target.value)} className="h-11 rounded-md border border-input bg-background px-md text-body-sm"/></label><label className="flex flex-col gap-xs text-label-md text-foreground tablet:col-span-2">Fundamento oficial<input value={officialBasis} onChange={(event) => setOfficialBasis(event.target.value)} className="h-11 rounded-md border border-input bg-background px-md text-body-sm" placeholder="Ato, artigo e publicação oficial"/></label><label className="flex flex-col gap-xs text-label-md text-foreground tablet:col-span-2">URL da fonte<input type="url" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} className="h-11 rounded-md border border-input bg-background px-md text-body-sm" placeholder="https://..."/></label><label className="flex flex-col gap-xs text-label-md text-foreground tablet:col-span-2">Arquivo da fonte oficial<input type="file" accept=".pdf,.xml,.json,.csv" onChange={(event) => setSourceFile(event.target.files?.[0] ?? null)} className="text-body-sm text-foreground file:mr-sm file:rounded-md file:border file:border-border file:bg-secondary file:px-md file:py-sm"/></label></div>
          <label className="flex flex-col gap-xs text-label-md text-foreground tablet:col-span-2">Regras estruturadas conferidas na fonte oficial<textarea value={ruleRowsJson} onChange={(event) => setRuleRowsJson(event.target.value)} className="min-h-48 rounded-md border border-input bg-background p-md font-mono text-body-xs" placeholder={kind === 'SIMPLES_NACIONAL_DAS' ? '{\"brackets\":[...],\"segregations\":[...]}' : '{\"operations\":[...],\"allowedAdjustments\":[]}'}/><span className="text-body-xs text-muted-foreground">Preencha a estrutura conforme a fonte anexada. O sistema não sugere nem completa valores normativos.</span></label>
          <Button variante="contorno" disabled={somenteLeitura || !podePreparar || !sourceFile || !version || !officialBasis || !sourceUrl || !ruleRowsJson.trim() || importPackage.isPending} onClick={() => importPackage.mutate()}><FileUp aria-hidden="true"/> Importar regras para revisão</Button>
          {packages.data?.map((item) => <div key={item.id} className="flex flex-col gap-sm rounded-md border border-border p-md"><div className="flex flex-wrap items-center justify-between gap-sm"><div><p className="text-label-md text-foreground">{item.version} · {item.valid_from} a {item.valid_through ?? 'sem fim declarado'}</p><p className="text-body-xs text-muted-foreground">Fonte SHA-256 {item.source_sha256.slice(0, 16)}… · {item.official_basis}</p><a className="text-body-xs text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={item.source_url} target="_blank" rel="noreferrer">Consultar fonte oficial</a></div><StatusBadge tom={item.status === 'APPROVED' ? 'conforme' : item.status === 'REJECTED' ? 'critico' : 'atencao'} rotulo={item.status === 'IMPORTED' ? 'Aguardando revisão' : item.status === 'APPROVED' ? 'Aprovado' : item.status === 'REJECTED' ? 'Rejeitado' : item.status}/></div><details><summary className="cursor-pointer text-label-md text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Conferir regras estruturadas</summary><pre className="mt-sm max-h-64 overflow-auto rounded-md bg-secondary p-md text-body-xs text-foreground">{JSON.stringify(item.canonical_json, null, 2)}</pre></details>{item.status === 'IMPORTED' && podeRevisar ? <div className="flex gap-sm"><Button tamanho="compacto" disabled={reason.trim().length < 10 || decidePackage.isPending} onClick={() => decidePackage.mutate({ id: item.id, action: 'APPROVED' })}>Aprovar pacote</Button><Button variante="destrutiva" tamanho="compacto" disabled={reason.trim().length < 10 || decidePackage.isPending} onClick={() => decidePackage.mutate({ id: item.id, action: 'REJECTED' })}>Rejeitar pacote</Button></div> : null}<Button variante="fantasma" tamanho="compacto" disabled={item.status !== 'APPROVED'} onClick={() => setRulePackageId(item.id)}>Usar pacote aprovado</Button></div>)}
        </article>

        <article className="flex flex-col gap-md rounded-lg border border-border bg-card p-lg shadow-[var(--elevation-1)]"><div><h3 className="font-display text-headline-sm text-foreground">Declaração complementar</h3><p className="mt-xs text-body-sm text-muted-foreground">Informe os dados extraídos da evidência. Valores mensais e referências documentais não são estimados pelo sistema.</p></div><div className="grid gap-md"><label className="flex flex-col gap-xs text-label-md text-foreground">Dados declarados em JSON<textarea value={declarationJson} onChange={(event) => setDeclarationJson(event.target.value)} className="min-h-52 rounded-md border border-input bg-background p-md font-mono text-body-xs" placeholder={kind === 'SIMPLES_NACIONAL_DAS' ? '{\"rbt12ByMonth\":[{\"month\":\"2026-09\",\"cents\":0}],\"revenue\":[{\"code\":\"...\",\"cents\":0,\"sourceIds\":[\"document-id:hash\"]}],\"optionValid\":false,\"revenueReconciled\":false,\"activityVerified\":false,\"historyComplete\":false}' : '{\"adjustments\":[],\"priorCreditCents\":0,\"priorCreditProven\":false,\"priorCreditAssessmentId\":null,\"allOperationsCovered\":false,\"activityVerified\":false,\"returnCancellationReconciled\":false,\"excludedOperationsHandled\":false}'}/><span className="text-body-xs text-muted-foreground">Para Simples, informe cada competência mensal e os IDs dos documentos usados. Campos de conferência só devem refletir evidência revisada.</span></label><label className="flex flex-col gap-xs text-label-md text-foreground">Justificativa da declaração<textarea value={declarationJustification} onChange={(event) => setDeclarationJustification(event.target.value)} minLength={10} maxLength={1000} className="min-h-20 rounded-md border border-input bg-background p-md text-body-sm"/></label><label className="flex flex-col gap-xs text-label-md text-foreground">Evidência (PDF, PNG ou JPEG)<input type="file" accept="application/pdf,image/png,image/jpeg" onChange={(event) => setEvidenceFile(event.target.files?.[0] ?? null)} className="text-body-sm text-foreground file:mr-sm file:rounded-md file:border file:border-border file:bg-secondary file:px-md file:py-sm"/></label></div><Button variante="contorno" disabled={somenteLeitura || !podePreparar || !evidenceFile || !declarationJson.trim() || declarationJustification.trim().length < 10 || declare.isPending} onClick={() => declare.mutate()}><FileCheck2 aria-hidden="true"/> Registrar declaração e evidência</Button></article>
      </section>

      {(packages.data?.some((item) => item.status === 'IMPORTED') ?? false) ? <div className="flex flex-col gap-xs"><label htmlFor="f36-package-reason" className="text-label-md text-foreground">Justificativa para pacote/avaliação</label><textarea id="f36-package-reason" value={reason} onChange={(event) => setReason(event.target.value)} minLength={10} maxLength={500} className="min-h-20 rounded-md border border-input bg-background p-md text-body-sm text-foreground" placeholder="Descreva a conferência da fonte e da cobertura."/></div> : null}

      <div className="grid gap-md tablet:grid-cols-3">
        <article className="rounded-lg border border-border bg-card p-lg shadow-[var(--elevation-1)]"><p className="text-label-md text-muted-foreground">Competência</p><p className="mt-sm font-display text-headline-sm text-foreground">{competence}</p><p className="mt-xs text-body-sm text-muted-foreground">Regra vigente e documentos do período são validados ao preparar.</p></article>
        <article className="rounded-lg border border-border bg-card p-lg shadow-[var(--elevation-1)]"><p className="text-label-md text-muted-foreground">Revisões</p><p className="mt-sm font-display text-headline-sm text-foreground">{assessments.data.length}</p><p className="mt-xs text-body-sm text-muted-foreground">Cada correção gera uma revisão imutável.</p></article>
        <article className="rounded-lg border border-warning/40 bg-warning/10 p-lg"><div className="flex items-start gap-sm"><ShieldCheck className="mt-0.5 text-warning-foreground" aria-hidden="true"/><div><p className="text-label-md text-foreground">Controle da apuração</p><p className="mt-xs text-body-sm text-muted-foreground">Lacuna ou regra sem cobertura deixa o total indeterminado; nenhum valor é presumido.</p></div></div></article>
      </div>

      {current ? (
        <section className="flex flex-col gap-lg rounded-lg border border-border bg-card p-lg shadow-[var(--elevation-1)]" aria-labelledby="f36-current-title">
          <div className="flex flex-col gap-md tablet:flex-row tablet:items-start tablet:justify-between">
            <div className="space-y-sm"><div className="flex flex-wrap items-center gap-sm"><h3 id="f36-current-title" className="font-display text-headline-sm text-foreground">Revisão mais recente · {current.competence}</h3><StatusBadge tom={tons[current.status]} rotulo={rotulos[current.status]} /></div><p className="text-body-sm text-muted-foreground">{kind === 'SIMPLES_NACIONAL_DAS' ? 'Rascunho de DAS · Anexo I' : 'Rascunho de DARE · ICMS próprio'} · hash {current.canonicalJsonHash.slice(0, 16)}…</p></div>
            <div className="flex flex-wrap gap-xs">{(['PDF', 'CSV', 'JSON'] as const).map((format) => <Button key={format} variante="contorno" tamanho="compacto" disabled={current.status === 'INDETERMINATE' || current.status === 'INCOMPLETE' || current.status === 'DRAFT' || current.status === 'REJECTED' || current.status === 'POSSIBLY_OUTDATED' || current.status === 'SUPERSEDED'} onClick={() => void download(current, format)}><Download aria-hidden="true" /> {format}</Button>)}</div>
          </div>
          <div className="flex flex-col gap-md rounded-md bg-secondary/60 p-md tablet:flex-row tablet:items-center tablet:justify-between"><div><p className="text-label-md text-muted-foreground">Total calculado</p><p className="mt-xs font-display text-headline-lg tabular-nums text-foreground">{dinheiro(current.totalCents)}</p></div><p className="max-w-[42rem] text-body-sm text-muted-foreground">Este resultado é memória para conferência. A aprovação não cria débito e o arquivo não pode ser pago.</p></div>
          {current.gapCodes.length ? <div className="rounded-md border border-destructive/30 bg-destructive/5 p-md" role="status"><p className="flex items-center gap-xs text-label-md text-destructive"><AlertTriangle aria-hidden="true" /> Pendências que impedem a conclusão</p><ul className="mt-sm list-inside list-disc text-body-sm text-foreground">{current.gapCodes.map((gap) => <li key={gap}>{gap}</li>)}</ul></div> : null}
          <div className="overflow-x-auto rounded-md border border-border"><table className="w-full min-w-[42rem] text-left text-body-sm"><thead className="bg-secondary text-label-md text-muted-foreground"><tr><th className="p-md">Componente</th><th className="p-md">Base</th><th className="p-md">Alíquota escalada</th><th className="p-md">Valor</th><th className="p-md">Regra e fontes</th></tr></thead><tbody>{current.components.length ? current.components.map((part, index) => <tr key={`${part.ruleId}-${part.code}-${index}`} className="border-t border-border"><td className="p-md font-medium text-foreground">{part.code}</td><td className="p-md tabular-nums text-foreground">{dinheiro(part.baseCents)}</td><td className="p-md tabular-nums text-foreground">{part.rateScaled ?? '—'}</td><td className="p-md tabular-nums text-foreground">{dinheiro(part.amountCents)}</td><td className="p-md text-muted-foreground"><span>{part.ruleId}</span><br/><span>{part.sourceIds.length} fonte(s) vinculada(s)</span></td></tr>) : <tr><td colSpan={5} className="p-lg text-center text-muted-foreground">Sem componente calculável nesta revisão.</td></tr>}</tbody></table></div>
          {current.status === 'READY_FOR_REVIEW' && podeRevisar && !somenteLeitura ? <div className="flex flex-col gap-md border-t border-border pt-lg"><label htmlFor="f36-review-reason" className="text-label-md text-foreground">Justificativa da revisão</label><textarea id="f36-review-reason" minLength={10} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} className="min-h-24 rounded-md border border-input bg-background p-md text-body-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" placeholder="Registre a conferência e o aceite explícito do rascunho local."/><div className="flex flex-wrap gap-sm"><Button disabled={reason.trim().length < 10 || review.isPending} onClick={() => review.mutate({ item: current, action: 'APPROVED' })}><FileCheck2 aria-hidden="true"/> Aprovar revisão</Button><Button variante="contorno" disabled={reason.trim().length < 10 || review.isPending} onClick={() => review.mutate({ item: current, action: 'RETURNED_FOR_EVIDENCE' })}>Devolver para evidência</Button><Button variante="destrutiva" disabled={reason.trim().length < 10 || review.isPending} onClick={() => review.mutate({ item: current, action: 'REJECTED' })}>Rejeitar</Button></div></div> : null}
        </section>
      ) : <div className="rounded-lg border border-dashed border-border bg-card p-xl text-center"><Calculator className="mx-auto size-icon-lg text-muted-foreground" aria-hidden="true"/><h3 className="mt-md font-display text-headline-sm text-foreground">Nenhuma revisão nesta competência</h3><p className="mx-auto mt-xs max-w-[42rem] text-body-sm text-muted-foreground">Importe e aprove um pacote oficial, registre as declarações e evidências e prepare uma apuração para consultar a memória e as lacunas.</p></div>}

      {assessments.data.length > 1 ? <section className="flex flex-col gap-md"><h3 className="font-display text-headline-sm text-foreground">Histórico de revisões</h3><ul className="divide-y divide-border rounded-lg border border-border bg-card">{assessments.data.slice(1).map((item) => <li key={item.assessmentId} className="flex flex-col gap-sm p-md tablet:flex-row tablet:items-center tablet:justify-between"><div><p className="text-label-md text-foreground">{item.competence} · {item.assessmentId.slice(0, 8)}</p><p className="text-body-sm text-muted-foreground">{item.canonicalJsonHash.slice(0, 16)}… · {dinheiro(item.totalCents)}</p></div><StatusBadge tom={tons[item.status]} rotulo={rotulos[item.status]} /></li>)}</ul></section> : null}
    </div>
  );
};
