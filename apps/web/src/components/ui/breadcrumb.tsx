/**
 * Breadcrumb (PATTERNS.md §2): `label-sm`, separador chevron, o último item é a
 * página atual e não é link. Antecede o H1 em toda tela de configuração.
 */
import { ChevronRight } from 'lucide-react';
import Link from 'next/link';

export type ItemDoBreadcrumb = Readonly<{ rotulo: string; href?: string }>;

export const Breadcrumb = ({ itens }: { itens: readonly ItemDoBreadcrumb[] }) => (
  <nav aria-label="Trilha de navegação">
    <ol className="flex flex-wrap items-center gap-xs text-label-sm text-muted-foreground">
      {itens.map((item, indice) => {
        const atual = indice === itens.length - 1;

        return (
          <li key={item.rotulo} className="flex items-center gap-xs">
            {atual || item.href === undefined ? (
              <span
                {...(atual ? { 'aria-current': 'page' as const } : {})}
                className={atual ? 'text-foreground' : undefined}
              >
                {item.rotulo}
              </span>
            ) : (
              <Link
                href={item.href}
                className="rounded-sm underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {item.rotulo}
              </Link>
            )}
            {atual ? null : <ChevronRight className="size-icon-xs" aria-hidden="true" />}
          </li>
        );
      })}
    </ol>
  </nav>
);
