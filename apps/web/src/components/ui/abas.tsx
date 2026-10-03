/**
 * Abas segmentadas (COMPONENTS.md §2.5): trilho `--secondary`, item ativo
 * `--card` com elevação, inativo `--muted-foreground`.
 *
 * Correção obrigatória do catálogo: ativo e inativo têm a MESMA métrica de
 * fonte — a diferença é fundo, cor e elevação. No protótipo a fonte mudava e a
 * largura da aba saltava a cada troca.
 */
'use client';

import * as Tabs from '@radix-ui/react-tabs';
import type { ComponentPropsWithoutRef } from 'react';

import { cn } from '@/lib/cn';

export const Abas = Tabs.Root;

export const ListaDeAbas = ({ className, ...props }: ComponentPropsWithoutRef<typeof Tabs.List>) => (
  <Tabs.List
    className={cn('flex flex-wrap gap-xs rounded-md bg-secondary p-xs', className)}
    {...props}
  />
);

export const GatilhoDeAba = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof Tabs.Trigger>) => (
  <Tabs.Trigger
    className={cn(
      'flex-1 whitespace-nowrap rounded-md px-md py-sm text-title-sm transition-colors duration-fast ease-out',
      'text-muted-foreground hover:text-foreground',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      'focus-visible:ring-offset-2 focus-visible:ring-offset-background',
      'data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-[var(--elevation-1)]',
      className,
    )}
    {...props}
  />
);

export const ConteudoDeAba = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof Tabs.Content>) => (
  <Tabs.Content
    // O Radix deixa o painel focável (tabIndex 0): sem anel o foco do teclado ficaria invisível.
    className={cn(
      'flex flex-col gap-lg rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
      className,
    )}
    {...props}
  />
);
