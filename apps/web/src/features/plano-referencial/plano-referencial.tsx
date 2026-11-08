'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { z } from 'zod';
import { toast } from 'sonner';

import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { ler } from '../importacao/api';

const PacoteSchema = z.object({
  id: z.string(), authority: z.string(), sourceDocument: z.string(), sourceUrl: z.string(), layout: z.string(), revision: z.string(),
  coveredCalendarYears: z.array(z.number()),
  coveredSpecialSituations: z.array(z.object({ year: z.number(), code: z.string() })),
  downloadedAt: z.string(), sourceSha256: z.string(), canonicalSha256: z.string(),
  status: z.enum(['AVAILABLE', 'SUPERSEDED', 'REVOKED', 'UNAVAILABLE']),
});
const ConsultaSchema = z.object({
  company: z.object({ id: z.string(), name: z.string().nullable(), cnpj: z.string() }),
  calendarYear: z.number(), taxRegime: z.enum(['LUCRO_PRESUMIDO', 'SIMPLES_NACIONAL']),
  specialSituation: z.string().nullable(), applicability: z.enum(['APPLICABLE', 'OPTIONAL', 'INDETERMINATE']),
  selectedPackageId: z.string().nullable(), packages: z.array(PacoteSchema),
  mappings: z.array(z.object({ id: z.string(), calendarYear: z.number(), taxRegime: z.enum(['LUCRO_PRESUMIDO', 'SIMPLES_NACIONAL']),
    specialSituation: z.string().nullable(), packageId: z.string(), applicability: z.enum(['APPLICABLE', 'OPTIONAL']),
    status: z.enum(['DRAFT', 'PUBLISHED', 'SUPERSEDED']), version: z.number().nullable(), revision: z.number(),
    canonicalSha256: z.string().nullable(), createdAt: z.string(), publishedAt: z.string().nullable() })),
  eligibleAccounts: z.array(z.object({ id: z.string(), code: z.string(), name: z.string(), nature: z.string(),
    accountClass: z.string().nullable(), costCenterPolicy: z.string().nullable(), complete: z.boolean() })),
  referenceAccounts: z.array(z.object({ code: z.string(), description: z.string(), sourceNature: z.string(),
    parentCode: z.string().nullable(), validFrom: z.string().nullable(), validTo: z.string().nullable(), status: z.string() })),
  draftDecisions: z.array(z.object({ accountCode: z.string(), centerCode: z.string().nullable(), kind: z.enum(['MAPPED', 'NOT_APPLICABLE']),
    referenceCode: z.string().nullable(), reason: z.string().nullable() })),
});

type DecisaoRascunho = { kind: 'MAPPED' | 'NOT_APPLICABLE' | ''; referenceCode: string; reason: string };

const formatarHash = (hash: string): string => `${hash.slice(0, 12)}…${hash.slice(-8)}`;

