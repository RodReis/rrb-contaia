"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { FileDown, Plus, Save, Send } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Campo } from "@/components/ui/campo";
import { Skeleton } from "@/components/ui/estados";
import { concede } from "../cofre/permissoes";
import { listarEmpresas } from "../empresa/api";
import { useSessao } from "../usuarios/queries";
import {
  consultarDre,
  criarRascunhoDre,
  exportarDre,
  listarContasDre,
  listarVersoesDre,
  publicarEstruturaDre,
  salvarEstruturaDre,
  type LinhaDre,
} from "./api";

const INPUT =
  "h-11 w-full min-w-0 rounded-md border border-input bg-background px-md text-body-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const atual = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
};
const dinheiro = (cents: number | null) =>
  cents === null
    ? "N/D"
    : new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: "BRL",
      }).format(cents / 100);
const taxa = (value: number | "NOT_APPLICABLE" | "NOT_AVAILABLE") =>
  value === "NOT_APPLICABLE"
    ? "N/A — denominador zero ou incompatível"
    : value === "NOT_AVAILABLE"
      ? "N/D — comparação indisponível"
      : `${(value / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
const mensagens: Record<string, string> = {
  STATEMENT_STRUCTURE_EMPTY: "Inclua ao menos uma linha.",
  STATEMENT_LINE_ORDER_INVALID: "A ordem das linhas precisa ser sequencial.",
  STATEMENT_LINE_TREE_INVALID: "Revise a hierarquia das linhas.",
  STATEMENT_ACCOUNT_UNMAPPED: "Há conta de resultado sem vínculo.",
  STATEMENT_ACCOUNT_ALREADY_MAPPED: "Uma conta está vinculada mais de uma vez.",
  STATEMENT_VERTICAL_BASIS_INVALID:
    "Marque exatamente uma base para a análise vertical.",
  STATEMENT_SUBTOTAL_INVALID: "Revise as fórmulas dos subtotais.",
  STATEMENT_ACCOUNT_NOT_ELIGIBLE:
    "Vínculo inclui conta sem classe de resultado válida.",
};
const linhaNova = (order: number): LinhaDre => ({
  code: `L${String(order).padStart(2, "0")}`,
  title: "Nova linha de resultado",
  type: "DETAIL",
  order,
  level: 0,
  parentCode: null,
  presentationSign: 1,
  accountIds: [],
  components: [],
  verticalBasis: false,
});

export const DreGerencialGlobal = () => {
  const params = useSearchParams();
  const { data: session } = useSessao();
  const search = params.get("empresaBusca") ?? "";
  const companies = useQuery({
    queryKey: ["dre-companies", search],
    queryFn: () =>
      listarEmpresas({
        busca: search,
        status: null,
        limite: 100,
        deslocamento: 0,
      }),
    enabled:
      session !== undefined &&
      concede(session, "contabil.dre_gerencial.consultar"),
  });
  const companyId = params.get("empresaId") ?? "";
  const company = companies.data?.empresas.find(
    (item) => item.id === companyId,
  );
  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    window.history.replaceState(null, "", `?${next.toString()}`);
  };
  return (
    <div className="flex min-w-0 flex-col gap-lg">
      <section className="grid max-w-3xl gap-md tablet:grid-cols-2 rounded-lg border border-border bg-card p-md">
        <Campo
          rotulo="Buscar empresa da carteira"
          value={search}
          maxLength={160}
          onValorChange={(value) => update("empresaBusca", value)}
          placeholder="Nome ou CNPJ"
        />
        <label className="grid gap-xs text-label-md">
          Empresa
          <select
            className={INPUT}
            value={companyId}
            onChange={(event) => update("empresaId", event.target.value)}
            disabled={companies.isPending}
          >
            <option value="">Selecione uma empresa</option>
            {companies.data?.empresas.map((item) => (
              <option key={item.id} value={item.id}>
                {item.nomeFantasia ?? item.razaoSocial ?? "Empresa sem nome"}
              </option>
            ))}
          </select>
        </label>
      </section>
      {company ? (
        <DreGerencial
          empresaId={company.id}
          nomeEmpresa={company.nomeFantasia ?? company.razaoSocial ?? "Empresa"}
        />
      ) : (
        <p className="rounded-lg border border-border bg-card p-lg text-body-sm text-muted-foreground">
          Selecione uma empresa autorizada pela carteira para consultar a DRE.
        </p>
      )}
    </div>
  );
};

export const DreGerencial = ({
  empresaId,
  nomeEmpresa,
}: {
  empresaId: string;
  nomeEmpresa: string;
}) => {
  const params = useSearchParams();
  const { data: session } = useSessao();
  const cache = useQueryClient();
  const month = params.get("competence") ?? atual();
  const periodMode =
    params.get("periodMode") === "YEAR_TO_DATE" ? "YEAR_TO_DATE" : "MONTH";
  const viewMode =
    params.get("viewMode") === "ANALYTIC" ? "ANALYTIC" : "SYNTHETIC";
  const [editing, setEditing] = useState(false);
  const [draftId, setDraftId] = useState("");
  const [revision, setRevision] = useState(0);
  const [effectiveFrom, setEffectiveFrom] = useState(month);
  const [lines, setLines] = useState<LinhaDre[]>([]);
  const [validationErrors, setValidationErrors] = useState<readonly string[]>(
    [],
  );
  const canRead =
    session !== undefined &&
    concede(session, "contabil.dre_gerencial.consultar");
  const canDownload =
    session !== undefined && concede(session, "contabil.dre_gerencial.baixar");
  const canEdit =
    session !== undefined && concede(session, "contabil.dre_gerencial.editar");
  const canPublish =
    session !== undefined &&
    concede(session, "contabil.dre_gerencial.publicar");
  const report = useQuery({
    queryKey: ["dre-report", empresaId, month, periodMode, viewMode],
    queryFn: () => consultarDre(empresaId, month, periodMode, viewMode),
    enabled: Boolean(empresaId && canRead),
  });
  const versions = useQuery({
    queryKey: ["dre-versions", empresaId],
    queryFn: () => listarVersoesDre(empresaId),
    enabled: Boolean(empresaId && canEdit),
  });
  const accounts = useQuery({
    queryKey: ["dre-accounts", empresaId],
    queryFn: () => listarContasDre(empresaId),
    enabled: Boolean(empresaId && canEdit),
  });
  const invalidate = () => {
    void cache.invalidateQueries({ queryKey: ["dre-report", empresaId] });
    void cache.invalidateQueries({ queryKey: ["dre-versions", empresaId] });
  };
  const create = useMutation({
    mutationFn: (fromVersion?: number) =>
      criarRascunhoDre(empresaId, fromVersion),
    onSuccess: (value) => {
      setDraftId(value.version.id);
      setRevision(value.version.revision);
      setLines([...value.lines]);
      setValidationErrors(value.validation?.errors ?? []);
      setEditing(true);
      toast.success("Rascunho da estrutura criado.");
      invalidate();
    },
    onError: () => toast.error("Não foi possível criar o rascunho."),
  });
  const save = useMutation({
    mutationFn: () => salvarEstruturaDre(empresaId, draftId, revision, lines),
    onSuccess: (value) => {
      setRevision(value.version.revision);
      setLines([...value.lines]);
      setValidationErrors(value.validation?.errors ?? []);
      toast.success("Estrutura salva.");
      invalidate();
    },
    onError: () =>
      toast.error(
        "Estrutura não salva. Verifique a revisão e tente novamente.",
      ),
  });
  const publish = useMutation({
    mutationFn: () =>
      publicarEstruturaDre(empresaId, draftId, revision, effectiveFrom),
    onSuccess: () => {
      toast.success("Estrutura publicada para a vigência informada.");
      setEditing(false);
      invalidate();
    },
    onError: () =>
      toast.error("Publicação recusada. Revise as pendências e a vigência."),
  });
  const download = useMutation({
    mutationFn: (format: "PDF" | "CSV") =>
      exportarDre(empresaId, month, periodMode, format),
    onSuccess: () => toast.success("Exportação concluída."),
    onError: () =>
      toast.error(
        "Exportação indisponível. Confira a cobertura e tente de novo.",
      ),
  });
  const setFilter = (
    key: "competence" | "periodMode" | "viewMode",
    value: string,
  ) => {
    const next = new URLSearchParams(params.toString());
    next.set(key, value);
    window.history.replaceState(null, "", `?${next.toString()}`);
  };
  const changeLine = (index: number, patch: Partial<LinhaDre>) => {
    setValidationErrors([]);
    setLines((current) =>
      current.map((line, i) => (i === index ? { ...line, ...patch } : line)),
    );
  };
  const changeComponents = (index: number, codes: readonly string[]) =>
    changeLine(index, {
      components: codes.map((code) => ({
        code,
        operator:
          lines[index]?.components.find((item) => item.code === code)
            ?.operator ?? "ADD",
      })),
    });
  const result = report.data;
  if (!session)
    return (
      <div className="flex flex-col gap-sm" aria-busy="true">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  if (!canRead)
    return (
      <section
        className="rounded-lg border border-border bg-card p-lg"
        role="status"
      >
        <h2 className="text-title-md">Permissão insuficiente</h2>
        <p className="mt-sm text-body-sm text-muted-foreground">
          Seu perfil não pode consultar a DRE desta empresa.
        </p>
      </section>
    );
  return (
    <div className="flex min-w-0 flex-col gap-lg">
      <header className="flex flex-wrap items-start justify-between gap-md">
        <div className="min-w-0">
          <p className="text-label-sm uppercase tracking-wider text-muted-foreground">
            Contabilidade · {nomeEmpresa}
          </p>
          <h1 className="mt-xs text-headline-md">DRE gerencial</h1>
          <p className="mt-xs max-w-3xl text-body-sm text-muted-foreground">
            Resultado por competência, estruturado por vínculos contábeis
            explícitos.
          </p>
        </div>
        <div className="flex flex-wrap gap-sm">
          {canEdit && (
            <Button
              variante="contorno"
              onClick={() => {
                const current = versions.data?.find(
                  (item) => item.version.status === "ACTIVE",
                );
                create.mutate(current?.version.version);
              }}
              disabled={create.isPending}
            >
              <Plus aria-hidden="true" />
              Configurar estrutura
            </Button>
          )}
        </div>
      </header>
      <section
        className="grid gap-md rounded-lg border border-border bg-card p-md tablet:grid-cols-[minmax(10rem,1fr)_minmax(12rem,1fr)_minmax(12rem,1fr)] tablet:items-end"
        aria-label="Filtros da DRE"
      >
        <Campo
          rotulo="Competência"
          type="month"
          value={month}
          onValorChange={(value) => setFilter("competence", value)}
        />
        <label className="grid min-w-0 gap-xs text-label-md">
          Período
          <select
            className={INPUT}
            value={periodMode}
            onChange={(event) => setFilter("periodMode", event.target.value)}
          >
            <option value="MONTH">Mensal</option>
            <option value="YEAR_TO_DATE">Acumulado no exercício</option>
          </select>
        </label>
        <label className="grid min-w-0 gap-xs text-label-md">
          Visão
          <select
            className={INPUT}
            value={viewMode}
            onChange={(event) => setFilter("viewMode", event.target.value)}
          >
            <option value="SYNTHETIC">Sintética</option>
            <option value="ANALYTIC">Analítica</option>
          </select>
        </label>
      </section>
      {report.isPending ? (
        <section className="flex flex-col gap-sm" aria-busy="true">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-72 w-full" />
        </section>
      ) : report.isError ? (
        <section
          className="rounded-lg border border-destructive/40 bg-card p-lg"
          role="alert"
        >
          <h2 className="text-title-md">Não foi possível calcular a DRE</h2>
          <p className="mt-sm text-body-sm text-muted-foreground">
            Verifique se há estrutura publicada e se os snapshots contábeis
            permitem reconciliação.
          </p>
          <Button
            variante="contorno"
            className="mt-md"
            onClick={() => void report.refetch()}
          >
            Tentar novamente
          </Button>
        </section>
      ) : (
        result && (
          <>
            <section className="flex flex-wrap items-center justify-between gap-md rounded-lg border border-border bg-card p-md">
              <div>
                <p className="text-label-md">
                  {result.status === "INCOMPLETE"
                    ? result.accountingPeriodStatus === "CLOSED"
                      ? "COBERTURA INCOMPLETA — FECHAMENTO"
                      : "COBERTURA INCOMPLETA — PRÉVIA"
                    : result.accountingPeriodStatus === "CLOSED"
                      ? "DEFINITIVA — COMPETÊNCIA FECHADA"
                      : "PRÉVIA — COMPETÊNCIA ABERTA"}
                </p>
                <p className="mt-xs text-body-sm text-muted-foreground">
                  Estrutura v{result.statementVersion} · vigente desde{" "}
                  {result.statementEffectiveFrom} · {result.basePeriod}
                  {periodMode === "YEAR_TO_DATE"
                    ? " · acumulado no exercício"
                    : ""}
                </p>
              </div>
              <div className="flex flex-wrap gap-sm">
                {canDownload && (
                  <>
                    <Button
                      variante="contorno"
                      disabled={
                        result.status === "INCOMPLETE" || download.isPending
                      }
                      onClick={() => download.mutate("CSV")}
                    >
                      <FileDown aria-hidden="true" />
                      CSV analítico
                    </Button>
                    <Button
                      variante="secundaria"
                      disabled={
                        result.status === "INCOMPLETE" || download.isPending
                      }
                      onClick={() => download.mutate("PDF")}
                    >
                      <FileDown aria-hidden="true" />
                      PDF executivo
                    </Button>
                  </>
                )}
              </div>
            </section>
            {result.status === "INCOMPLETE" && (
              <section
                className="rounded-lg border border-warning/50 bg-warning/5 p-md"
                aria-labelledby="dre-pending-title"
              >
                <h2 id="dre-pending-title" className="text-title-sm">
                  Cobertura incompleta · exportação bloqueada
                </h2>
                <p className="mt-xs text-body-sm text-muted-foreground">
                  Estas contas movimentadas ainda não estão vinculadas à
                  estrutura publicada.
                </p>
                <ul className="mt-sm grid gap-xs">
                  {result.unmappedAccounts.map((account) => (
                    <li
                      key={account.accountId}
                      className="flex flex-wrap justify-between gap-sm text-body-sm"
                    >
                      <span>
                        {account.code} · {account.name}
                      </span>
                      <strong className="tabular-nums">
                        {dinheiro(account.currentCents)}
                      </strong>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {result.lines.length === 0 ? (
              <p className="rounded-lg border border-border bg-card p-lg text-body-sm text-muted-foreground">
                Sem movimentos no período selecionado.
              </p>
            ) : (
              <>
                <div className="hidden overflow-x-auto rounded-lg border border-border bg-card tablet:block">
                  <table className="w-full min-w-[58rem] text-left text-body-sm">
                    <caption className="sr-only">
                      DRE gerencial com análise vertical e comparação horizontal
                    </caption>
                    <thead className="bg-muted/40 text-label-sm text-muted-foreground">
                      <tr>
                        {[
                          "Linha",
                          "Atual",
                          "Anterior",
                          "AV",
                          "AH (R$)",
                          "AH (%)",
                        ].map((column) => (
                          <th
                            key={column}
                            scope="col"
                            className="whitespace-nowrap px-md py-sm text-right first:text-left"
                          >
                            {column}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {result.lines.map((line) => (
                        <tr key={line.code} className="border-t border-border">
                          <th
                            scope="row"
                            className="min-w-[18rem] px-md py-sm font-medium"
                          >
                            <span
                              style={{
                                paddingInlineStart: `${Math.min(line.level, 5) * 1.25}rem`,
                              }}
                            >
                              {line.code} · {line.title}
                            </span>
                            {viewMode === "ANALYTIC" &&
                              line.type === "DETAIL" &&
                              line.accounts.length > 0 && (
                                <details className="mt-xs text-label-sm text-muted-foreground">
                                  <summary className="cursor-pointer">
                                    Ver {line.accounts.length} contas
                                  </summary>
                                  <ul className="mt-xs flex flex-col gap-1">
                                    {line.accounts.map((account) => (
                                      <li
                                        key={account.code}
                                        className="flex justify-between gap-md"
                                      >
                                        <span>
                                          {account.code} · {account.name}
                                        </span>
                                        <span className="tabular-nums">
                                          {dinheiro(account.currentCents)}
                                        </span>
                                      </li>
                                    ))}
                                  </ul>
                                </details>
                              )}
                          </th>
                          <td className="whitespace-nowrap px-md py-sm text-right tabular-nums">
                            {dinheiro(line.currentCents)}
                          </td>
                          <td className="whitespace-nowrap px-md py-sm text-right tabular-nums">
                            {dinheiro(line.previousCents)}
                          </td>
                          <td
                            className="min-w-[10rem] px-md py-sm text-right tabular-nums"
                            aria-label={`Análise vertical: ${taxa(line.verticalBasisPoints)}`}
                          >
                            {taxa(line.verticalBasisPoints)}
                          </td>
                          <td className="whitespace-nowrap px-md py-sm text-right tabular-nums">
                            {dinheiro(line.horizontalCents)}
                          </td>
                          <td
                            className="min-w-[12rem] px-md py-sm text-right tabular-nums"
                            aria-label={`Análise horizontal: ${taxa(line.horizontalBasisPoints)}`}
                          >
                            {taxa(line.horizontalBasisPoints)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="border-t-2 border-border bg-muted/30 font-semibold">
                      <tr>
                        <th scope="row" className="px-md py-sm">
                          Hash da consulta
                        </th>
                        <td
                          colSpan={5}
                          className="break-all px-md py-sm font-mono text-label-sm"
                        >
                          {result.hash}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                <div
                  className="flex flex-col gap-sm tablet:hidden"
                  aria-label="DRE em cards empilhados"
                >
                  {result.lines.map((line) => (
                    <article
                      key={`mobile-${line.code}`}
                      className="rounded-lg border border-border bg-card p-md"
                    >
                      <h3
                        className="font-semibold"
                        style={{
                          paddingInlineStart: `${Math.min(line.level, 5) * 1.25}rem`,
                        }}
                      >
                        {line.code} · {line.title}
                      </h3>
                      {viewMode === "ANALYTIC" && line.accounts.length > 0 && (
                        <details className="mt-sm border-b border-border pb-sm text-label-sm text-muted-foreground">
                          <summary className="cursor-pointer">
                            Ver {line.accounts.length} contas
                          </summary>
                          <ul className="mt-xs grid gap-xs">
                            {line.accounts.map((account) => (
                              <li
                                key={account.code}
                                className="flex justify-between gap-sm"
                              >
                                <span>
                                  {account.code} · {account.name}
                                </span>
                                <span className="tabular-nums">
                                  {dinheiro(account.currentCents)}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                      <dl className="mt-sm grid grid-cols-[minmax(0,1fr)_auto] gap-x-md gap-y-xs text-body-sm">
                        <dt>Atual</dt>
                        <dd className="text-right tabular-nums">
                          {dinheiro(line.currentCents)}
                        </dd>
                        <dt>Anterior</dt>
                        <dd className="text-right tabular-nums">
                          {dinheiro(line.previousCents)}
                        </dd>
                        <dt>AV</dt>
                        <dd className="text-right tabular-nums">
                          {taxa(line.verticalBasisPoints)}
                        </dd>
                        <dt>AH (R$)</dt>
                        <dd className="text-right tabular-nums">
                          {dinheiro(line.horizontalCents)}
                        </dd>
                        <dt>AH (%)</dt>
                        <dd className="text-right tabular-nums">
                          {taxa(line.horizontalBasisPoints)}
                        </dd>
                      </dl>
                    </article>
                  ))}
                  <p className="break-all rounded-lg border border-border bg-card p-md font-mono text-label-sm">
                    Hash da consulta: {result.hash}
                  </p>
                </div>
              </>
            )}
          </>
        )
      )}
      {editing && (
        <section
          className="flex flex-col gap-md rounded-lg border border-border bg-card p-md"
          aria-labelledby="dre-editor-title"
        >
          <div className="flex flex-wrap items-center justify-between gap-sm">
            <div>
              <h2 id="dre-editor-title" className="text-title-md">
                Rascunho da estrutura
              </h2>
              <p className="mt-xs text-body-sm text-muted-foreground">
                Versão {draftId.slice(0, 8)} · revisão {revision}. A publicação
                é independente da consulta.
              </p>
            </div>
            <Button
              variante="contorno"
              onClick={() => {
                setValidationErrors([]);
                setLines((current) => [
                  ...current,
                  linhaNova(current.length + 1),
                ]);
              }}
            >
              Adicionar linha
            </Button>
          </div>
          {lines.map((line, index) => (
            <article
              key={`${line.code}-${index}`}
              className="grid min-w-0 gap-md rounded-md border border-border p-md tablet:grid-cols-2"
            >
              <Campo
                rotulo="Código"
                value={line.code}
                maxLength={40}
                onValorChange={(value) => changeLine(index, { code: value })}
              />
              <Campo
                rotulo="Título"
                value={line.title}
                maxLength={160}
                onValorChange={(value) => changeLine(index, { title: value })}
              />
              <label className="grid gap-xs text-label-md">
                Tipo
                <select
                  className={INPUT}
                  value={line.type}
                  onChange={(event) =>
                    changeLine(index, {
                      type: event.target.value as LinhaDre["type"],
                      accountIds:
                        event.target.value === "SUBTOTAL"
                          ? []
                          : line.accountIds,
                      components:
                        event.target.value === "DETAIL" ? [] : line.components,
                    })
                  }
                >
                  <option value="DETAIL">Linha-base</option>
                  <option value="SUBTOTAL">Subtotal</option>
                </select>
              </label>
              {line.type === "DETAIL" ? (
                <label className="grid gap-xs text-label-md">
                  Contas analíticas
                  <select
                    className={`${INPUT} min-h-28`}
                    multiple
                    value={[...line.accountIds]}
                    onChange={(event) =>
                      changeLine(index, {
                        accountIds: [
                          ...event.currentTarget.selectedOptions,
                        ].map((option) => option.value),
                      })
                    }
                  >
                    {accounts.data?.items.map((account) => (
                      <option key={account.accountId} value={account.accountId}>
                        {account.code} · {account.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <div className="grid gap-xs">
                  <label className="grid gap-xs text-label-md">
                    Composição
                    <select
                      className={`${INPUT} min-h-28`}
                      multiple
                      value={line.components.map((item) => item.code)}
                      onChange={(event) =>
                        changeComponents(
                          index,
                          [...event.currentTarget.selectedOptions].map(
                            (option) => option.value,
                          ),
                        )
                      }
                    >
                      {lines.slice(0, index).map((source) => (
                        <option key={source.code} value={source.code}>
                          {source.code} · {source.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  {line.components.map((component) => (
                    <label
                      key={component.code}
                      className="flex min-h-11 items-center gap-sm text-body-sm"
                    >
                      <input
                        type="checkbox"
                        checked={component.operator === "SUBTRACT"}
                        onChange={(event) =>
                          changeLine(index, {
                            components: line.components.map((item) =>
                              item.code === component.code
                                ? {
                                    ...item,
                                    operator: event.target.checked
                                      ? "SUBTRACT"
                                      : "ADD",
                                  }
                                : item,
                            ),
                          })
                        }
                        className="size-4 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                      Subtrair {component.code}
                    </label>
                  ))}
                </div>
              )}
              <label className="flex min-h-11 items-center gap-sm text-body-sm">
                <input
                  type="checkbox"
                  checked={line.verticalBasis}
                  onChange={(event) =>
                    changeLine(index, { verticalBasis: event.target.checked })
                  }
                  className="size-4 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                Base da análise vertical
              </label>
              {line.type === "DETAIL" && (
                <label className="grid gap-xs text-label-md">
                  Sinal de apresentação
                  <select
                    className={INPUT}
                    value={line.presentationSign}
                    onChange={(event) =>
                      changeLine(index, {
                        presentationSign: Number(event.target.value) as 1 | -1,
                      })
                    }
                  >
                    <option value="1">Mantém sinal</option>
                    <option value="-1">Inverte sinal</option>
                  </select>
                </label>
              )}
              <div className="flex items-center">
                <Button
                  variante="fantasma"
                  tamanho="compacto"
                  disabled={lines.length <= 1}
                  onClick={() => {
                    setValidationErrors([]);
                    setLines((current) =>
                      current
                        .filter((_, i) => i !== index)
                        .map((item, i) => ({ ...item, order: i + 1 })),
                    );
                  }}
                >
                  Remover linha
                </Button>
              </div>
            </article>
          ))}
          {validationErrors.length > 0 && (
            <ul
              role="alert"
              className="rounded-md border border-destructive/40 p-md text-body-sm"
            >
              {[...new Set(validationErrors)].map((code) => (
                <li key={code}>{mensagens[code] ?? code}</li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-end gap-sm">
            <Campo
              rotulo="Vigência inicial"
              type="month"
              value={effectiveFrom}
              onValorChange={setEffectiveFrom}
            />
            <Button
              variante="contorno"
              disabled={save.isPending}
              onClick={() => save.mutate()}
            >
              <Save aria-hidden="true" />
              Salvar rascunho
            </Button>
            {canPublish && (
              <Button
                disabled={publish.isPending}
                onClick={() => publish.mutate()}
              >
                <Send aria-hidden="true" />
                Validar e publicar
              </Button>
            )}
            <Button variante="fantasma" onClick={() => setEditing(false)}>
              Fechar editor
            </Button>
          </div>
        </section>
      )}
      {canEdit && (
        <details className="rounded-lg border border-border bg-card p-md">
          <summary className="cursor-pointer text-label-md">
            Versões da estrutura
          </summary>
          <div className="mt-md flex flex-col gap-sm">
            {versions.data?.map((item) => (
              <article
                key={item.version.id}
                className="flex flex-wrap items-center justify-between gap-sm border-t border-border pt-sm text-body-sm"
              >
                <span>
                  v{item.version.version} · {item.version.status} · revisão{" "}
                  {item.version.revision}
                  {item.version.effectiveFrom
                    ? ` · ${item.version.effectiveFrom} a ${item.version.effectiveTo ?? "atual"}`
                    : ""}
                </span>
                {item.version.status === "DRAFT" && (
                  <Button
                    tamanho="compacto"
                    variante="contorno"
                    onClick={() => {
                      setDraftId(item.version.id);
                      setRevision(item.version.revision);
                      setLines([...item.lines]);
                      setEffectiveFrom(month);
                      setEditing(true);
                    }}
                  >
                    Editar rascunho
                  </Button>
                )}
              </article>
            ))}
          </div>
        </details>
      )}
    </div>
  );
};
