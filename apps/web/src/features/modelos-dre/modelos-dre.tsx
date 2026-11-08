"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArrowRight, Check, ChevronRight, Copy, FilePlus2, History, Layers3, Plus, RotateCcw, Save, ShieldAlert, Sparkles, Trash2, WandSparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ConfirmacaoDeAcao } from "@/components/ui/confirmacao-de-acao";
import { Button } from "@/components/ui/button";
import { Campo } from "@/components/ui/campo";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/estados";
import { cn } from "@/lib/cn";
import { ErroDaApi } from "@/lib/http";
import { concede } from "../cofre/permissoes";
import { listarEmpresas } from "../empresa/api";
import { listarVersoesDre } from "../dre-gerencial/api";
import { CodigoDeSuporte } from "../importacao/pecas";
import { useSessao } from "../usuarios/queries";
import {
  aplicarModelo, arquivarModelo, criarModelo, criarModeloDaEmpresa, criarVersaoModelo,
  consultarProvenienciaModelo, descartarRascunhoModelo, listarModelos, listarVersoesModelo, obterVersaoModelo, publicarModelo, reativarModelo,
  renomearModelo, salvarLinhasModelo,
  type LinhaModelo, type VersaoModelo,
} from "./api";

const linhaInicial = (order: number, type: "DETAIL" | "SUBTOTAL" = "DETAIL"): LinhaModelo => ({
  code: `L${String(order).padStart(2, "0")}`, title: type === "DETAIL" ? "Nova linha de resultado" : "Novo subtotal", type,
  order, level: 0, parentCode: null, presentationSign: 1, components: [], verticalBasis: false,
});
const dataAtualizacao = (value: string) => new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo",
}).format(new Date(value));
const IdDaFalha = ({ erro }: { erro: unknown }) => erro instanceof ErroDaApi
  ? <CodigoDeSuporte valor={erro.problema.correlationId} className="text-body-sm"/>
  : null;

