/**
 * Campo de senha (PATTERNS.md §6): mesmo contrato visual do `Campo` — rótulo
 * visível acima, obrigatório com `*`, erro substituindo a ajuda no mesmo espaço
 * — e um botão para mostrar/ocultar o que se digitou, com `aria-pressed`.
 *
 * `autocomplete="new-password"`: é definição de senha, não login; o gerenciador
 * de senhas sugere uma forte em vez de preencher a antiga.
 */
'use client';

import { Eye, EyeOff } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';

import { cn } from '@/lib/cn';

export const CampoDeSenha = ({
  rotulo,
  nomeParaOBotao,
  obrigatorio = false,
  erro,
  ajuda,
  value,
  onValorChange,
  onBlur,
  autoComplete = 'new-password',
  name,
}: {
  rotulo: string;
  /** Como o botão se refere ao campo ("Mostrar senha"); padrão: o rótulo em minúsculas. */
  nomeParaOBotao?: string;
  obrigatorio?: boolean;
  erro?: string | undefined;
  ajuda?: ReactNode;
  value: string;
  onValorChange: (valor: string) => void;
  onBlur?: () => void;
  autoComplete?: string;
  name?: string;
}) => {
  const id = useId();
  const idDaDescricao = `${id}-descricao`;
  const [visivel, definirVisivel] = useState(false);
  const temErro = erro !== undefined && erro.length > 0;
  const alvo = nomeParaOBotao ?? rotulo.toLowerCase();

  return (
    <div className="flex w-full flex-col gap-xs">
      <label htmlFor={id} className="text-label-md text-foreground">
        {rotulo}
        {obrigatorio ? (
          <span className="ml-xs text-danger-foreground" aria-hidden="true">
            *
          </span>
        ) : null}
      </label>

      <div className="relative">
        <input
          id={id}
          {...(name === undefined ? {} : { name })}
          type={visivel ? 'text' : 'password'}
          value={value}
          autoComplete={autoComplete}
          onChange={(evento) => onValorChange(evento.target.value)}
          onBlur={onBlur}
          aria-invalid={temErro}
          aria-describedby={temErro || ajuda !== undefined ? idDaDescricao : undefined}
          aria-required={obrigatorio}
          className={cn(
            'h-11 w-full rounded-md border bg-card pl-md pr-[3.25rem] text-body-md text-foreground',
            'transition-colors duration-fast ease-out placeholder:text-muted-foreground/70',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            'focus-visible:ring-offset-background tablet:h-10',
            temErro ? 'border-destructive' : 'border-input',
          )}
        />
        <button
          type="button"
          onClick={() => definirVisivel((atual) => !atual)}
          aria-pressed={visivel}
          aria-label={visivel ? `Ocultar ${alvo}` : `Mostrar ${alvo}`}
          className={cn(
            'absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-md text-muted-foreground',
            'transition-colors duration-fast ease-out hover:text-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
        >
          {visivel ? (
            <EyeOff className="size-icon-sm" aria-hidden="true" />
          ) : (
            <Eye className="size-icon-sm" aria-hidden="true" />
          )}
        </button>
      </div>

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
