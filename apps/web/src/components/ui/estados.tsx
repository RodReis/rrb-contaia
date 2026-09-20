/**
 * Os quatro estados de tela (PATTERNS.md §5): carregando, vazio, erro, sucesso.
 * O terceiro caso do vazio — erro ao carregar — tem componente próprio, porque
 * tratar os três com o mesmo texto é bug de UX (COMPONENTS.md §3.7).
 */
import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

export const Skeleton = ({ className }: { className?: string }) => (
  // Sem animação sob reduced-motion: skeleton é forma, não movimento.
  <div
    className={cn(
      'rounded-md bg-muted motion-safe:animate-pulse',
      className,
    )}
    aria-hidden="true"
  />
);

export const EmptyState = ({
  icone,
  titulo,
  descricao,
  acao,
}: {
  icone: ReactNode;
  titulo: string;
  descricao: string;
  acao?: ReactNode;
}) => (
  <div className="flex flex-col items-center justify-center gap-md rounded-lg border border-border bg-card px-lg py-xl text-center">
    <span className="text-muted-foreground [&_svg]:size-icon-xl" aria-hidden="true">
      {icone}
    </span>
    <div className="flex flex-col gap-xs">
      <h3 className="text-headline-sm text-foreground">{titulo}</h3>
      <p className="mx-auto max-w-prose text-body-sm text-muted-foreground">{descricao}</p>
    </div>
    {acao}
  </div>
);

export const ErroDeTela = ({
  titulo,
  descricao,
  correlationId,
  acao,
}: {
  titulo: string;
  descricao: string;
  correlationId?: string | undefined;
  acao?: ReactNode;
}) => (
  <div
    role="alert"
    className="flex flex-col gap-md rounded-lg border border-danger-indicator/40 bg-danger px-lg py-lg"
  >
    <div className="flex flex-col gap-xs">
      <h3 className="text-headline-sm text-danger-foreground">{titulo}</h3>
      <p className="text-body-sm text-danger-foreground/90">{descricao}</p>
    </div>

    {correlationId !== undefined ? (
      <p className="text-body-sm text-danger-foreground/90">
        Informe este código ao suporte:{' '}
        <code className="select-all font-mono text-code-sm tabular-nums">{correlationId}</code>
      </p>
    ) : null}

    {acao}
  </div>
);