export const ModelosDre = () => {
  const router = useRouter();
  const client = useQueryClient();
  const { data: session } = useSessao();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ACTIVE" | "ARCHIVED" | "">("ACTIVE");
  const [selectedId, setSelectedId] = useState("");
  const [selectedVersion, setSelectedVersion] = useState(0);
  const [lines, setLines] = useState<LinhaModelo[]>([]);
  const [revision, setRevision] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [formOpen, setFormOpen] = useState<"MANUAL" | "COMPANY" | "EDIT" | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [sourceCompanyId, setSourceCompanyId] = useState("");
  const [sourceVersionId, setSourceVersionId] = useState("");
  const [targetCompanyId, setTargetCompanyId] = useState("");
  const statusFilters: readonly Readonly<{ value: "ACTIVE" | "ARCHIVED" | ""; label: string }>[] = [
    { value: "ACTIVE", label: "Ativos" },
    { value: "ARCHIVED", label: "Arquivados" },
    { value: "", label: "Todos" },
  ];
  const canRead = session !== undefined && concede(session, "contabil.dre_gerencial.consultar");
  const canEdit = session !== undefined && concede(session, "contabil.dre_gerencial.editar");
  const canPublish = session !== undefined && concede(session, "contabil.dre_gerencial.publicar");

  const models = useQuery({ queryKey: ["statement-templates", search, statusFilter], queryFn: () => listarModelos(search, statusFilter), enabled: canRead, placeholderData: (old) => old });
  const selected = models.data?.items.find((item) => item.id === selectedId);
  const versions = useQuery({ queryKey: ["statement-template-versions", selectedId], queryFn: () => listarVersoesModelo(selectedId), enabled: Boolean(selectedId && canRead) });
  const detail = useQuery({ queryKey: ["statement-template-version", selectedId, selectedVersion], queryFn: () => obterVersaoModelo(selectedId, selectedVersion), enabled: Boolean(selectedId && selectedVersion && canRead) });
  const provenance = useQuery({ queryKey: ["statement-template-provenance", selectedId, selectedVersion], queryFn: () => consultarProvenienciaModelo(selectedId, selectedVersion), enabled: Boolean(selectedId && selectedVersion && canRead) });
  const companies = useQuery({ queryKey: ["template-companies"], queryFn: () => listarEmpresas({ busca: "", status: null, limite: 100, deslocamento: 0 }), enabled: Boolean(canEdit && (formOpen === "COMPANY" || selectedId)) });
  const sourceVersions = useQuery({ queryKey: ["template-source-versions", sourceCompanyId], queryFn: () => listarVersoesDre(sourceCompanyId), enabled: Boolean(sourceCompanyId && formOpen === "COMPANY") });
  const targetVersions = useQuery({ queryKey: ["template-target-versions", targetCompanyId], queryFn: () => listarVersoesDre(targetCompanyId), enabled: Boolean(targetCompanyId && selected && selected.activeVersion) });
  const targetActiveRevision = targetVersions.data?.[0]?.version.revision ?? 0;
  const activeVersion = versions.data?.items.find((item) => item.status === "ACTIVE");
  const selectedVersionMeta = versions.data?.items.find((item) => item.version === selectedVersion);
  const sourceOptions = useMemo(() => (companies.data?.empresas ?? []).map((company) => ({ valor: company.id, rotulo: company.nomeFantasia ?? company.razaoSocial ?? "Empresa sem nome" })), [companies.data]);
  const availableComponents = useMemo(() => lines.filter((line) => line.order < (lines.at(-1)?.order ?? 0)), [lines]);

  /* eslint-disable react-hooks/set-state-in-effect -- Hidrata o editor uma vez a partir da versão consultada; dirty preserva as edições locais depois disso. */
  useEffect(() => {
    if (!detail.data || dirty) return;
    setLines(detail.data.lines.map((line) => ({ ...line, components: line.components.map((component) => ({ ...component })) })));
    setRevision(detail.data.version.revision);
  }, [detail.data, dirty]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["statement-templates"] });
    void client.invalidateQueries({ queryKey: ["statement-template-versions", selectedId] });
    void client.invalidateQueries({ queryKey: ["statement-template-version", selectedId] });
    void client.invalidateQueries({ queryKey: ["statement-template-provenance", selectedId] });
  };
  const createManual = useMutation({ mutationFn: () => criarModelo({ name, description }), onSuccess: (value) => { setSelectedId(value.templateId); setSelectedVersion(value.version); setFormOpen(null); setName(""); setDescription(""); toast.success("Modelo criado como rascunho."); refresh(); }, onError: () => toast.error("Não foi possível criar o modelo.") });
  const cloneCompany = useMutation({ mutationFn: () => criarModeloDaEmpresa({ name, description, companyId: sourceCompanyId, sourceVersionId }), onSuccess: (value) => { setSelectedId(value.templateId); setSelectedVersion(value.version); setFormOpen(null); setName(""); setDescription(""); setSourceVersionId(""); toast.success("Estrutura copiada sem contas ou dados financeiros."); refresh(); }, onError: () => toast.error("Não foi possível criar modelo a partir desta DRE.") });
  const updateModel = useMutation({ mutationFn: () => renomearModelo(selectedId, { name, description }), onSuccess: () => { setFormOpen(null); toast.success("Dados do modelo atualizados."); refresh(); }, onError: () => toast.error("Não foi possível atualizar modelo.") });
  const save = useMutation({ mutationFn: () => salvarLinhasModelo(selectedId, selectedVersion, revision, lines), onSuccess: (value) => { setRevision(value.version.revision); setDirty(false); toast.success("Rascunho salvo."); refresh(); }, onError: () => toast.error("Rascunho não salvo. Atualize a revisão e tente novamente.") });
  const publish = useMutation({ mutationFn: () => publicarModelo(selectedId, selectedVersion, revision), onSuccess: () => { setDirty(false); toast.success("Nova versão publicada e congelada."); refresh(); }, onError: () => toast.error("Publicação recusada. Revise a estrutura ou carregue a revisão atual.") });
  const discardDraft = useMutation({ mutationFn: () => descartarRascunhoModelo(selectedId, selectedVersion), onSuccess: () => { setDirty(false); toast.success("Rascunho descartado; histórico preservado."); refresh(); }, onError: () => toast.error("Não foi possível descartar este rascunho.") });
  const newVersion = useMutation({ mutationFn: () => criarVersaoModelo(selectedId), onSuccess: (value) => { setDirty(false); setSelectedVersion(value.version); toast.success("Novo rascunho criado a partir da versão publicada."); refresh(); }, onError: () => toast.error("Não foi possível criar nova versão.") });
  const apply = useMutation({ mutationFn: () => aplicarModelo(selectedId, selected?.activeVersion ?? 0, targetCompanyId, targetActiveRevision), onSuccess: (result) => { toast.success(result.created ? "Novo rascunho empresarial criado." : "Aplicação repetida; rascunho existente recuperado."); router.push(`/contabil/dre?empresaId=${encodeURIComponent(targetCompanyId)}&rascunhoId=${encodeURIComponent(result.companyStatementDraftId)}`); }, onError: () => toast.error("Aplicação recusada. Confira carteira e versão da empresa.") });
  const archive = useMutation({ mutationFn: () => arquivarModelo(selectedId), onSuccess: () => { toast.success("Modelo arquivado. Versões e aplicações preservadas."); refresh(); }, onError: () => toast.error("Não foi possível arquivar modelo.") });
  const reactivate = useMutation({ mutationFn: () => reativarModelo(selectedId), onSuccess: () => { toast.success("Modelo reativado."); refresh(); }, onError: () => toast.error("Não foi possível reativar modelo.") });

  const chooseVersion = (version: VersaoModelo) => { if (dirty) { toast.error("Salve ou descarte o rascunho antes de trocar de versão."); return; } setSelectedVersion(version.version); };
  const selectModel = (id: string, version: number) => { if (dirty) { toast.error("Salve ou descarte o rascunho antes de trocar de modelo."); return; } setSelectedId(id); setSelectedVersion(version); };
  const changeLine = (index: number, patch: Partial<LinhaModelo>) => { const nextCode = patch.code; setDirty(true); setLines((current) => current.map((line, i) => {
    if (i === index) return { ...line, ...patch };
    if (nextCode === undefined) return line;
    return { ...line, parentCode: line.parentCode === current[index]?.code ? nextCode : line.parentCode, components: line.components.map((component) => component.code === current[index]?.code ? { ...component, code: nextCode } : component) };
  })); };
  const addLine = (type: "DETAIL" | "SUBTOTAL") => { setDirty(true); setLines((current) => [...current, linhaInicial(current.length + 1, type)]); };
  const removeLine = (index: number) => {
    setDirty(true);
    const removed = lines[index];
    setLines((current) => current.filter((_, i) => i !== index).map((line, i) => ({
      ...line,
      order: i + 1,
      ...(removed && line.parentCode === removed.code ? { parentCode: null, level: 0 } : {}),
      components: line.components.filter((component) => component.code !== removed?.code),
    })));
  };
  const setComponent = (lineIndex: number, code: string, operator: "ADD" | "SUBTRACT") => {
    const current = lines[lineIndex]?.components ?? [];
    const found = current.some((component) => component.code === code);
    changeLine(lineIndex, { components: found ? current.map((component) => component.code === code ? { code, operator } : component) : [...current, { code, operator }] });
  };

  if (!session) return <div className="flex flex-col gap-md" aria-busy="true"><Skeleton className="h-12 w-2/3"/><Skeleton className="h-80 w-full"/></div>;
  if (!canRead) return <section className="rounded-lg border border-border bg-card p-lg" role="status"><h1 className="text-headline-sm">Permissão insuficiente</h1><p className="mt-sm text-body-sm text-muted-foreground">Seu perfil não pode consultar os modelos de DRE do escritório.</p></section>;

  return <div className="flex min-w-0 flex-col gap-lg">
    <header className="flex flex-wrap items-end justify-between gap-md border-b border-border pb-lg">
      <div className="max-w-[48rem]"><p className="flex items-center gap-xs text-label-sm text-muted-foreground"><Layers3 size={15} aria-hidden="true"/>Biblioteca do escritório</p><h1 className="mt-xs text-headline-lg">Modelos de DRE</h1><p className="mt-sm text-body-md text-muted-foreground">Estruturas publicadas ficam congeladas. Cada aplicação cria um novo rascunho independente por empresa.</p></div>
      {canEdit && <div className="flex flex-wrap gap-sm"><Button variante="contorno" onClick={() => setFormOpen(formOpen === "COMPANY" ? null : "COMPANY")}><Copy aria-hidden="true"/>A partir de empresa</Button><Button onClick={() => setFormOpen(formOpen === "MANUAL" ? null : "MANUAL")}><Plus aria-hidden="true"/>Novo modelo</Button></div>}
    </header>

    {formOpen && <section className="grid gap-md rounded-lg border border-border bg-card p-md tablet:grid-cols-2" aria-label={formOpen === "EDIT" ? "Editar dados do modelo" : formOpen === "MANUAL" ? "Novo modelo manual" : "Novo modelo a partir de empresa"}>
      <Campo rotulo="Nome do modelo" obrigatorio maxLength={120} value={name} onValorChange={setName} placeholder="Ex.: DRE comércio de autopeças"/>
      <Campo rotulo="Descrição" maxLength={500} value={description} onValorChange={setDescription} placeholder="Uso previsto para este modelo"/>
      {formOpen === "COMPANY" && <div className="grid gap-md tablet:col-span-2 tablet:grid-cols-2">
        <Select rotulo="Empresa de origem" opcoes={sourceOptions} valor={sourceCompanyId || undefined} onValorChange={(value) => { setSourceCompanyId(value); setSourceVersionId(""); }} placeholder="Selecione empresa da carteira"/>
        <Select rotulo="Versão publicada de origem" opcoes={(sourceVersions.data ?? []).filter((item) => item.version.status !== "DRAFT").map((item) => ({ valor: item.version.id, rotulo: `Versão ${item.version.version} · ${item.version.status === "ACTIVE" ? "Ativa" : "Superada"}` }))} valor={sourceVersionId || undefined} onValorChange={setSourceVersionId} disabled={!sourceVersions.data?.length} placeholder="Nenhuma versão elegível" ajuda="Somente a estrutura visual é copiada. Contas, valores e dados da empresa ficam de fora."/>
      </div>}
      <div className="flex justify-end gap-sm tablet:col-span-2"><Button variante="contorno" onClick={() => setFormOpen(null)}>Cancelar</Button><Button disabled={!name.trim() || (formOpen === "COMPANY" && (!sourceVersionId || !sourceVersions.data?.some((item) => item.version.id === sourceVersionId && item.version.status !== "DRAFT"))) || createManual.isPending || cloneCompany.isPending || updateModel.isPending} onClick={() => formOpen === "MANUAL" ? createManual.mutate() : formOpen === "EDIT" ? updateModel.mutate() : cloneCompany.mutate()}>{formOpen === "EDIT" ? <Save aria-hidden="true"/> : formOpen === "MANUAL" ? <FilePlus2 aria-hidden="true"/> : <Copy aria-hidden="true"/>}{formOpen === "EDIT" ? "Salvar alterações" : "Criar rascunho"}</Button></div>
    </section>}

    <div className="grid min-w-0 gap-lg xl:grid-cols-[minmax(17rem,0.8fr)_minmax(0,2fr)]">
      <aside className="min-w-0 border-y border-border bg-card/40">
        <div className="grid gap-sm border-b border-border p-md">
          <Campo rotulo="Buscar modelo" value={search} onValorChange={setSearch} placeholder="Nome do modelo" className="h-10"/>
          <div className="flex gap-xs" aria-label="Filtrar modelos">
            {statusFilters.map((item) => <button key={item.value || "ALL"} type="button" aria-pressed={statusFilter === item.value} onClick={() => setStatusFilter(item.value)} className={cn("rounded-md px-sm py-xs text-label-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", statusFilter === item.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground")}>{item.label}</button>)}
          </div>
        </div>
        {models.isPending ? <div className="space-y-sm p-md"><Skeleton className="h-16"/><Skeleton className="h-16"/><Skeleton className="h-16"/></div> : models.isError ? <div className="grid gap-sm p-md text-danger-foreground" role="alert"><p className="text-body-sm">Biblioteca indisponível. Atualize para tentar novamente.</p><IdDaFalha erro={models.error}/></div> : models.data.items.length === 0 ? <div className="p-lg"><p className="text-title-sm">Nenhum modelo encontrado</p><p className="mt-xs text-body-sm text-muted-foreground">Crie um modelo vazio ou copie a estrutura de uma DRE acessível.</p></div> : <ul className="divide-y divide-border">
          {models.data.items.map((item) => <li key={item.id}><button type="button" onClick={() => selectModel(item.id, item.activeVersion ?? 1)} aria-current={selectedId === item.id ? "true" : undefined} className={cn("group flex w-full items-start justify-between gap-sm px-md py-md text-left transition-colors hover:bg-accent/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring", selectedId === item.id && "bg-accent") }><span className="min-w-0"><span className="block truncate text-title-sm text-foreground">{item.name}</span><span className="mt-xs flex flex-wrap items-center gap-x-sm gap-y-xs text-label-sm text-muted-foreground"><span>{item.activeVersion ? `Versão ${item.activeVersion}` : "Sem versão publicada"}</span><span aria-hidden="true">·</span><span>{item.activeOrigin === "COMPANY_VERSION" ? "Origem empresarial" : "Origem manual"}</span><span>Atualizado em {dataAtualizacao(item.updatedAt)} · {item.updatedByName ?? "Usuário do escritório"}</span></span><span className={cn("mt-sm inline-flex rounded-sm px-xs py-[2px] text-label-sm", item.status === "ACTIVE" ? "bg-success/15 text-success-foreground" : "bg-muted text-muted-foreground")}>{item.status === "ACTIVE" ? "Ativo" : "Arquivado"}</span></span><ChevronRight size={17} className="mt-xs shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true"/></button></li>)}
        </ul>}
      </aside>

      {!selected ? <section className="flex min-h-72 w-full min-w-0 flex-col items-center justify-center border-y border-border px-lg py-2xl text-center"><div className="mb-md grid size-12 place-items-center rounded-full bg-secondary text-secondary-foreground"><Layers3 aria-hidden="true"/></div><h2 className="text-headline-sm">Escolha um modelo</h2><p className="mt-xs w-full max-w-[28rem] text-body-sm text-muted-foreground">Versões e cópias por empresa evoluem separadas. Nenhuma estrutura ou conta muda sem uma ação explícita.</p></section> : <section className="min-w-0">
        <div className="flex flex-wrap items-start justify-between gap-md border-b border-border pb-md">
          <div><div className="flex items-center gap-sm"><h2 className="text-headline-sm">{selected.name}</h2><span className={cn("rounded-sm px-xs py-[2px] text-label-sm", selected.status === "ACTIVE" ? "bg-success/15 text-success-foreground" : "bg-muted text-muted-foreground")}>{selected.status === "ACTIVE" ? "Ativo" : "Arquivado"}</span></div><p className="mt-xs max-w-2xl text-body-sm text-muted-foreground">{selected.description || "Sem descrição."} {selected.activeVersion && `Versão ativa ${selected.activeVersion} é imutável.`}</p></div>
          {canEdit && <div className="flex flex-wrap gap-xs"><Button variante="contorno" tamanho="compacto" onClick={() => { setName(selected.name); setDescription(selected.description ?? ""); setFormOpen("EDIT"); }}><Save aria-hidden="true"/>Editar dados</Button>{selected.status === "ACTIVE" ? <><Button variante="contorno" tamanho="compacto" disabled={!activeVersion || newVersion.isPending} onClick={() => newVersion.mutate()}><FilePlus2 aria-hidden="true"/>Nova versão</Button><ConfirmacaoDeAcao gatilho={<Button variante="contorno" tamanho="compacto"><Archive aria-hidden="true"/>Arquivar</Button>} titulo="Arquivar modelo?" descricao="Novas versões e aplicações serão bloqueadas. Histórico e cópias já criadas continuam preservados." rotuloDeConfirmacao="Arquivar modelo" destrutivo aoConfirmar={() => archive.mutateAsync()}/></> : <Button variante="contorno" tamanho="compacto" onClick={() => reactivate.mutate()}><RotateCcw aria-hidden="true"/>Reativar</Button>}</div>}
        </div>

        <section className="mt-md" aria-labelledby="historico-modelo">
          <div className="mb-sm flex items-center gap-xs text-label-md text-muted-foreground"><History size={15} aria-hidden="true"/><h3 id="historico-modelo">Histórico de versões</h3></div>
          <div className="flex flex-wrap gap-xs">{(versions.data?.items ?? []).map((version) => <button key={version.id} type="button" onClick={() => chooseVersion(version)} aria-pressed={selectedVersion === version.version} className={cn("rounded-md border px-sm py-xs text-label-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", selectedVersion === version.version ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground hover:bg-accent")}>v{version.version} · {version.status === "ACTIVE" ? "Publicada" : version.status === "SUPERSEDED" ? "Superada" : version.status === "DISCARDED" ? "Descartada" : "Rascunho"}</button>)}</div>
        </section>

        <section className="mt-md flex flex-wrap items-center justify-between gap-sm border-b border-border pb-md" aria-label="Proveniência do modelo">
          <p className="text-label-sm text-muted-foreground">Origem: {provenance.data?.origin.type === "MANUAL" || !provenance.data?.origin.companyId ? "criação manual" : "estrutura empresarial sanitizada"}. Aplicações registradas: {provenance.data?.applications.length ?? 0} em empresas autorizadas.</p>
          {provenance.isError && <div className="grid gap-xs text-warning-foreground" role="status"><p className="text-label-sm">Proveniência indisponível nesta carteira; dados de empresa ficam protegidos.</p><IdDaFalha erro={provenance.error}/></div>}
        </section>

        {selectedVersionMeta && <div className="mt-lg flex flex-wrap items-center justify-between gap-sm border-y border-border bg-muted/40 px-md py-sm"><p className="text-body-sm"><strong className="font-semibold">Versão {selectedVersion}</strong><span className="mx-xs text-muted-foreground">·</span>{selectedVersionMeta.status === "DRAFT" ? "Rascunho editável" : selectedVersionMeta.status === "ACTIVE" ? "Publicada e imutável" : selectedVersionMeta.status === "DISCARDED" ? "Rascunho descartado" : "Versão superada, somente leitura"}</p>{selectedVersionMeta.structuralHash && <code className="max-w-full truncate text-code-xs text-muted-foreground" title={selectedVersionMeta.structuralHash}>SHA-256 {selectedVersionMeta.structuralHash}</code>}</div>}

          {detail.isPending ? <div className="mt-md space-y-sm" aria-busy="true"><Skeleton className="h-12"/><Skeleton className="h-24"/></div> : detail.isError ? <div className="mt-md grid gap-sm text-danger-foreground" role="alert"><p className="text-body-sm">Versão indisponível. Atualize o histórico e tente novamente.</p><IdDaFalha erro={detail.error}/></div> : <>
          {selectedVersionMeta?.status === "DRAFT" && canEdit && <div className="mt-md flex flex-wrap items-center gap-sm"><Button variante="contorno" tamanho="compacto" onClick={() => addLine("DETAIL")}><Plus aria-hidden="true"/>Linha de detalhe</Button><Button variante="contorno" tamanho="compacto" onClick={() => addLine("SUBTOTAL")}><Plus aria-hidden="true"/>Subtotal</Button><span className="text-label-sm text-muted-foreground">Contas contábeis nunca fazem parte do modelo.</span></div>}
          {lines.length === 0 ? <div className="mt-md flex items-start gap-sm border border-dashed border-border px-md py-lg"><Sparkles size={18} className="mt-0.5 text-muted-foreground" aria-hidden="true"/><div><p className="text-title-sm">Rascunho vazio</p><p className="mt-xs text-body-sm text-muted-foreground">Adicione linhas de detalhe e subtotais. Marque uma linha-base para análise vertical antes de publicar.</p></div></div> : <div className="mt-md divide-y divide-border border-y border-border">
            {lines.map((line, index) => <article key={`${line.code}-${index}`} className="grid min-w-0 gap-sm py-md tablet:grid-cols-[minmax(7rem,0.7fr)_minmax(13rem,2fr)_minmax(8rem,0.8fr)]" aria-label={`Linha ${line.order}: ${line.title}`}>
              <div className="grid grid-cols-2 gap-xs tablet:grid-cols-1"><Campo rotulo="Código" aria-label={`Código da linha ${line.order}`} value={line.code} disabled={selectedVersionMeta?.status !== "DRAFT" || !canEdit} onValorChange={(value) => changeLine(index, { code: value })} className="h-9"/><Select rotulo="Tipo" opcoes={[{ valor: "DETAIL", rotulo: "Detalhe" }, { valor: "SUBTOTAL", rotulo: "Subtotal" }]} valor={line.type} onValorChange={(value) => changeLine(index, { type: value === "DETAIL" ? "DETAIL" : "SUBTOTAL", components: value === "DETAIL" ? [] : line.components })} disabled={selectedVersionMeta?.status !== "DRAFT" || !canEdit}/></div>
              <div className="grid gap-xs"><Campo rotulo="Título" maxLength={160} value={line.title} disabled={selectedVersionMeta?.status !== "DRAFT" || !canEdit} onValorChange={(value) => changeLine(index, { title: value })} className="h-9"/><div className="grid grid-cols-2 gap-xs"><Select rotulo="Linha-pai" opcoes={[{ valor: "__none", rotulo: "Sem linha-pai" }, ...lines.slice(0, index).filter((candidate) => candidate.type === "SUBTOTAL").map((candidate) => ({ valor: candidate.code, rotulo: candidate.title }))]} valor={line.parentCode ?? "__none"} onValorChange={(value) => changeLine(index, { parentCode: value === "__none" ? null : value, level: value === "__none" ? 0 : (lines.find((candidate) => candidate.code === value)?.level ?? 0) + 1 })} disabled={selectedVersionMeta?.status !== "DRAFT" || !canEdit}/><Select rotulo="Sinal de apresentação" opcoes={[{ valor: "1", rotulo: "Positivo" }, { valor: "-1", rotulo: "Negativo" }]} valor={String(line.presentationSign)} onValorChange={(value) => changeLine(index, { presentationSign: value === "1" ? 1 : -1 })} disabled={selectedVersionMeta?.status !== "DRAFT" || !canEdit}/></div>
                {line.type === "SUBTOTAL" && <div className="grid gap-xs" aria-label={`Componentes de ${line.title}`}>{availableComponents.filter((candidate) => candidate.order < line.order).map((candidate) => { const component = line.components.find((item) => item.code === candidate.code); return <div key={candidate.code} className={cn("flex flex-wrap items-center gap-xs rounded-sm border px-xs py-[3px] text-label-sm", component ? "border-primary/40 bg-accent text-accent-foreground" : "border-border text-muted-foreground")}><label className="inline-flex items-center gap-xs"><input type="checkbox" checked={Boolean(component)} disabled={selectedVersionMeta?.status !== "DRAFT" || !canEdit} onChange={() => { if (component) changeLine(index, { components: line.components.filter((item) => item.code !== candidate.code) }); else setComponent(index, candidate.code, "ADD"); }} aria-label={`Incluir ${candidate.title} em ${line.title}`}/>{candidate.title}</label>{component && <Select rotulo={`Operador para ${candidate.title}`} opcoes={[{ valor: "ADD", rotulo: "+ Somar" }, { valor: "SUBTRACT", rotulo: "− Subtrair" }]} valor={component.operator} onValorChange={(value) => setComponent(index, candidate.code, value === "ADD" ? "ADD" : "SUBTRACT")} disabled={selectedVersionMeta?.status !== "DRAFT" || !canEdit}/>}</div>; })}<span className="text-label-sm text-muted-foreground">Escolha componentes anteriores; fórmula livre não é aceita.</span></div>}
              </div>
              <div className="flex flex-wrap items-end justify-between gap-sm"><label className="flex min-h-10 items-center gap-xs text-body-sm"><input type="radio" name={`base-av-${selectedId}-${selectedVersion}`} checked={line.verticalBasis} disabled={selectedVersionMeta?.status !== "DRAFT" || !canEdit} onChange={() => { setDirty(true); setLines((current) => current.map((candidate, i) => ({ ...candidate, verticalBasis: i === index }))); }} aria-label={`Definir ${line.title} como base da análise vertical`}/>Base da AV</label>{selectedVersionMeta?.status === "DRAFT" && canEdit && <Button variante="fantasma" tamanho="compacto" onClick={() => removeLine(index)} aria-label={`Remover linha ${line.title}`}>Remover</Button>}</div>
            </article>)}
          </div>}

          {selectedVersionMeta?.status === "DRAFT" && canEdit && <div className="mt-md flex flex-wrap justify-between gap-sm"><p className="flex max-w-[36rem] items-start gap-xs text-label-sm text-muted-foreground"><ShieldAlert size={15} className="mt-[2px] shrink-0" aria-hidden="true"/>Publicar congela esta versão. Nova versão não altera rascunhos de empresa já criados.</p><div className="flex flex-wrap gap-sm"><ConfirmacaoDeAcao gatilho={<Button variante="contorno" disabled={discardDraft.isPending}><Trash2 aria-hidden="true"/>Descartar rascunho</Button>} titulo="Descartar rascunho?" descricao="A versão ficará marcada como descartada no histórico. Nenhuma aplicação existente será alterada." rotuloDeConfirmacao="Descartar rascunho" destrutivo aoConfirmar={() => discardDraft.mutateAsync()}/><Button variante="contorno" disabled={!dirty || save.isPending} onClick={() => save.mutate()}><Save aria-hidden="true"/>Salvar rascunho</Button>{canPublish && <Button disabled={dirty || publish.isPending} onClick={() => publish.mutate()}><Check aria-hidden="true"/>Publicar versão</Button>}</div></div>}

          {selected.status === "ACTIVE" && selected.activeVersion && canEdit && <section className="mt-xl border-t border-border pt-lg" aria-labelledby="aplicar-modelo"><h3 id="aplicar-modelo" className="text-headline-sm">Aplicar a uma empresa</h3><p className="mt-xs max-w-2xl text-body-sm text-muted-foreground">Cada aplicação cria novo rascunho. Linhas e fórmulas são copiadas; contas e valores não. Mapeie as contas na empresa antes de publicar a estrutura.</p><div className="mt-md grid items-end gap-md tablet:grid-cols-[minmax(15rem,1fr)_auto]"><Select rotulo="Empresa de destino" opcoes={sourceOptions} valor={targetCompanyId || undefined} onValorChange={setTargetCompanyId} placeholder="Selecione empresa da carteira" ajuda="Versão ativa do modelo: v"/><ConfirmacaoDeAcao gatilho={<Button disabled={!targetCompanyId || apply.isPending || targetVersions.isPending}><WandSparkles aria-hidden="true"/>Criar rascunho na empresa<ArrowRight aria-hidden="true"/></Button>} titulo="Criar rascunho empresarial?" descricao="Será criada uma cópia independente desta versão para a empresa selecionada. Nenhuma conta ou valor será copiado; a aplicação ficará no histórico." rotuloDeConfirmacao="Criar rascunho" aoConfirmar={() => apply.mutateAsync()}/></div><p className="mt-sm text-label-sm text-muted-foreground">Aplicação unitária · {targetVersions.data?.[0] ? `revisão atual da empresa ${targetActiveRevision}` : "selecione empresa para conferir versão"}</p></section>}

          {selected.status === "ARCHIVED" && <p className="mt-lg border-y border-border bg-muted/40 px-md py-sm text-body-sm text-muted-foreground">Modelo arquivado: aplicação e criação de versões desativadas até reativação explícita.</p>}
          {selectedVersionMeta?.status !== "DRAFT" && <p className="mt-lg flex items-center gap-xs text-label-sm text-muted-foreground"><History size={14} aria-hidden="true"/>Histórico somente leitura; versões publicadas ou descartadas não podem ser alteradas.</p>}
        </>}
      </section>}
    </div>
  </div>;
};
