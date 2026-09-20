import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes } from 'react';

import { cn } from '@/lib/cn';

const botao = cva(
  [
    'inline-flex items-center justify-center gap-xs whitespace-nowrap rounded-md',
    'font-sans text-title-sm transition-colors duration-fast ease-out',
    // Foco visível em tudo que recebe foco (PATTERNS.md §7).
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
    'focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50',
    '[&_svg]:size-icon-sm [&_svg]:shrink-0',
  ],
  {
    variants: {
      variante: {
        primaria: 'bg-primary text-primary-foreground hover:bg-primary/90',
        secundaria: 'bg-secondary text-secondary-foreground hover:bg-accent',
        contorno: 'border border-input bg-card text-foreground hover:bg-accent',
        fantasma: 'text-foreground hover:bg-accent',
        destrutiva: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
      },
      tamanho: {
        // Alvo de toque de 44px em mobile, mesmo com o visual menor.
        padrao: 'h-11 px-lg py-sm tablet:h-10',
        compacto: 'h-11 px-md tablet:h-8 tablet:text-label-md',
        icone: 'size-11 tablet:size-9',
      },
    },
    defaultVariants: { variante: 'primaria', tamanho: 'padrao' },
  },
);

export type PropsDoBotao = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof botao> & { asChild?: boolean };

export const Button = ({
  className,
  variante,
  tamanho,
  asChild = false,
  type = 'button',
  ...props
}: PropsDoBotao) => {
  const Componente = asChild ? Slot : 'button';

  return (
    <Componente className={cn(botao({ variante, tamanho }), className)} type={type} {...props} />
  );
};
