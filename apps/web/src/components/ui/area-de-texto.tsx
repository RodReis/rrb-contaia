/**
 * Campo de texto longo (PATTERNS.md §6). Mesmo contrato visual do `Campo`:
 * label acima, obrigatório com `*`, erro substituindo a ajuda no mesmo espaço.
 *
 * Existe porque a justificativa de arquivamento e reativação é texto corrido
 * e um `input` de uma linha esconde o que a pessoa escreveu — justamente o
 * conteúdo que o histórico guarda para sempre (SPEC-003 §3.5).
 */
'use client';

import { useId, type ReactNode, type TextareaHTMLAttributes } from 'react';

import { cn } from '@/lib/cn';

const CLASSES_DO_CONTROLE = [
  'w-full rounded-md border bg-card px-md py-sm text-body-md text-foreground',
  'transition-colors duration-fast ease-out placeholder:text-muted-foreground/70',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
  'focus-visible:ring-offset-background disabled:opacity-50',
  // Redimensionamento só na vertical: horizontal quebraria a coluna do formulário.
  'resize-y min-h-[6rem]',
];

export type PropsDaAreaDeTexto = Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  'onChange'
> & {
  rotulo: string;
  obrigatorio?: boolean;
  erro?: string | undefined;
  ajuda?: ReactNode;
  onValorChange?: (valor: string) => void;
};

export const AreaDeTexto = ({
  rotulo,
  obrigatorio = false,
  erro,
  ajuda,
  className,
  id,
  value,
  onValorChange,
  onBlur,
  ...props
}: PropsDaAreaDeTexto) => {
  const idGerado = useId();
  const idDoCampo = id ?? idGerado;
  const idDaDescricao = `${idDoCampo}-descricao`;
  const temErro = erro !== undefined && erro.length > 0;

  return (
    <div className="flex w-full flex-col gap-xs">
      <label htmlFor={idDoCampo} className="text-label-md text-foreground">
        {rotulo}
        {obrigatorio ? (
          <span className="ml-xs text-danger-foreground" aria-hidden="true">
            *
          </span>
        ) : null}
      </label>

      <textarea
        {...props}
        id={idDoCampo}
        value={value}
        onChange={(evento) => onValorChange?.(evento.target.value)}
        onBlur={onBlur}
        aria-invalid={temErro}
        aria-describedby={temErro || ajuda !== undefined ? idDaDescricao : undefined}
        aria-required={obrigatorio}
        className={cn(
          CLASSES_DO_CONTROLE,
          temErro ? 'border-destructive' : 'border-input',
          className,
        )}
      />

      {temErro ? (
        <p id={idDaDescricao} className="text-body-sm text-danger-foreground">
          {erro}
        </p>
      ) : ajuda !== undefined ? (
        <p id={idDaDescricao} className="text-body-sm text-muted-foreground">
          {ajuda}
        </p>
      ) : null}
    </div>
  );
};
