/**
 * Select do produto (COMPONENTS.md §1.4).
 *
 * `<select>` nativo é proibido (FRONTEND.md §21): não aceita chevron próprio,
 * não abre em portal e estiliza diferente em cada sistema operacional. Aqui é
 * Radix, com teclado e foco visível, nos tokens do design system.
 *
 * Acima de ~10 opções o catálogo manda usar `Combobox` com busca; nesta fatia
 * nenhum seletor passa de seis.
 */
'use client';

import * as RadixSelect from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';
import { useId, type ReactNode } from 'react';

import { cn } from '@/lib/cn';

export type OpcaoDoSelect = Readonly<{ valor: string; rotulo: string }>;

export const Select = ({
  rotulo,
  opcoes,
  valor,
  onValorChange,
  onBlur,
  obrigatorio = false,
  erro,
  ajuda,
  placeholder = 'Selecione',
  disabled = false,
  name,
}: {
  rotulo: string;
  opcoes: readonly OpcaoDoSelect[];
  valor: string | undefined;
  onValorChange: (valor: string) => void;
  onBlur?: () => void;
  obrigatorio?: boolean;
  erro?: string | undefined;
  ajuda?: ReactNode;
  placeholder?: string;
  disabled?: boolean;
  name?: string;
}) => {
  const id = useId();
  const idDoErro = `${id}-erro`;
  const idDaAjuda = `${id}-ajuda`;
  const temErro = erro !== undefined && erro.length > 0;

  return (
    <div className="flex flex-col gap-xs">
      <label htmlFor={id} className="text-label-md text-foreground">
        {rotulo}
        {obrigatorio ? (
          <span className="text-destructive" aria-hidden="true">
            {' '}
            *
          </span>
        ) : null}
      </label>

      <RadixSelect.Root
        value={valor ?? ''}
        onValueChange={onValorChange}
        disabled={disabled}
        {...(name === undefined ? {} : { name })}
      >
        <RadixSelect.Trigger
          id={id}
          onBlur={onBlur}
          aria-invalid={temErro}
          aria-describedby={temErro ? idDoErro : ajuda !== undefined ? idDaAjuda : undefined}
          className={cn(
            'flex h-11 w-full items-center justify-between gap-sm rounded-md border bg-card px-md',
            'text-body-md text-foreground transition-colors duration-fast ease-out tablet:h-10',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            'focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            'disabled:opacity-50 data-[placeholder]:text-muted-foreground/70',
            temErro ? 'border-destructive' : 'border-input',
          )}
        >
          <RadixSelect.Value placeholder={placeholder} />
          <RadixSelect.Icon asChild>
            <ChevronDown className="size-icon-sm shrink-0 text-muted-foreground" aria-hidden="true" />
          </RadixSelect.Icon>
        </RadixSelect.Trigger>

        <RadixSelect.Portal>
          <RadixSelect.Content
            position="popper"
            sideOffset={4}
            className={cn(
              'z-50 max-h-72 min-w-(--radix-select-trigger-width) overflow-hidden rounded-md',
              'border border-border bg-popover text-popover-foreground shadow-lg',
            )}
          >
            <RadixSelect.Viewport className="p-xs">
              {opcoes.map((opcao) => (
                <RadixSelect.Item
                  key={opcao.valor}
                  value={opcao.valor}
                  className={cn(
                    'relative flex cursor-default select-none items-center gap-sm rounded-sm',
                    'py-sm pl-md pr-lg text-body-md outline-none',
                    'data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground',
                  )}
                >
                  <RadixSelect.ItemIndicator asChild>
                    <Check className="size-icon-xs shrink-0" aria-hidden="true" />
                  </RadixSelect.ItemIndicator>
                  <RadixSelect.ItemText>{opcao.rotulo}</RadixSelect.ItemText>
                </RadixSelect.Item>
              ))}
            </RadixSelect.Viewport>
          </RadixSelect.Content>
        </RadixSelect.Portal>
      </RadixSelect.Root>

      {/* Erro substitui a ajuda no mesmo espaço, sem empurrar o layout. */}
      {temErro ? (
        <p id={idDoErro} className="text-body-sm text-destructive">
          {erro}
        </p>
      ) : ajuda !== undefined ? (
        <p id={idDaAjuda} className="text-body-sm text-muted-foreground">
          {ajuda}
        </p>
      ) : null}
    </div>
  );
};
