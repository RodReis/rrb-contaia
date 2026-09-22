/**
 * Sino de notificações no header (SPEC-006 §3-4). Badge conta não lidas;
 * painel mostra as 15 mais recentes; clique marca como lida e navega;
 * checkbox "Todas" marca em lote os itens visíveis.
 *
 * O protótipo (`docs/telas/.../code.html`, claro e escuro) só define o ícone
 * do sino com badge — não abre painel nenhum ali. A estrutura do painel
 * (lista, seleção, checkbox "Todas") segue DESIGN-SYSTEM.md/COMPONENTS.md
 * §2.3 (Topbar) e §4.3 (elevação nível 3 de Dropdown/Popover), não o
 * protótipo, que não tem equivalente.
 *
 * Decisão de token de cor (task-8-report.md): o círculo do badge usa
 * `bg-danger-indicator` (cor sólida `#ef4444`/`#ffb4ab`), não `bg-danger`
 * (fundo suave usado em `ErroDeTela`) — ver TOKENS.md §3.4.
 *
 * Texto do badge é `text-black` fixo (não há token "on-danger-indicator" no
 * design system). Contraste medido (WCAG): branco sobre `--danger-indicator`
 * dava 3.76:1 no claro e 1.7:1 no escuro — falha grave no escuro. Preto dá
 * 5.58:1 (claro) e 12.37:1 (escuro), muito acima do mínimo 3:1 para texto
 * pequeno/UI nos dois temas (fix round 1, task-8-report.md).
 *
 * Acabamento (Task 11, impeccable): texto de apoio do item ("Nova pendência ·
 * 21/09 14:32") trocado de `text-label-sm` para `text-body-sm` — TOKENS.md
 * §5.2 define `label-sm` como "Header de tabela (uppercase), eyebrow" e
 * `body-sm` como "Texto de apoio, descrição", que é exatamente este uso.
 * Achado Minor herdado da Task 8 (token semanticamente incorreto, não visual
 * — mesmo tamanho/peso resultante), corrigido aqui.
 */
'use client';

import { Bell } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { EmptyState, Skeleton } from '@/components/ui/estados';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

import { useMarcarComoLida, useMarcarVariasComoLidas, usePainelDeNotificacoes } from './queries';

const rotaDaPendencia = (empresaId: string): string => `/pendencias?empresaId=${empresaId}`;

const RESUMO_POR_TIPO: Readonly<Record<string, string>> = {
  NOVA_PENDENCIA: 'Nova pendência',
  DOCUMENTO_REJEITADO: 'Documento rejeitado',
  DOCUMENTO_VENCIDO: 'Documento vencido',
  NOVA_EXIGENCIA: 'Nova exigência',
};

const formatarQuando = (isoString: string): string =>
  new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(isoString));

export const SinoDeNotificacoes = () => {
  const [aberto, setAberto] = useState(false);
  const [selecionados, setSelecionados] = useState<ReadonlySet<string>>(new Set());
  const { data: painel, isPending, isError } = usePainelDeNotificacoes();
  const marcarComoLida = useMarcarComoLida();
  const marcarVariasComoLidas = useMarcarVariasComoLidas();

  const naoLidas = painel?.naoLidas ?? 0;
  const notificacoes = painel?.notificacoes ?? [];
  const todasSelecionadas = notificacoes.length > 0 && selecionados.size === notificacoes.length;

  const alternarSelecao = (id: string): void => {
    setSelecionados((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(id)) {
        proximo.delete(id);
      } else {
        proximo.add(id);
      }
      return proximo;
    });
  };

  const alternarTodas = (): void => {
    setSelecionados(todasSelecionadas ? new Set() : new Set(notificacoes.map((n) => n.id)));
  };

  const marcarSelecionadasComoLidas = (): void => {
    if (selecionados.size === 0) {
      return;
    }
    marcarVariasComoLidas.mutate(Array.from(selecionados), {
      onSuccess: () => setSelecionados(new Set()),
    });
  };

  const abrirNotificacao = (id: string, jaLida: boolean): void => {
    if (!jaLida) {
      marcarComoLida.mutate(id);
    }
    setAberto(false);
  };

  return (
    <Popover
      open={aberto}
      onOpenChange={(proximoAberto) => {
        setAberto(proximoAberto);
        if (!proximoAberto) {
          setSelecionados(new Set());
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button variante="fantasma" tamanho="icone" className="relative" aria-label="Notificações">
          <Bell aria-hidden="true" />
          {naoLidas > 0 ? (
            <span
              data-testid="badge-nao-lidas"
              className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger-indicator px-1 text-[10px] font-bold text-black"
            >
              {naoLidas}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96 p-0">
        <div className="flex items-center justify-between border-b border-border px-md py-sm">
          <label className="flex cursor-pointer items-center gap-xs text-body-sm text-foreground">
            <input
              type="checkbox"
              checked={todasSelecionadas}
              onChange={alternarTodas}
              disabled={notificacoes.length === 0}
              aria-label="Todas"
              className="size-icon-sm accent-[var(--color-primary)] focus-visible:outline-none"
            />
            Todas
          </label>
          {selecionados.size > 0 ? (
            <button
              type="button"
              onClick={marcarSelecionadasComoLidas}
              disabled={marcarVariasComoLidas.isPending}
              className="text-body-sm font-medium text-foreground underline underline-offset-2 hover:no-underline disabled:pointer-events-none disabled:opacity-50"
            >
              Marcar como lidas ({selecionados.size})
            </button>
          ) : null}
        </div>

        {isPending ? (
          <div className="space-y-xs p-md">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : isError ? (
          <p role="alert" className="p-md text-body-sm text-danger-foreground">
            Não foi possível carregar as notificações.
          </p>
        ) : notificacoes.length === 0 ? (
          <EmptyState
            nivel={3}
            icone={<Bell />}
            titulo="Sem notificações"
            descricao="Você será avisado quando houver pendências novas."
          />
        ) : (
          <ul role="list" className="max-h-96 divide-y divide-border overflow-y-auto">
            {notificacoes.map((notificacao) => (
              <li key={notificacao.id}>
                <div className="flex items-start gap-xs px-md py-sm hover:bg-accent/40">
                  <input
                    type="checkbox"
                    checked={selecionados.has(notificacao.id)}
                    onChange={() => alternarSelecao(notificacao.id)}
                    aria-label={`Selecionar notificação de ${notificacao.empresaNome}`}
                    className="mt-1 size-icon-sm accent-[var(--color-primary)] focus-visible:outline-none"
                  />
                  <Link
                    href={rotaDaPendencia(notificacao.empresaId)}
                    onClick={() => abrirNotificacao(notificacao.id, notificacao.lida)}
                    className="flex-1 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <p className="flex items-center gap-xs text-body-sm font-medium text-foreground">
                      {!notificacao.lida ? (
                        <span
                          aria-hidden="true"
                          className="size-2 shrink-0 rounded-full bg-danger-indicator"
                        />
                      ) : null}
                      {notificacao.empresaNome}
                      {!notificacao.lida ? <span className="sr-only"> (não lida)</span> : null}
                    </p>
                    <p className="text-body-sm text-muted-foreground">
                      {RESUMO_POR_TIPO[notificacao.tipo] ?? notificacao.tipo} ·{' '}
                      {formatarQuando(notificacao.criadoEm)}
                    </p>
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="border-t border-border p-sm text-center">
          <Link
            href="/notificacoes"
            onClick={() => setAberto(false)}
            className="text-body-sm font-medium text-foreground underline underline-offset-2 hover:no-underline"
          >
            Ver todas
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
};
