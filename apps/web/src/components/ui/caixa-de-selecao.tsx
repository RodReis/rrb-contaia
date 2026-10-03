/**
 * Caixa de seleção (COMPONENTS.md §1.5). É um `input type=checkbox` de verdade
 * — teclado, leitor de tela e foco vêm do navegador — com o visual do produto,
 * a descrição ligada por `aria-describedby` e o rótulo clicável.
 */
'use client';

import { useId, type ReactNode } from 'react';

import { cn } from '@/lib/cn';

export const CaixaDeSelecao = ({
  rotulo,
  descricao,
  marcada,
  onMarcadaChange,
  disabled = false,
  name,
}: {
  rotulo: string;
  descricao?: ReactNode;
  marcada: boolean;
  onMarcadaChange: (marcada: boolean) => void;
  disabled?: boolean;
  name?: string;
}) => {
  const id = useId();
  const idDaDescricao = `${id}-descricao`;

  return (
    <div className="flex items-start gap-sm">
      <input
        id={id}
        type="checkbox"
        {...(name === undefined ? {} : { name })}
        checked={marcada}
        disabled={disabled}
        aria-describedby={descricao === undefined ? undefined : idDaDescricao}
        onChange={(evento) => onMarcadaChange(evento.target.checked)}
        className={cn(
          'mt-xs size-4 shrink-0 cursor-pointer rounded-sm border border-input bg-card accent-primary',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          'focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          'disabled:cursor-not-allowed disabled:opacity-50',
        )}
      />
      <div className="flex flex-col gap-xs">
        <label
          htmlFor={id}
          className={cn('text-label-md text-foreground', disabled ? 'opacity-50' : 'cursor-pointer')}
        >
          {rotulo}
        </label>
        {descricao === undefined ? null : (
          <p id={idDaDescricao} className="text-body-sm text-muted-foreground">
            {descricao}
          </p>
        )}
      </div>
    </div>
  );
};
