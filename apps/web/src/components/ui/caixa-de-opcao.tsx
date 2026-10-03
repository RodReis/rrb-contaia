/**
 * Opção única de um grupo (rádio). É um `input type=radio` de verdade — teclado
 * (setas dentro do grupo), leitor de tela e foco vêm do navegador — com o visual
 * do produto e o mesmo contrato de `CaixaDeSelecao`: descrição ligada por
 * `aria-describedby` e rótulo clicável.
 */
'use client';

import { useId, type ReactNode } from 'react';

import { cn } from '@/lib/cn';

export const CaixaDeOpcao = ({
  name,
  value,
  rotulo,
  descricao,
  marcada,
  onSelecionar,
  disabled = false,
}: {
  name: string;
  value: string;
  rotulo: string;
  descricao?: ReactNode;
  marcada: boolean;
  onSelecionar: (valor: string) => void;
  disabled?: boolean;
}) => {
  const id = useId();
  const idDaDescricao = `${id}-descricao`;

  return (
    <div
      className={cn(
        'flex items-start gap-sm rounded-md border bg-card p-md transition-colors duration-fast ease-out',
        marcada ? 'border-primary bg-accent/40' : 'border-border',
      )}
    >
      <input
        id={id}
        type="radio"
        name={name}
        value={value}
        checked={marcada}
        disabled={disabled}
        aria-describedby={descricao === undefined ? undefined : idDaDescricao}
        onChange={() => onSelecionar(value)}
        className={cn(
          'mt-xs size-4 shrink-0 cursor-pointer border border-input bg-card accent-primary',
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
