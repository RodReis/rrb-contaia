'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Campo } from '@/components/ui/campo';
import { ErroDeTela, Skeleton } from '@/components/ui/estados';
import { Select } from '@/components/ui/select';
import { StatusBadge } from '@/components/ui/status-badge';
import { listarFilaResolucaoTributaria } from './api';

const dataCivil = (value: string) => new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short', timeZone: 'America/Sao_Paulo',
}).format(new Date(`${value.slice(0,10)}T12:00:00-03:00`));

export const FilaResolucaoTributaria = ({ empresaId, onAbrirDocumento }: {
  empresaId: string;
  onAbrirDocumento: (documentId: string) => void;
}) => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawPage = Number(searchParams.get('filaResolucaoPagina') ?? '1');
  const page = Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const filters = {
    pagina: page,
    de: searchParams.get('filaResolucaoDe') ?? '',
    ate: searchParams.get('filaResolucaoAte') ?? '',
    regime: searchParams.get('filaResolucaoRegime') ?? 'TODOS',
    estado: searchParams.get('filaResolucaoEstado') ?? 'TODOS',
    indeterminados: searchParams.get('filaResolucaoIndeterminados') ?? 'TODOS',
  };
  const queue = useQuery({
    queryKey: ['sessao', 'eu', 'fila-resolucao-tributaria', empresaId, filters],
    queryFn: () => listarFilaResolucaoTributaria(empresaId, filters),
  });

  const updateUrl = (key: string, value: string, resetPage = false) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value === '' || (key === 'filaResolucaoPagina' && value === '1')) params.delete(key);
    else params.set(key, value);
    if (resetPage) params.delete('filaResolucaoPagina');
    const query = params.toString();
    router.replace(query === '' ? `/empresas/${empresaId}` : `/empresas/${empresaId}?${query}`, { scroll: false });
  };

  const estadoLabel = (state: string) => state === 'RESOLVIDO'
    ? { tone: 'conforme' as const, label: 'Sem indeterminação' }
    : state === 'INDETERMINADO'
      ? { tone: 'atencao' as const, label: 'Indeterminado' }
      : { tone: 'atencao' as const, label: 'Sem processamento' };

  return (
    <section aria-labelledby="fila-resolucao-tributaria-titulo" className="space-y-md border-t border-border pt-lg">
      <div>
        <h4 id="fila-resolucao-tributaria-titulo" className="font-display text-title-md text-foreground">Resolução tributária · NF-e de entrada</h4>
        <p className="mt-xs max-w-3xl text-body-sm text-muted-foreground">Fila da empresa selecionada: documentos autorizados, emitidos por terceiros e endereçados a este estabelecimento. A lista mostra a revisão mais recente e mantém indeterminações explícitas.</p>
      </div>
      <div className="grid gap-sm sm:grid-cols-2 xl:grid-cols-5">
        <Campo rotulo="Emissão a partir de" type="date" value={filters.de} onValorChange={(value) => updateUrl('filaResolucaoDe', value, true)} />
        <Campo rotulo="Emissão até" type="date" value={filters.ate} onValorChange={(value) => updateUrl('filaResolucaoAte', value, true)} />
        <Select rotulo="Regime na data" valor={filters.regime} opcoes={[{ valor: 'TODOS', rotulo: 'Todos os regimes' }, { valor: 'SIMPLES_NACIONAL', rotulo: 'Simples Nacional' }, { valor: 'LUCRO_PRESUMIDO', rotulo: 'Lucro Presumido' }]} onValorChange={(value) => updateUrl('filaResolucaoRegime', value === 'TODOS' ? '' : value, true)} />
        <Select rotulo="Estado da resolução" valor={filters.estado} opcoes={[{ valor: 'TODOS', rotulo: 'Todos os estados' }, { valor: 'SEM_PROCESSAMENTO', rotulo: 'Sem processamento' }, { valor: 'INDETERMINADO', rotulo: 'Com indeterminação' }, { valor: 'RESOLVIDO', rotulo: 'Sem indeterminação' }]} onValorChange={(value) => updateUrl('filaResolucaoEstado', value === 'TODOS' ? '' : value, true)} />
        <Select rotulo="Itens indeterminados" valor={filters.indeterminados} opcoes={[{ valor: 'TODOS', rotulo: 'Todos' }, { valor: 'SIM', rotulo: 'Com indeterminação' }, { valor: 'NAO', rotulo: 'Sem indeterminação' }]} onValorChange={(value) => updateUrl('filaResolucaoIndeterminados', value === 'TODOS' ? '' : value, true)} />
      </div>
      {queue.isPending ? <div aria-busy="true"><Skeleton className="h-20 w-full" /></div> : null}
      {queue.isError ? <ErroDeTela titulo="Fila de resolução indisponível" descricao="Tente novamente em instantes." acao={<Button variante="contorno" onClick={() => void queue.refetch()}>Tentar novamente</Button>} /> : null}
      {queue.data?.itens.length === 0 ? <p className="rounded-md border border-dashed border-border p-md text-body-sm text-muted-foreground">Nenhuma NF-e de entrada autorizada corresponde aos filtros.</p> : null}
      {queue.data?.itens.length ? (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full min-w-[900px] text-left text-body-sm">
            <caption className="sr-only">Fila paginada de resolução tributária por empresa</caption>
            <thead className="bg-muted/60 text-label-sm text-muted-foreground"><tr>
              <th scope="col" className="px-md py-sm">Emissão e estado</th><th scope="col" className="px-md py-sm">Emitente</th>
              <th scope="col" className="px-md py-sm">Chave mascarada</th><th scope="col" className="px-md py-sm">Regime</th>
              <th scope="col" className="px-md py-sm">Itens</th><th scope="col" className="px-md py-sm">Pacote e revisão</th>
              <th scope="col" className="px-md py-sm">Ação</th>
            </tr></thead>
            <tbody>{queue.data.itens.map((item) => {
              const state = estadoLabel(item.resolution_state);
              return <tr key={item.id} className="border-t border-border/70">
                <td className="px-md py-sm"><span className="block">{dataCivil(item.emitido_em)}</span><StatusBadge tom={state.tone} rotulo={state.label} /></td>
                <td className="px-md py-sm">{item.emitente ?? 'Emitente não identificado'}</td>
                <td className="px-md py-sm font-mono text-label-sm">{item.chave_acesso ?? '—'}</td>
                <td className="px-md py-sm">{item.regime === 'SIMPLES_NACIONAL' ? 'Simples Nacional' : item.regime === 'LUCRO_PRESUMIDO' ? 'Lucro Presumido' : 'Regime indisponível na data'}</td>
                <td className="px-md py-sm tabular-nums">{item.item_count}</td>
                <td className="px-md py-sm">{item.revision === null ? '—' : `Revisão ${item.revision}`}{item.package_id === null ? <span className="block text-label-sm text-muted-foreground">Pacote indisponível</span> : null}</td>
                <td className="px-md py-sm"><Button variante="contorno" tamanho="compacto" onClick={() => onAbrirDocumento(item.id)}>Abrir documento</Button></td>
              </tr>;
            })}</tbody>
          </table>
          <nav aria-label="Paginação da fila de resolução" className="flex items-center justify-between border-t border-border p-sm">
            <Button variante="contorno" disabled={page === 1} onClick={() => updateUrl('filaResolucaoPagina', String(Math.max(1, page - 1)))}>Página anterior</Button>
            <span aria-live="polite" className="text-body-sm text-muted-foreground">Página {page} · {queue.data.total} documentos</span>
            <Button variante="contorno" disabled={!queue.data.temProximaPagina} onClick={() => updateUrl('filaResolucaoPagina', String(page + 1))}>Próxima página</Button>
          </nav>
        </div>
      ) : null}
    </section>
  );
};
