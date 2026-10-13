/**
 * Resultado e memória de cálculo determinística (SPEC-016 §3.4, §3.5, §5.2 item 6). O painel
 * apresenta o que a API devolveu, etapa por etapa, sem recalcular nada: base, redução, base
 * reduzida, alíquota, valor antes do arredondamento, modo de arredondamento e resultado. O
 * resultado é inteiro em centavos; os valores intermediários vêm como fração exata e a tela os
 * mostra em decimal por aritmética inteira (nunca float).
 *
 * Toda regra do catálogo da F16 é fixture: o aviso de dado de teste não oficial é permanente e
 * tem texto, não só cor.
 */
import type { TaxRegime, TaxType } from '@contaia/domain';
import type { TaxOperationType, TaxSimulationResultDto } from '@contaia/shared';
import { ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';

import { StatusBadge } from '@/components/ui/status-badge';
import { formatarCentavos, formatarCentesimosDePercentual } from '@/lib/moeda';
import {
  ROTULO_DA_OPERACAO,
  ROTULO_DO_REGIME,
  ROTULO_DO_TRIBUTO,
  formatarDataCivil,
  formatarFracaoExata,
  formatarVigencia,
} from './apresentacao';

const NUMERICO = 'font-mono text-code-sm tabular-nums';

/** Tributo · regime · operação, como a regra se identifica na tela. */
export const rotuloDaRegra = (regra: Readonly<{ taxType: TaxType; regime: TaxRegime; operationType: string }>): string =>
  [
    ROTULO_DO_TRIBUTO[regra.taxType],
    ROTULO_DO_REGIME[regra.regime],
    ROTULO_DA_OPERACAO[regra.operationType as TaxOperationType] ?? regra.operationType,
  ].join(' · ');

const Etapa = ({ rotulo, children }: { rotulo: string; children: ReactNode }) => (
  <div className="grid gap-xs border-b border-border py-sm last:border-b-0 tablet:grid-cols-[13rem_1fr] tablet:gap-md">
    <dt className="text-label-md text-muted-foreground">{rotulo}</dt>
    <dd className="min-w-0 break-words text-body-md text-foreground">{children}</dd>
  </div>
);

export const ResultadoDaSimulacao = ({ resultado }: { resultado: TaxSimulationResultDto }) => {
  const { rule, memory } = resultado;
  const temFracao = memory.reducedBase.denominator !== '1';
  const notaDaFixture = rule.fixtureNote.trim();

  return (
    <section aria-labelledby="titulo-da-memoria" className="flex flex-col gap-md rounded-lg border border-border bg-card p-md">
      <header className="flex flex-col gap-xs">
        <h3 id="titulo-da-memoria" className="flex items-center gap-xs text-headline-sm text-foreground">
          <ShieldCheck className="size-icon-md shrink-0 text-muted-foreground" aria-hidden="true" />
          Memória de cálculo determinística
        </h3>
      </header>

      <div aria-live="polite" className="flex flex-col gap-xs rounded-md bg-secondary p-md">
        <p className="text-label-sm uppercase text-muted-foreground">Resultado</p>
        <p className="font-mono text-display-lg tabular-nums text-foreground">{formatarCentavos(memory.resultCents)}</p>
        <p className="text-body-sm text-muted-foreground">Arredondamento: meio para cima, ao centavo.</p>
      </div>

      <p role="note" className="flex flex-col gap-xs rounded-md bg-warning p-sm text-body-sm text-warning-foreground">
        <span>
          <StatusBadge tom="atencao" rotulo="Dado de teste não oficial" />
        </span>
        <span>
          Fonte: {rule.source}.
          {notaDaFixture.length > 0 && notaDaFixture !== 'Dado de teste não oficial' ? ` ${notaDaFixture}.` : ''} Este resultado
          prova o comportamento do motor e não orienta o recolhimento de tributo.
        </span>
      </p>

      <dl className="flex flex-col">
        <Etapa rotulo="Regra e versão">
          {rotuloDaRegra(rule)} <span className="text-muted-foreground">— versão {rule.versionNumber}</span>
        </Etapa>
        <Etapa rotulo="Vigência da regra">{formatarVigencia(rule.validFrom, rule.validUntil)}</Etapa>
        <Etapa rotulo="Data do fato gerador">
          <span className={NUMERICO}>{formatarDataCivil(memory.factDate)}</span>
        </Etapa>
        <Etapa rotulo="Base de cálculo">
          <span className={NUMERICO}>{formatarCentavos(memory.baseCents)}</span>
        </Etapa>
        <Etapa rotulo="Redução de base">
          {memory.baseReductionBasisPoints === 0 ? (
            'Sem redução'
          ) : (
            <span className={NUMERICO}>{formatarCentesimosDePercentual(memory.baseReductionBasisPoints)}</span>
          )}
        </Etapa>
        <Etapa rotulo="Base após a redução">
          <span className={NUMERICO}>{formatarFracaoExata(memory.reducedBase)} centavos</span>
          {temFracao ? (
            <span className={`${NUMERICO} ml-xs text-muted-foreground`}>
              ({memory.reducedBase.numerator}/{memory.reducedBase.denominator})
            </span>
          ) : null}
        </Etapa>
        <Etapa rotulo="Alíquota">
          <span className={NUMERICO}>{formatarCentesimosDePercentual(memory.rateBasisPoints)}</span>
        </Etapa>
        <Etapa rotulo="Valor antes do arredondamento">
          <span className={NUMERICO}>{formatarFracaoExata(memory.unrounded)} centavos</span>
          <span className={`${NUMERICO} ml-xs text-muted-foreground`}>
            ({memory.unrounded.numerator}/{memory.unrounded.denominator})
          </span>
        </Etapa>
        <Etapa rotulo="Arredondamento">Meio para cima (ao centavo)</Etapa>
      </dl>
    </section>
  );
};
