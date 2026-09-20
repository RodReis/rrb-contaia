/**
 * Campo de formulário do produto (PATTERNS.md §6).
 *
 * Label sempre visível acima; obrigatório marcado com `*`; a mensagem de erro
 * substitui a ajuda no mesmo espaço, sem empurrar o layout.
 */
'use client';

import { useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { IMaskInput } from 'react-imask';

import { cn } from '@/lib/cn';

export type MascaraDeCampo = 'cnpj' | 'cpf' | 'telefone' | 'cep' | null;

const MASCARAS: Readonly<Record<Exclude<MascaraDeCampo, null>, string>> = {
  cnpj: '00.000.000/0000-00',
  cpf: '000.000.000-00',
  telefone: '(00) 00000-0000',
  cep: '00000-000',
};

// Identificador fiscal é mono + tabular-nums (PATTERNS.md §3).
const MONO: ReadonlySet<string> = new Set(['cnpj', 'cpf', 'cep']);

const CLASSES_DO_CONTROLE = [
  'h-11 w-full rounded-md border bg-card px-md text-body-md text-foreground',
  'transition-colors duration-fast ease-out placeholder:text-muted-foreground/70',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
  'focus-visible:ring-offset-background disabled:opacity-50 tablet:h-10',
];

export type PropsDoCampo = Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange'> & {
  rotulo: string;
  obrigatorio?: boolean;
  erro?: string | undefined;
  ajuda?: ReactNode;
  mascara?: MascaraDeCampo;
  onValorChange?: (valor: string) => void;
};

export const Campo = ({
  rotulo,
  obrigatorio = false,
  erro,
  ajuda,
  mascara = null,
  className,
  id,
  value,
  onValorChange,
  onBlur,
  ...props
}: PropsDoCampo) => {
  const idGerado = useId();
  const idDoCampo = id ?? idGerado;
  const idDaDescricao = `${idDoCampo}-descricao`;
  const temErro = erro !== undefined && erro.length > 0;

  const classes = cn(
    CLASSES_DO_CONTROLE,
    MONO.has(mascara ?? '') && 'font-mono tabular-nums text-code-sm',
    temErro ? 'border-destructive' : 'border-input',
    className,
  );

  return (
    // `w-full`: o campo se estica quando é filho direto de um flex column, mas
    // dentro de um contêiner de largura própria o wrapper encolhe ao conteúdo
    // e o input colapsa para poucos pixels.
    <div className="flex w-full flex-col gap-xs">
      <label htmlFor={idDoCampo} className="text-label-md text-foreground">
        {rotulo}
        {obrigatorio ? (
          <span className="ml-xs text-danger-foreground" aria-hidden="true">
            *
          </span>
        ) : null}
      </label>

      {mascara === null ? (
        <input
          {...props}
          id={idDoCampo}
          value={value}
          onChange={(evento) => onValorChange?.(evento.target.value)}
          onBlur={onBlur}
          aria-invalid={temErro}
          aria-describedby={temErro || ajuda !== undefined ? idDaDescricao : undefined}
          aria-required={obrigatorio}
          className={classes}
        />
      ) : (
        <IMaskInput
          {...props}
          id={idDoCampo}
          mask={MASCARAS[mascara]}
          // O estado guarda o valor cru; a máscara é só apresentação
          // (FRONTEND.md §9). Colar valor formatado funciona.
          unmask
          value={typeof value === 'string' ? value : ''}
          onAccept={(valor: string) => onValorChange?.(valor)}
          onBlur={onBlur}
          aria-invalid={temErro}
          aria-describedby={temErro || ajuda !== undefined ? idDaDescricao : undefined}
          aria-required={obrigatorio}
          className={classes}
        />
      )}

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