export const PlanoReferencial = ({ empresaId, somenteLeitura = false }: { empresaId: string; somenteLeitura?: boolean }) => {
  const cache = useQueryClient();
  const [calendarYear, setCalendarYear] = useState('2025');
  const [taxRegime, setTaxRegime] = useState<'LUCRO_PRESUMIDO' | 'SIMPLES_NACIONAL'>('LUCRO_PRESUMIDO');
  const [buscaConta, setBuscaConta] = useState('');
  const [edicaoDecisoes, setEdicaoDecisoes] = useState<{ key: string; values: Record<string, DecisaoRascunho> } | null>(null);
  const consulta = useQuery({
    queryKey: ['plano-referencial', empresaId, calendarYear, taxRegime],
    queryFn: async () => {
      const params = new URLSearchParams({ calendarYear, taxRegime });
      return ConsultaSchema.parse(await ler(`/empresas/${empresaId}/plano-referencial?${params.toString()}`));
    },
  });
  const pacote = consulta.data?.packages.find((item) => item.id === consulta.data?.selectedPackageId);
  const pacotesHistoricos = consulta.data?.packages.filter((item) => item.status !== 'AVAILABLE') ?? [];
  const rascunho = consulta.data?.mappings.find((item) => item.status === 'DRAFT');
  const chaveRascunho = `${rascunho?.id ?? ''}:${rascunho?.revision ?? ''}`;
  const decisoesRemotas = useMemo(() => {
    const iniciais: Record<string, DecisaoRascunho> = {};
    for (const item of consulta.data?.draftDecisions ?? []) {
      if (item.centerCode === null) iniciais[item.accountCode] = { kind: item.kind, referenceCode: item.referenceCode ?? '', reason: item.reason ?? '' };
    }
    return iniciais;
  }, [consulta.data?.draftDecisions]);
  const decisoes = edicaoDecisoes?.key === chaveRascunho ? edicaoDecisoes.values : decisoesRemotas;
  const contasFiltradas = useMemo(() => (consulta.data?.eligibleAccounts ?? []).filter((item) =>
    `${item.code} ${item.name}`.toLocaleLowerCase('pt-BR').includes(buscaConta.trim().toLocaleLowerCase('pt-BR'))),
  [consulta.data?.eligibleAccounts, buscaConta]);
  const totalContas = consulta.data?.eligibleAccounts.length ?? 0;
  const decisoesCompletas = Object.values(decisoes).filter((item) => item.kind === 'MAPPED'
    ? item.referenceCode !== '' : item.kind === 'NOT_APPLICABLE' && item.reason.trim() !== '').length;
  const pendentes = Math.max(0, totalContas - decisoesCompletas);

  const atualizarDecisao = (codigo: string, alteracao: Partial<DecisaoRascunho>) => {
    const atual = decisoes[codigo] ?? { kind: '' as const, referenceCode: '', reason: '' };
    setEdicaoDecisoes({ key: chaveRascunho, values: { ...decisoes, [codigo]: { ...atual, ...alteracao } } });
  };

  const invalidar = async () => cache.invalidateQueries({ queryKey: ['plano-referencial', empresaId] });
  const criarRascunho = useMutation({
    mutationFn: () => ler(`/empresas/${empresaId}/plano-referencial/rascunhos`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ calendarYear: Number(calendarYear), taxRegime, specialSituation: null, packageId: consulta.data?.selectedPackageId }) }),
    onSuccess: async () => { toast.success('Rascunho referencial criado.'); await invalidar(); },
    onError: () => toast.error('Não foi possível criar o rascunho referencial.'),
  });
  const salvarDecisoes = useMutation({
    mutationFn: () => ler(`/empresas/${empresaId}/plano-referencial/rascunhos/${rascunho?.id}/decisoes`, { method: 'PUT',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedRevision: rascunho?.revision,
        decisions: Object.entries(decisoes).flatMap(([accountCode, item]) => item.kind === '' ? [] : [{ accountCode, centerCode: null,
          kind: item.kind, referenceCode: item.kind === 'MAPPED' ? item.referenceCode || null : null,
          reason: item.kind === 'NOT_APPLICABLE' ? item.reason || null : null }]) }) }),
    onSuccess: async () => { toast.success('Decisões do rascunho salvas.'); await invalidar(); },
    onError: () => toast.error('Não foi possível salvar. Atualize o rascunho e tente novamente.'),
  });
  const publicar = useMutation({
    mutationFn: () => ler(`/empresas/${empresaId}/plano-referencial/rascunhos/${rascunho?.id}/publicacao`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedRevision: rascunho?.revision }) }),
    onSuccess: async () => { toast.success('Versão referencial publicada.'); await invalidar(); },
    onError: () => toast.error('A publicação foi bloqueada. Revise cobertura e compatibilidade.'),
  });

  return <section aria-labelledby="plano-referencial-titulo" className="grid gap-lg" data-testid="plano-referencial">
    <header>
      <p className="text-label-sm uppercase tracking-wide text-muted-foreground">Estrutura contábil · F47</p>
      <h3 id="plano-referencial-titulo" className="mt-xs text-title-lg">Plano referencial</h3>
      <p className="mt-xs max-w-3xl text-body-sm text-muted-foreground">Vincule contas analíticas da empresa a um pacote oficial, por exercício. Este cadastro não gera livros nem arquivo ECD.</p>
    </header>

    <div className="grid gap-md rounded-lg border border-border bg-card p-md tablet:grid-cols-2">
      <Select rotulo="Exercício civil" valor={calendarYear} onValorChange={setCalendarYear} opcoes={[
        { valor: '2025', rotulo: '2025' }, { valor: '2026', rotulo: '2026' },
      ]} />
      <Select rotulo="Regime tributário" valor={taxRegime} onValorChange={(value) => setTaxRegime(value as typeof taxRegime)} opcoes={[
        { valor: 'LUCRO_PRESUMIDO', rotulo: 'Lucro Presumido' }, { valor: 'SIMPLES_NACIONAL', rotulo: 'Simples Nacional · configuração opcional' },
      ]} />
    </div>

    {consulta.isPending ? <p role="status" className="rounded-md border border-border p-md text-body-sm text-muted-foreground">Consultando a cobertura oficial…</p> : null}
    {consulta.isError ? <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-md text-body-sm">Falha ao consultar o catálogo referencial. Tente novamente.</p> : null}

    {consulta.data?.applicability === 'INDETERMINATE' ? <section role="status" className="grid gap-sm rounded-lg border border-warning/50 bg-warning/5 p-lg">
      <div className="flex flex-wrap items-center justify-between gap-sm">
        <h4 className="text-title-md">Cobertura oficial indeterminada</h4>
        <span className="rounded-full border border-warning/50 px-sm py-1 text-label-sm">INDETERMINATE</span>
      </div>
      <p className="max-w-3xl text-body-sm">O catálogo não contém o arquivo oficial da ECF leiaute 12, revisão de 07/09/2026, aprovado para esta cobertura. Sem o arquivo e seus hashes, o sistema não oferece pacote, rascunho ou publicação.</p>
      {calendarYear === '2026' ? <p className="text-body-sm">O ano-calendário ordinário de 2026 permanece sem cobertura declarada.</p> : null}
      <a className="w-fit text-label-md text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href="https://www.gov.br/sped/pt-br/assuntos/escrituracoes-digitais/ecf" target="_blank" rel="noreferrer">Consultar a página oficial da ECF</a>
    </section> : null}

    {consulta.data?.applicability !== 'INDETERMINATE' && pacote ? <>
      <section className="grid gap-md rounded-lg border border-border bg-card p-lg">
        <div className="flex flex-wrap items-start justify-between gap-sm">
          <div><h4 className="text-title-md">Pacote aplicável</h4><p className="mt-xs text-body-sm text-muted-foreground">{pacote.authority} · {pacote.sourceDocument}</p></div>
          <span className="rounded-full border border-success/50 px-sm py-1 text-label-sm">{consulta.data?.applicability === 'OPTIONAL' ? 'Configuração opcional' : 'Cobertura disponível'}</span>
        </div>
        <dl className="grid gap-sm text-body-sm tablet:grid-cols-2">
          <div><dt className="text-muted-foreground">Leiaute e revisão</dt><dd>{pacote.layout} · {pacote.revision}</dd></div>
          <div><dt className="text-muted-foreground">Anos cobertos</dt><dd>{pacote.coveredCalendarYears.join(', ') || 'Nenhum'}</dd></div>
          <div><dt className="text-muted-foreground">SHA-256 do arquivo</dt><dd className="font-mono">{formatarHash(pacote.sourceSha256)}</dd></div>
          <div><dt className="text-muted-foreground">SHA-256 canônico</dt><dd className="font-mono">{formatarHash(pacote.canonicalSha256)}</dd></div>
        </dl>
      </section>
      {!somenteLeitura && rascunho === undefined ? <Button variante="primaria" onClick={() => criarRascunho.mutate()} disabled={criarRascunho.isPending}>Criar rascunho do exercício</Button> : null}
      {rascunho !== undefined ? <section aria-labelledby="decisoes-referenciais" className="grid gap-md">
        <div className="flex flex-wrap items-end justify-between gap-sm">
          <div><h4 id="decisoes-referenciais" className="text-title-md">Mapeamento-base</h4><p className="text-body-sm text-muted-foreground">Rascunho · revisão {rascunho.revision}. Exceções por centro e CSV ainda não estão disponíveis.</p></div>
          <label className="grid gap-xs text-label-sm">Filtrar contas<input value={buscaConta} onChange={(event) => setBuscaConta(event.target.value)} className="h-10 rounded-md border border-input bg-background px-sm text-body-sm" /></label>
        </div>
        <div className="grid gap-sm tablet:grid-cols-3" aria-label="Cobertura do rascunho">
          <div className="rounded-md border border-border bg-card p-md"><p className="text-label-sm text-muted-foreground">Contas ativas</p><p className="mt-xs text-title-md">{totalContas}</p></div>
          <div className="rounded-md border border-border bg-card p-md"><p className="text-label-sm text-muted-foreground">Decisões completas</p><p className="mt-xs text-title-md">{decisoesCompletas}</p></div>
          <div className="rounded-md border border-border bg-card p-md"><p className="text-label-sm text-muted-foreground">Pendentes</p><p className="mt-xs text-title-md">{pendentes}</p></div>
        </div>
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[44rem] text-left text-body-sm"><thead className="bg-muted/40 text-label-sm"><tr><th className="p-sm">Conta da empresa</th><th className="p-sm">Natureza</th><th className="p-sm">Decisão</th><th className="p-sm">Conta referencial / justificativa</th></tr></thead>
            <tbody>{contasFiltradas.map((account) => {
              const current = decisoes[account.code] ?? { kind: '' as const, referenceCode: '', reason: '' };
              const natureza = account.nature === 'devedora' ? 'DEBIT' : account.nature === 'credora' ? 'CREDIT' : '';
              const refs = consulta.data?.referenceAccounts.filter((item) => item.sourceNature === natureza
                && (item.validFrom === null || item.validFrom.slice(0, 4) <= calendarYear)
                && (item.validTo === null || item.validTo.slice(0, 4) >= calendarYear)) ?? [];
              return <tr key={account.id} className="border-t border-border align-top"><td className="p-sm"><span className="font-mono">{account.code}</span><br />{account.name}{!account.complete ? <span className="block text-destructive">Cadastro incompleto na F39</span> : null}</td>
                <td className="p-sm"><select aria-label={`Decisão da conta ${account.code}`} value={current.kind} disabled={somenteLeitura || !account.complete} onChange={(event) => atualizarDecisao(account.code, { kind: event.target.value as DecisaoRascunho['kind'] })} className="h-10 rounded-md border border-input bg-background px-sm"><option value="">Pendente</option><option value="MAPPED">Mapeada</option><option value="NOT_APPLICABLE">Não aplicável</option></select></td>
                <td className="p-sm">{current.kind === 'MAPPED' ? <select aria-label={`Referência da conta ${account.code}`} value={current.referenceCode} disabled={somenteLeitura} onChange={(event) => atualizarDecisao(account.code, { referenceCode: event.target.value })} className="h-10 w-full rounded-md border border-input bg-background px-sm"><option value="">Selecione referência</option>{refs.map((item) => <option key={item.code} value={item.code}>{item.code} · {item.description}</option>)}</select> : current.kind === 'NOT_APPLICABLE' ? <input aria-label={`Justificativa da conta ${account.code}`} disabled={somenteLeitura} value={current.reason} onChange={(event) => atualizarDecisao(account.code, { reason: event.target.value })} placeholder="Justificativa obrigatória" className="h-10 w-full rounded-md border border-input bg-background px-sm" /> : <span className="text-muted-foreground">—</span>}</td></tr>;
            })}</tbody>
          </table>
        </div>
        {!somenteLeitura ? <div className="flex flex-wrap justify-end gap-sm"><Button variante="contorno" onClick={() => salvarDecisoes.mutate()} disabled={salvarDecisoes.isPending}>Salvar decisões</Button><Button variante="primaria" onClick={() => publicar.mutate()} disabled={publicar.isPending}>Validar e publicar</Button></div> : null}
      </section> : null}
    </> : null}

    {consulta.data !== undefined && consulta.data.packages.length === 0 ? <p className="text-body-sm text-muted-foreground">Nenhum pacote oficial curado no catálogo.</p> : null}
    {consulta.data !== undefined && consulta.data.mappings.length > 0 ? <section aria-labelledby="plano-referencial-historico" className="grid gap-sm">
      <h4 id="plano-referencial-historico" className="text-title-md">Rascunhos e versões</h4>
      <ul className="grid gap-sm">{consulta.data.mappings.map((mapping) => <li key={mapping.id} className="flex flex-wrap items-center justify-between gap-sm rounded-md border border-border p-md">
        <span className="text-body-sm">{mapping.status === 'DRAFT' ? 'Rascunho' : `Versão ${mapping.version ?? '—'}`} · {mapping.status}</span>
        <span className="font-mono text-label-sm text-muted-foreground">{mapping.canonicalSha256 === null ? `revisão ${mapping.revision}` : formatarHash(mapping.canonicalSha256)}</span>
      </li>)}</ul>
    </section> : null}
    {pacotesHistoricos.length > 0 ? <details className="rounded-md border border-border p-md">
      <summary className="cursor-pointer text-label-md">Pacotes históricos ou indisponíveis</summary>
      <ul className="mt-sm grid gap-xs">{pacotesHistoricos.map((item) => <li key={item.id} className="text-body-sm">{item.sourceDocument} · {item.revision} · {item.status}</li>)}</ul>
    </details> : null}
  </section>;
};
