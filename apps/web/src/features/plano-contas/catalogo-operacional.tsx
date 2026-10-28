'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';

import { ler } from '../importacao/api';
import { useSessao } from '../usuarios/queries';
import { concede } from './permissoes';

const ItemSchema = z.object({
  code: z.string(),
  name: z.string(),
  type: z.enum(['ANALYTICAL', 'SYNTHETIC']),
  parentCode: z.string().nullable(),
  status: z.string(),
  version: z.number().or(z.string()),
  accountClass: z.string().nullable().optional(),
  costCenterPolicy: z.string().nullable().optional(),
  normalBalance: z.enum(['DEBIT', 'CREDIT']).optional(),
});
const ListaSchema = z.object({
  items: z.array(ItemSchema),
  nextCursor: z.string().nullable(),
  incompleteCount: z.number().optional(),
});
const HistoricoSchema = z.object({
  items: z.array(z.object({ id: z.string(), action: z.string().optional(), acao: z.string().optional(), occurredAt: z.string().optional(), ocorridoEm: z.string().optional() })),
});

type Item = z.infer<typeof ItemSchema>;
type Aba = 'contas' | 'centros';
type Edicao = Readonly<{
  code: string;
  classe: string;
  politica: string;
  type: 'ANALYTICAL' | 'SYNTHETIC';
  normalBalance: 'DEBIT' | 'CREDIT';
}>;
type StatusFiltro = 'ALL' | 'ACTIVE' | 'INCOMPLETE' | 'ARCHIVED';

const rota = (empresaId: string, aba: Aba): string =>
  `/empresas/${empresaId}/estrutura-contabil/${aba === 'contas' ? 'contas' : 'centros-de-custo'}`;

const consultarItens = async (empresaId: string, aba: Aba, busca: string, cursor?: string) => {
  const parametros = new URLSearchParams();
  if (busca !== '') parametros.set('busca', busca);
  if (cursor !== undefined) parametros.set('cursor', cursor);
  const consulta = parametros.toString();
  return ListaSchema.parse(await ler(`${rota(empresaId, aba)}${consulta === '' ? '' : `?${consulta}`}`));
};

const rotuloDaAba = (aba: Aba): string => (aba === 'contas' ? 'Plano de contas' : 'Centros de custo');

