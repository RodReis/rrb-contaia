/**
 * StatusBadge — o semáforo fiscal (COMPONENTS.md §3.4).
 *
 * Anatomia fixada pelo catálogo: dot de 6px (`radius-full`) + rótulo
 * `label-sm`, fundo e texto do token de status, `radius-sm`, sem borda.
 *
 * A regra que este componente existe para garantir: **cor nunca é o único
 * sinal**. O rótulo textual é obrigatório, não opcional — daltonismo, impressão
 * em preto e branco e contraste baixo precisam ler o mesmo estado.
 */
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/cn';

const badge = cva(
  'inline-flex items-center gap-sm rounded-sm px-sm py-xs text-label-sm whitespace-nowrap',
  {
    variants: {
      tom: {
        conforme: 'bg-success text-success-foreground',
        atencao: 'bg-warning text-warning-foreground',
        critico: 'bg-danger text-danger-foreground',
        processando: 'bg-info text-info-foreground',
        ia: 'bg-ai text-ai-foreground',
        neutro: 'bg-muted text-muted-foreground',
      },
    },
    defaultVariants: { tom: 'neutro' },
  },
);

const dot = cva('size-1.5 shrink-0 rounded-full', {
  variants: {
    tom: {
      conforme: 'bg-success-indicator',
      atencao: 'bg-warning-indicator',
      critico: 'bg-danger-indicator',
      processando: 'bg-info-indicator motion-safe:animate-pulse',
      ia: 'bg-ai-indicator',
      neutro: 'bg-muted-foreground',
    },
  },
  defaultVariants: { tom: 'neutro' },
});

export type TomDoStatus = NonNullable<VariantProps<typeof badge>['tom']>;

export const StatusBadge = ({
  tom,
  rotulo,
  className,
}: {
  tom: TomDoStatus;
  rotulo: string;
  className?: string;
}) => (
  <span className={cn(badge({ tom }), className)}>
    <span className={dot({ tom })} aria-hidden="true" />
    {rotulo}
  </span>
);
