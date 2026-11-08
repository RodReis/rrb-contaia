'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { z } from 'zod';

import { Select } from '@/components/ui/select';
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
});

const formatarHash = (hash: string): string => `${hash.slice(0, 12)}…${hash.slice(-8)}`;

export const PlanoReferencial = ({ empresaId }: { empresaId: string }) => {
  const [calendarYear, setCalendarYear] = useState('2025');
  const [taxRegime, setTaxRegime] = useState<'LUCRO_PRESUMIDO' | 'SIMPLES_NACIONAL'>('LUCRO_PRESUMIDO');
  const consulta = useQuery({
    queryKey: ['plano-referencial', empresaId, calendarYear, taxRegime],
    queryFn: async () => {
      const params = new URLSearchParams({ calendarYear, taxRegime });
      return ConsultaSchema.parse(await ler(`/empresas/${empresaId}/plano-referencial?${params.toString()}`));
    },
  });
  const pacote = consulta.data?.packages.find((item) => item.id === consulta.data?.selectedPackageId);
  const pacotesHistoricos = consulta.data?.packages.filter((item) => item.status !== 'AVAILABLE') ?? [];

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
      <div role="status" className="rounded-md border border-border bg-muted/30 p-md text-body-sm">Pacote disponível. A edição de mapeamentos ainda não está habilitada.</div>
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
