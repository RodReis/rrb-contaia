/**
 * Stepper do wizard (COMPONENTS.md §5.7).
 *
 * O protótipo distingue "próximo" de "futuro" por opacidade (75%/50%), o que
 * reprova em contraste: aqui a distinção é por cor, peso e ícone. A etapa
 * atual, as concluídas e as pendentes são identificáveis sem depender de cor
 * (SPEC-001 §5) — cada uma carrega rótulo textual de situação.
 */
'use client';

import { Check } from 'lucide-react';

import { cn } from '@/lib/cn';

export type SituacaoDaEtapa = 'concluida' | 'atual' | 'pendente';

export type EtapaDoStepper = Readonly<{
  id: string;
  rotulo: string;
  situacao: SituacaoDaEtapa;
}>;

const ROTULO_DA_SITUACAO: Readonly<Record<SituacaoDaEtapa, string>> = {
  concluida: 'concluída',
  atual: 'etapa atual',
  pendente: 'pendente',
};

export const Stepper = ({
  etapas,
  onSelecionar,
}: {
  etapas: readonly EtapaDoStepper[];
  onSelecionar?: (id: string) => void;
}) => (
  <nav aria-label="Etapas do cadastro">
    <ol className="flex flex-col gap-xs tablet:flex-row tablet:items-center tablet:gap-sm">
      {etapas.map((etapa, indice) => {
        const selecionavel = onSelecionar !== undefined && etapa.situacao !== 'pendente';

        const conteudo = (
          <>
            <span
              className={cn(
                'flex size-6 shrink-0 items-center justify-center rounded-full border text-label-md tabular-nums',
                etapa.situacao === 'concluida' &&
                  'border-success-indicator bg-success text-success-foreground',
                etapa.situacao === 'atual' && 'border-primary bg-primary text-primary-foreground',
                etapa.situacao === 'pendente' && 'border-border bg-muted text-muted-foreground',
              )}
              aria-hidden="true"
            >
              {etapa.situacao === 'concluida' ? <Check className="size-icon-xs" /> : indice + 1}
            </span>

            <span className="flex flex-col text-left">
              <span
                className={cn(
                  'text-title-sm',
                  etapa.situacao === 'atual' ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {etapa.rotulo}
              </span>
              <span className="text-label-sm uppercase text-muted-foreground">
                {ROTULO_DA_SITUACAO[etapa.situacao]}
              </span>
            </span>
          </>
        );

        return (
          <li key={etapa.id} className="tablet:flex-1">
            {selecionavel ? (
              <button
                type="button"
                onClick={() => onSelecionar(etapa.id)}
                aria-current={etapa.situacao === 'atual' ? 'step' : undefined}
                className={cn(
                  'flex w-full items-center gap-sm rounded-md px-sm py-sm text-left transition-colors duration-fast ease-out',
                  'hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  'focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                )}
              >
                {conteudo}
              </button>
            ) : (
              <div
                aria-current={etapa.situacao === 'atual' ? 'step' : undefined}
                className="flex w-full items-center gap-sm px-sm py-sm"
              >
                {conteudo}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  </nav>
);
