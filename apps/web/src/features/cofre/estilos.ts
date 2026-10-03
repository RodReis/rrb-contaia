/**
 * Classes compartilhadas das sobreposições do cofre. O fundo usa o token
 * `--overlay-backdrop`, que existe nos dois temas: `bg-primary/40` viraria um véu
 * azul-claro sobre o carbono do tema escuro (PATTERNS.md §9).
 */
import { clsx } from 'clsx';

/**
 * Junta classes SEM o `tailwind-merge` do `cn` do projeto: ele não conhece as escalas
 * `text-title-sm`, `text-body-sm`… do design system, trata-as como cor e descarta o
 * tamanho quando há `text-foreground` junto. Aqui as classes conflitantes já são
 * exclusivas por construção.
 */
export const juntar = clsx;

export const FUNDO_DA_SOBREPOSICAO =
  'fixed inset-0 z-50 bg-[var(--overlay-backdrop)] backdrop-blur-[2px] sobreposicao-entra';

export const CAIXA_DE_DIALOGO = [
  'fixed left-1/2 top-1/2 z-50 flex w-[min(30rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2',
  'flex-col gap-md rounded-lg border border-border bg-popover p-lg text-popover-foreground',
  'shadow-[var(--elevation-4)] dialogo-entra',
].join(' ');