export const CatalogoOperacional = ({
  empresaId,
  somenteLeitura,
}: {
  empresaId: string;
  somenteLeitura: boolean;
}) => {
  const cache = useQueryClient();
  const { data: sessao } = useSessao();
  const [aba, setAba] = useState<Aba>('contas');
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState<StatusFiltro>('ALL');
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());
  const [selecionado, setSelecionado] = useState<Item | null>(null);
  const [edicao, setEdicao] = useState<Edicao | null>(null);
  const [confirmacaoDeArquivo, setConfirmacaoDeArquivo] = useState(false);

  const podeManterConta = !somenteLeitura && sessao !== undefined && concede(sessao, 'contabil.estrutura_contabil.manter_plano_contas');
  const podeManterCentro = !somenteLeitura && sessao !== undefined && concede(sessao, 'contabil.estrutura_contabil.manter_centros_custo');
  const podeArquivar = !somenteLeitura && sessao !== undefined && concede(sessao, 'contabil.estrutura_contabil.arquivar');
  const podeReativar = !somenteLeitura && sessao !== undefined && concede(sessao, 'contabil.estrutura_contabil.reativar');
  const podeManter = aba === 'contas' ? podeManterConta : podeManterCentro;
  const statusDisponiveis = aba === 'contas'
    ? (['ALL', 'ACTIVE', 'INCOMPLETE', 'ARCHIVED'] as const)
    : (['ALL', 'ACTIVE', 'ARCHIVED'] as const);


  const consulta = useInfiniteQuery({
    queryKey: ['catalogo-contabil', empresaId, aba, busca],
    queryFn: ({ pageParam }) => consultarItens(empresaId, aba, busca, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (ultima) => ultima.nextCursor ?? undefined,
  });
  const todosItens = consulta.data?.pages.flatMap((pagina) => pagina.items) ?? [];
  const filtroEfetivo: StatusFiltro = aba === 'centros' && filtro === 'INCOMPLETE' ? 'ACTIVE' : filtro;
  const elegiveis = todosItens.filter((item) => filtroEfetivo === 'ALL' || item.status === filtroEfetivo);
  const filhosPorPai = new Map<string, Item[]>();
  for (const item of elegiveis) {
    if (item.parentCode !== null) filhosPorPai.set(item.parentCode, [...(filhosPorPai.get(item.parentCode) ?? []), item]);
  }
  const itens = elegiveis.filter((item) => {
    let pai = item.parentCode;
    const visitados = new Set<string>([item.code]);
    while (pai !== null) {
      if (visitados.has(pai)) return false;
      visitados.add(pai);
      if (!expandidos.has(pai)) return false;
      pai = elegiveis.find((candidato) => candidato.code === pai)?.parentCode ?? null;
    }
    return true;
  });

  const consultaHistorico = useQuery({
    queryKey: ['catalogo-contabil', empresaId, 'historico', aba, selecionado?.code],
    enabled: selecionado !== null,
    queryFn: async () => {
      const catalogo = aba === 'contas' ? 'CONTA' : 'CENTRO_CUSTO';
      const parametros = new URLSearchParams({ catalogo, codigo: selecionado?.code ?? '' });
      return HistoricoSchema.parse(await ler(`/empresas/${empresaId}/estrutura-contabil/historico?${parametros.toString()}`));
    },
  });

  const salvar = useMutation({
    mutationFn: async (entrada: Readonly<{ endpoint: string; body: unknown; method: 'POST' | 'PUT' }>) =>
      ler(entrada.endpoint, {
        method: entrada.method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(entrada.body),
      }),
    onSuccess: async () => {
      await cache.invalidateQueries({ queryKey: ['catalogo-contabil', empresaId] });
      toast.success('Catálogo atualizado.');
      setSelecionado(null);
      setEdicao(null);
      setConfirmacaoDeArquivo(false);
    },
    onError: () => toast.error('Não foi possível salvar. Recarregue o catálogo e tente novamente.'),
  });

  const novaEdicao = (): Edicao => ({
    code: '__nova__',
    classe: '',
    politica: 'FORBIDDEN',
    type: 'ANALYTICAL',
    normalBalance: 'DEBIT',
  });

  const escolherItem = (item: Item): void => {
    setSelecionado(item);
    setEdicao({
      code: item.code,
      classe: item.accountClass ?? '',
      politica: item.costCenterPolicy ?? (item.type === 'SYNTHETIC' ? 'FORBIDDEN' : ''),
      type: item.type,
      normalBalance: item.normalBalance ?? 'DEBIT',
    });
    setConfirmacaoDeArquivo(false);
  };

  const iniciarCriacao = (): void => {
    setSelecionado(null);
    setEdicao(novaEdicao());
    setConfirmacaoDeArquivo(false);
  };

  const editarConta = (form: FormData): void => {
    if (edicao === null) return;
    const code = selecionado?.code ?? String(form.get('codigo') ?? '').trim();
    const name = String(form.get('nome') ?? '').trim();
    if (code === '' || name === '') return;
    const parentCode = String(form.get('parentCode') ?? '').trim();
    const payload = {
      code,
      name,
      type: String(form.get('type') ?? edicao.type),
      parentCode: parentCode === '' ? null : parentCode,
      accountClass: String(form.get('classe') ?? edicao.classe) || null,
      normalBalance: String(form.get('normalBalance') ?? edicao.normalBalance),
      costCenterPolicy: edicao.type === 'SYNTHETIC' || String(form.get('type') ?? edicao.type) === 'SYNTHETIC' ? 'FORBIDDEN' : String(form.get('politica') ?? edicao.politica),
      ...(selecionado === null ? {} : { version: Number(selecionado.version) }),
    };
    salvar.mutate({
      endpoint: selecionado === null ? rota(empresaId, 'contas') : `${rota(empresaId, 'contas')}/${encodeURIComponent(code)}`,
      method: selecionado === null ? 'POST' : 'PUT',
      body: payload,
    });
  };

  const editarCentro = (form: FormData): void => {
    const code = selecionado?.code ?? String(form.get('codigo') ?? '').trim();
    const name = String(form.get('nome') ?? '').trim();
    if (edicao === null || code === '' || name === '') return;
    const parentCode = String(form.get('parentCode') ?? '').trim();
    const payload = {
      code,
      name,
      type: String(form.get('type') ?? edicao.type),
      parentCode: parentCode === '' ? null : parentCode,
      ...(selecionado === null ? {} : { version: Number(selecionado.version) }),
    };
    salvar.mutate({
      endpoint: selecionado === null ? rota(empresaId, 'centros') : `${rota(empresaId, 'centros')}/${encodeURIComponent(code)}`,
      method: selecionado === null ? 'POST' : 'PUT',
      body: payload,
    });
  };

  const alterarEstado = (arquivada: boolean): void => {
    if (selecionado === null) return;
    const sufixo = arquivada ? 'arquivamento' : 'reativacao';
    salvar.mutate({
      endpoint: `${rota(empresaId, aba)}/${encodeURIComponent(selecionado.code)}/${sufixo}`,
      method: 'PUT',
      body: { version: Number(selecionado.version) },
    });
  };

  const navegarArvore = (event: React.KeyboardEvent<HTMLElement>, indice: number, item: Item): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const proximo = itens[Math.max(0, Math.min(itens.length - 1, indice + (event.key === 'ArrowDown' ? 1 : -1)))];
      if (proximo !== undefined) document.getElementById(`catalogo-item-${encodeURIComponent(proximo.code)}`)?.focus();
    } else if (event.key === 'ArrowRight' && filhosPorPai.has(item.code)) {
      event.preventDefault();
      if (!expandidos.has(item.code)) setExpandidos((atual) => new Set(atual).add(item.code));
      else { const filho = filhosPorPai.get(item.code)?.[0]; if (filho !== undefined) document.getElementById(`catalogo-item-${encodeURIComponent(filho.code)}`)?.focus(); }
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      if (expandidos.has(item.code)) setExpandidos((atual) => { const proximo = new Set(atual); proximo.delete(item.code); return proximo; });
      else if (item.parentCode !== null) document.getElementById(`catalogo-item-${encodeURIComponent(item.parentCode)}`)?.focus();
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      escolherItem(item);
    }
  };

  const nivelHierarquico = (item: Item): number => {
    const porCodigo = new Map(todosItens.map((candidato) => [candidato.code, candidato]));
    let nivel = 1;
    let pai = item.parentCode === null ? undefined : porCodigo.get(item.parentCode);
    const visitados = new Set([item.code]);
    while (pai !== undefined && !visitados.has(pai.code)) {
      visitados.add(pai.code);
      nivel += 1;
      pai = pai.parentCode === null ? undefined : porCodigo.get(pai.parentCode);
    }
    return nivel;
  };

  return (
    <section aria-labelledby="catalogo-operacional-titulo" className="mt-8 rounded-lg border border-border bg-card p-lg">
      <header className="flex flex-wrap items-start justify-between gap-md">
        <div>
          <h2 id="catalogo-operacional-titulo" className="text-title-lg">Estrutura contábil</h2>
          <p className="mt-xs text-body-sm text-muted-foreground">Catálogos por empresa. Código permanece imutável; contas sem classe precisam de revisão.</p>
        </div>
        <div className="flex flex-wrap gap-xs" role="tablist" aria-label="Catálogos">
          <Button variante={aba === 'contas' ? 'primaria' : 'contorno'} aria-selected={aba === 'contas'} role="tab" tabIndex={aba === 'contas' ? 0 : -1} onKeyDown={(event) => { if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { setAba(aba === 'contas' ? 'centros' : 'contas'); setSelecionado(null); setEdicao(null); } }} onClick={() => { setAba('contas'); setSelecionado(null); setEdicao(null); }}>Plano de contas</Button>
          <Button variante={aba === 'centros' ? 'primaria' : 'contorno'} aria-selected={aba === 'centros'} role="tab" tabIndex={aba === 'centros' ? 0 : -1} onKeyDown={(event) => { if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { setAba(aba === 'contas' ? 'centros' : 'contas'); setSelecionado(null); setEdicao(null); } }} onClick={() => { setAba('centros'); setSelecionado(null); setEdicao(null); }}>Centros de custo</Button>
        </div>
      </header>

      <div className="mt-lg grid gap-lg lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0">
          <label className="mb-xs block text-label-md" htmlFor="catalogo-busca">Pesquisar código ou nome</label>
          <input id="catalogo-busca" value={busca} onChange={(event) => setBusca(event.target.value)} className="h-11 w-full rounded-md border border-input bg-background px-md text-body-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          {aba === 'contas' && (consulta.data?.pages[0]?.incompleteCount ?? 0) > 0 ? <p className="mt-xs text-label-sm text-muted-foreground">{consulta.data?.pages[0]?.incompleteCount} contas aguardam classificação.</p> : null}
          <div className="mt-sm flex flex-wrap gap-xs" aria-label="Filtrar estado">
            {statusDisponiveis.filter((status) => aba === 'contas' || status !== 'INCOMPLETE').map((status) => (
              <Button key={status} tamanho="compacto" variante={filtro === status ? 'primaria' : 'contorno'} aria-pressed={filtro === status} onClick={() => setFiltro(status)}>
                {({ ALL: 'Todos', ACTIVE: 'Ativos', INCOMPLETE: 'Incompletos', ARCHIVED: 'Arquivados' })[status]}
              </Button>
            ))}
          </div>
          {podeManter ? <Button variante="contorno" className="mt-md" onClick={iniciarCriacao}>Novo item</Button> : null}
          {consulta.isPending ? <p role="status" className="py-lg text-body-md text-muted-foreground">Carregando catálogo…</p> : null}
          {consulta.isError ? <p role="alert" className="py-lg text-body-md">Falha ao carregar catálogo. Tente novamente.</p> : null}
          {!consulta.isPending && !consulta.isError && itens.length === 0 ? <p className="py-lg text-body-md text-muted-foreground">Nenhum item encontrado.</p> : null}
          {itens.length > 0 ? (
            <ul role="tree" className="mt-sm divide-y divide-border" aria-label={rotuloDaAba(aba)}>
              {itens.map((item) => (
                <li key={item.code}>
                    <div id={`catalogo-item-${encodeURIComponent(item.code)}`} role="treeitem" tabIndex={selecionado?.code === item.code || (selecionado === null && itens[0]?.code === item.code) ? 0 : -1} aria-selected={selecionado?.code === item.code} aria-level={nivelHierarquico(item)} aria-expanded={filhosPorPai.has(item.code) ? expandidos.has(item.code) : undefined} onKeyDown={(event) => navegarArvore(event, itens.indexOf(item), item)} className="flex min-h-12 items-center justify-between gap-md rounded-sm px-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" style={{ paddingInlineStart: `${Math.min(nivelHierarquico(item) - 1, 5) * 1.25 + 0.75}rem` }}>
                    <span className="flex min-w-0 items-center gap-xs">
                      {filhosPorPai.has(item.code) ? <button type="button" data-tree-toggle="true" aria-label={`${expandidos.has(item.code) ? 'Recolher' : 'Expandir'} ${item.code}`} aria-expanded={expandidos.has(item.code)} onClick={() => { const expandido = expandidos.has(item.code); setExpandidos((abertos) => { const proximo = new Set(abertos); if (expandido) proximo.delete(item.code); else proximo.add(item.code); return proximo; }); }} className="inline-flex size-7 items-center justify-center rounded hover:bg-muted">{expandidos.has(item.code) ? '▾' : '▸'}</button> : null}
                      <button id={`catalogo-selecionar-${encodeURIComponent(item.code)}`} type="button" aria-current={selecionado?.code === item.code ? 'true' : undefined} onClick={() => escolherItem(item)} onKeyDown={(event) => navegarArvore(event, itens.indexOf(item), item)} className="min-w-0 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><strong className="mr-xs shrink-0 font-mono text-label-md">{item.code}</strong>{item.name}</button>
                    </span>
                    <span className="shrink-0 text-label-sm text-muted-foreground">{item.status === 'INCOMPLETE' ? 'Classe pendente' : item.status === 'ARCHIVED' ? 'Arquivada' : item.type === 'ANALYTICAL' ? 'Analítica' : 'Sintética'}</span>
                    </div>
                </li>
              ))}
            </ul>
          ) : null}
          {consulta.hasNextPage ? <Button variante="contorno" className="mt-md" onClick={() => void consulta.fetchNextPage()} disabled={consulta.isFetchingNextPage}>{consulta.isFetchingNextPage ? 'Carregando…' : 'Carregar mais itens'}</Button> : null}
        </div>

        <aside className="rounded-md bg-muted/40 p-md" aria-label="Detalhes do item">
          {aba === 'contas' && (selecionado !== null || (edicao?.code === '__nova__' && podeManterConta)) ? (
            <form key={selecionado?.code ?? '__nova__'} action={editarConta} className="grid gap-sm">
              <h3 className="text-title-md">{selecionado === null ? 'Nova conta' : `Conta ${selecionado.code}`}</h3>
              {selecionado === null ? <label className="grid gap-xs text-label-md">Código<input name="codigo" required maxLength={120} className="h-10 rounded-md border border-input bg-background px-sm" /></label> : <p className="text-body-sm text-muted-foreground">Código imutável</p>}
              <label className="grid gap-xs text-label-md">Nome<input name="nome" required defaultValue={selecionado?.name} disabled={!podeManterConta || selecionado?.status === 'ARCHIVED'} maxLength={240} className="h-10 rounded-md border border-input bg-background px-sm" /></label>
              <label className="grid gap-xs text-label-md">Conta-pai<input name="parentCode" defaultValue={selecionado?.parentCode ?? ''} disabled={!podeManterConta || selecionado?.status === 'ARCHIVED'} maxLength={120} className="h-10 rounded-md border border-input bg-background px-sm" /></label>
              <Select rotulo="Tipo" name="type" valor={edicao?.type ?? selecionado?.type ?? 'ANALYTICAL'} onValorChange={(type) => setEdicao({ ...(edicao ?? novaEdicao()), code: selecionado?.code ?? '__nova__', type: type as Edicao['type'], politica: type === 'SYNTHETIC' ? 'FORBIDDEN' : (edicao?.politica ?? selecionado?.costCenterPolicy ?? 'OPTIONAL') })} disabled={!podeManterConta || selecionado?.status === 'ARCHIVED'} opcoes={[{ valor: 'ANALYTICAL', rotulo: 'Analítica' }, { valor: 'SYNTHETIC', rotulo: 'Sintética' }]} />
              <Select rotulo="Classe contábil" name="classe" valor={edicao?.classe ?? selecionado?.accountClass ?? ''} onValorChange={(classe) => setEdicao({ ...(edicao ?? novaEdicao()), code: selecionado?.code ?? '__nova__', classe })} disabled={!podeManterConta || selecionado?.status === 'ARCHIVED'} opcoes={[{ valor: 'ASSET', rotulo: 'Ativo' }, { valor: 'LIABILITY', rotulo: 'Passivo' }, { valor: 'EQUITY', rotulo: 'Patrimônio líquido' }, { valor: 'REVENUE', rotulo: 'Receita' }, { valor: 'EXPENSE', rotulo: 'Despesa' }, { valor: 'COMPENSATION', rotulo: 'Compensação' }, { valor: 'OTHER', rotulo: 'Outros' }]} />
              <Select rotulo="Saldo normal" name="normalBalance" valor={edicao?.normalBalance ?? selecionado?.normalBalance ?? 'DEBIT'} onValorChange={(normalBalance) => setEdicao({ ...(edicao ?? novaEdicao()), code: selecionado?.code ?? '__nova__', normalBalance: normalBalance as Edicao['normalBalance'] })} disabled={!podeManterConta || selecionado?.status === 'ARCHIVED'} opcoes={[{ valor: 'DEBIT', rotulo: 'Devedor' }, { valor: 'CREDIT', rotulo: 'Credor' }]} />
              <Select rotulo="Centro de custo" name="politica" valor={edicao?.politica ?? selecionado?.costCenterPolicy ?? ''} onValorChange={(politica) => setEdicao({ ...(edicao ?? novaEdicao()), code: selecionado?.code ?? '__nova__', politica })} disabled={!podeManterConta || edicao?.type === 'SYNTHETIC' || selecionado?.type === 'SYNTHETIC' || selecionado?.status === 'ARCHIVED'} opcoes={[{ valor: 'REQUIRED', rotulo: 'Obrigatório' }, { valor: 'OPTIONAL', rotulo: 'Opcional' }, { valor: 'FORBIDDEN', rotulo: 'Proibido' }]} />
              <Button type="submit" disabled={!podeManterConta || salvar.isPending || selecionado?.status === 'ARCHIVED'}>{selecionado === null ? 'Criar conta' : 'Salvar conta'}</Button>
              {selecionado?.status === 'ARCHIVED' && podeReativar ? <Button type="button" variante="contorno" onClick={() => alterarEstado(false)}>Reativar</Button> : null}
              {selecionado !== null && selecionado.status !== 'ARCHIVED' && podeArquivar ? <Button type="button" variante="destrutiva" onClick={() => setConfirmacaoDeArquivo(true)}>Arquivar</Button> : null}
              {confirmacaoDeArquivo ? <div role="group" aria-label="Confirmar arquivamento" className="grid gap-xs rounded-md border border-border p-sm"><p>Arquivar conta {selecionado?.code}? Descendentes ativos bloqueiam ação.</p><Button type="button" variante="destrutiva" onClick={() => alterarEstado(true)}>Confirmar arquivamento</Button><Button type="button" variante="contorno" onClick={() => setConfirmacaoDeArquivo(false)}>Cancelar</Button></div> : null}
            </form>
          ) : null}

          {aba === 'centros' && (selecionado !== null || (edicao?.code === '__nova__' && podeManterCentro)) ? (
            <form key={selecionado?.code ?? '__novo-centro__'} action={editarCentro} className="grid gap-sm">
              <h3 className="text-title-md">{selecionado === null ? 'Novo centro' : `Centro ${selecionado.code}`}</h3>
              {selecionado === null ? <label className="grid gap-xs text-label-md">Código<input name="codigo" required maxLength={120} className="h-10 rounded-md border border-input bg-background px-sm" /></label> : <p className="text-body-sm text-muted-foreground">Código imutável</p>}
              <label className="grid gap-xs text-label-md">Nome<input name="nome" required defaultValue={selecionado?.name} disabled={!podeManterCentro || selecionado?.status === 'ARCHIVED'} maxLength={240} className="h-10 rounded-md border border-input bg-background px-sm" /></label>
              <label className="grid gap-xs text-label-md">Centro-pai<input name="parentCode" defaultValue={selecionado?.parentCode ?? ''} disabled={!podeManterCentro || selecionado?.status === 'ARCHIVED'} maxLength={120} className="h-10 rounded-md border border-input bg-background px-sm" /></label>
              <Select rotulo="Tipo" name="type" valor={edicao?.type ?? selecionado?.type ?? 'ANALYTICAL'} onValorChange={(type) => setEdicao({ ...(edicao ?? novaEdicao()), code: selecionado?.code ?? '__nova__', type: type as Edicao['type'] })} disabled={!podeManterCentro || selecionado?.status === 'ARCHIVED'} opcoes={[{ valor: 'ANALYTICAL', rotulo: 'Analítico' }, { valor: 'SYNTHETIC', rotulo: 'Sintético' }]} />
              <Button type="submit" disabled={!podeManterCentro || salvar.isPending || selecionado?.status === 'ARCHIVED'}>{selecionado === null ? 'Criar centro' : 'Salvar centro'}</Button>
              {selecionado?.status === 'ARCHIVED' && podeReativar ? <Button type="button" variante="contorno" onClick={() => alterarEstado(false)}>Reativar</Button> : null}
              {selecionado !== null && selecionado.status !== 'ARCHIVED' && podeArquivar ? <Button type="button" variante="destrutiva" onClick={() => setConfirmacaoDeArquivo(true)}>Arquivar</Button> : null}
              {confirmacaoDeArquivo ? <div role="group" aria-label="Confirmar arquivamento" className="grid gap-xs rounded-md border border-border p-sm"><p>Arquivar centro {selecionado?.code}? Descendentes ativos bloqueiam ação.</p><Button type="button" variante="destrutiva" onClick={() => alterarEstado(true)}>Confirmar arquivamento</Button><Button type="button" variante="contorno" onClick={() => setConfirmacaoDeArquivo(false)}>Cancelar</Button></div> : null}
            </form>
          ) : null}

          {selecionado !== null ? (
            <section className="mt-md border-t border-border pt-md" aria-label="Histórico do item">
              <h3 className="text-title-sm">Histórico</h3>
              {consultaHistorico.isPending ? <p role="status" className="mt-sm text-body-sm text-muted-foreground">Carregando histórico…</p> : null}
              {consultaHistorico.isError ? <p role="alert" className="mt-sm text-body-sm">Falha ao carregar histórico.</p> : null}
              {consultaHistorico.data?.items.length === 0 ? <p className="mt-sm text-body-sm text-muted-foreground">Nenhum evento registrado.</p> : null}
              <ul className="mt-sm grid gap-xs">{consultaHistorico.data?.items.map((evento) => <li key={evento.id} className="text-body-sm">{evento.action ?? evento.acao ?? 'Alteração'}{evento.occurredAt ?? evento.ocorridoEm ? ` · ${evento.occurredAt ?? evento.ocorridoEm}` : ''}</li>)}</ul>
            </section>
          ) : null}

          {selecionado === null && edicao?.code !== '__nova__' ? <p className="text-body-sm text-muted-foreground">Selecione item para consultar ou editar.</p> : null}
        </aside>
      </div>
    </section>
  );
};
