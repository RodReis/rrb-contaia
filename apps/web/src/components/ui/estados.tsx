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

/**
 * `nivel` existe porque o nível do título depende de onde o estado vazio está:
 * direto sob o `h1` da página ele precisa ser `h2`, e dentro de uma seção que
 * já tem `h2`, `h3`. Fixar `h3` pula nível e reprova no `heading-order` do axe.
 */
export const EmptyState = ({
  icone,
  titulo,
  descricao,
  acao,
  nivel = 3,
}: {
  icone: ReactNode;
  titulo: string;
  descricao: string;
  acao?: ReactNode;
  nivel?: 2 | 3;
}) => {
  const Titulo = nivel === 2 ? 'h2' : 'h3';

  return (
    <div className="flex flex-col items-center justify-center gap-md rounded-lg border border-border bg-card px-lg py-xl text-center">
      <span className="text-muted-foreground [&_svg]:size-icon-xl" aria-hidden="true">
        {icone}
      </span>
      <div className="flex flex-col gap-xs">
        <Titulo className="text-headline-sm text-foreground">{titulo}</Titulo>
        <p className="mx-auto max-w-prose text-body-sm text-muted-foreground">{descricao}</p>
      </div>
      {acao}
    </div>
  );
};

export const ErroDeTela = ({
  titulo,
  descricao,
  correlationId,
  acao,
  nivel = 3,
}: {
  titulo: string;
  descricao: string;
  correlationId?: string | undefined;
  acao?: ReactNode;
  nivel?: 2 | 3;
}) => (
  <div
    role="alert"
    className="flex flex-col gap-md rounded-lg border border-danger-indicator/40 bg-danger px-lg py-lg"
  >
    <div className="flex flex-col gap-xs">
      {nivel === 2 ? (
        <h2 className="text-headline-sm text-danger-foreground">{titulo}</h2>
      ) : (
        <h3 className="text-headline-sm text-danger-foreground">{titulo}</h3>
      )}
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
