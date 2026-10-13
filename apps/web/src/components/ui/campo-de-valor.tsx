/**
 * Campo de valor monetário ou percentual (COMPONENTS.md §1.3, `InputMasked` `currency`).
 *
 * O ESTADO guarda número inteiro: centavos (`123456` = R$ 1.234,56) ou centésimos de ponto
 * percentual (`1550` = 15,50%); a máscara é só apresentação (FRONTEND.md §9). Nunca há float.
 * Colar `R$ 12.345,67` funciona. O prefixo/sufixo é adorno visual, fora do valor digitado.
 *
 * Valor ilegível acusa o erro padrão ao SAIR do campo (PATTERNS.md §6) e entrega `null`; campo
 * vazio também entrega `null`, mas sem erro: obrigatoriedade é do formulário.
 */
'use client';

import { useId, useState, type ReactNode } from 'react';

import { cn } from '@/lib/cn';
import {
  formatarCentavos,
  formatarCentesimosDePercentual,
  paraCentavos,
  paraCentesimosDePercentual,
} from '@/lib/moeda';

export type TipoDeValor = 'moeda' | 'percentual';

const ERRO_PADRAO: Readonly<Record<TipoDeValor, string>> = {
  moeda: 'Informe um valor válido',
  percentual: 'Informe uma alíquota entre 0 e 100%',
};

const ANALISAR: Readonly<Record<TipoDeValor, (texto: string) => number | null>> = {
  moeda: paraCentavos,
  percentual: paraCentesimosDePercentual,
};

/** O número com a máscara do campo, sem o adorno (`R$`/`%`), que fica ao lado do input. */
const exibir = (tipo: TipoDeValor, valor: number | null): string => {
  if (valor === null) {
    return '';
  }

  return tipo === 'moeda'
    ? formatarCentavos(valor).replace(/^R\$\s/u, '')
    : formatarCentesimosDePercentual(valor).replace('%', '');
};

export const CampoDeValor = ({
  rotulo,
  tipo,
  valor,
  onValorChange,
  obrigatorio = false,
  erro,
  ajuda,
  somenteLeitura = false,
  disabled = false,
  className,
}: {
  rotulo: string;
  tipo: TipoDeValor;
  valor: number | null;
  onValorChange: (valor: number | null) => void;
  obrigatorio?: boolean;
  erro?: string | undefined;
  ajuda?: ReactNode;
  /** Bloqueio por regra de negócio: `readOnly` com a explicação em `ajuda`, nunca `disabled` mudo. */
  somenteLeitura?: boolean;
  disabled?: boolean;
  className?: string;
}) => {
  const id = useId();
  const idDaDescricao = `${id}-descricao`;
  const [texto, definirTexto] = useState(() => exibir(tipo, valor));
  const [valorVisto, definirValorVisto] = useState(valor);
  const [ilegivel, definirIlegivel] = useState(false);

  // Valor trocado por fora (reinício do formulário): o texto acompanha, a menos que seja o eco do
  // que a própria pessoa acabou de digitar. Ajuste de estado durante o render, sem efeito.
  if (valor !== valorVisto) {
    definirValorVisto(valor);

    if (valor !== (ANALISAR[tipo](texto) ?? null)) {
      definirTexto(exibir(tipo, valor));
      definirIlegivel(false);
    }
  }

  const mensagem = erro !== undefined && erro.length > 0 ? erro : ilegivel ? ERRO_PADRAO[tipo] : undefined;
  const temErro = mensagem !== undefined;

  const aoDigitar = (digitado: string): void => {
    definirTexto(digitado);
    definirIlegivel(false);
    onValorChange(digitado.trim() === '' ? null : ANALISAR[tipo](digitado));
  };

  const aoSair = (): void => {
    const analisado = ANALISAR[tipo](texto);

    if (texto.trim() === '') {
      definirIlegivel(false);

      return;
    }
    if (analisado === null) {
      definirIlegivel(true);

      return;
    }
    definirTexto(exibir(tipo, analisado));
  };

  const adorno = tipo === 'moeda' ? 'R$' : '%';

  return (
    <div className={cn('flex w-full flex-col gap-xs', className)}>
      <label htmlFor={id} className="text-label-md text-foreground">
        {rotulo}
        {obrigatorio ? (
          <span className="ml-xs text-danger-foreground" aria-hidden="true">
            *
          </span>
        ) : null}
      </label>

      <div
        className={cn(
          'flex h-11 w-full items-center gap-xs rounded-md border bg-card px-md tablet:h-10',
          'transition-colors duration-fast ease-out',
          'focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background',
          temErro ? 'border-destructive' : 'border-input',
          (disabled || somenteLeitura) && 'bg-muted/40',
          disabled && 'opacity-50',
        )}
      >
        {tipo === 'moeda' ? (
          <span aria-hidden="true" className="select-none text-code-sm text-muted-foreground">
            {adorno}
          </span>
        ) : null}
        <input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={texto}
          readOnly={somenteLeitura}
          disabled={disabled}
          aria-invalid={temErro}
          aria-required={obrigatorio}
          aria-describedby={temErro || ajuda !== undefined ? idDaDescricao : undefined}
          onChange={(evento) => aoDigitar(evento.target.value)}
          onBlur={aoSair}
          // Moeda e percentual alinham à direita, em mono com algarismos tabulares (TOKENS.md §5.3).
          className="min-w-0 flex-1 bg-transparent text-right font-mono text-code-sm tabular-nums text-foreground outline-none placeholder:text-muted-foreground/70"
        />
        {tipo === 'percentual' ? (
          <span aria-hidden="true" className="select-none text-code-sm text-muted-foreground">
            {adorno}
          </span>
        ) : null}
      </div>

      {temErro ? (
        <p id={idDaDescricao} className="text-body-sm text-danger-foreground">
          {mensagem}
        </p>
      ) : ajuda !== undefined ? (
        <p id={idDaDescricao} className="text-body-sm text-muted-foreground">
          {ajuda}
        </p>
      ) : null}
    </div>
  );
};
