/**
 * Resultado da simulação por NF-e (SPEC-016 §3.6, §5.2 item 7): cada item e tributo calculados pelo
 * motor, o valor declarado no XML ao lado e o total agregado. O declarado NUNCA é sobrescrito: a tela
 * compara e aponta divergência em texto, sem dizer qual dos dois valores é juridicamente correto.
 * A memória de cálculo de cada linha abre sob a própria linha.
 */
'use client';

import type { NfeComparisonDto, NfeSimulationResultDto } from '@contaia/shared';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { formatarCentavos } from '@/lib/moeda';
import { ROTULO_DO_TRIBUTO } from './apresentacao';
import { ResultadoDaSimulacao } from './resultado-da-simulacao';

const NUMERICO = 'font-mono text-code-sm tabular-nums';
const TITULOS = ['Item', 'Tributo', 'Base', 'Calculado', 'Declarado', 'Diferença', 'Situação'] as const;

const Situacao = ({ comparacao }: { comparacao: NfeComparisonDto | null }) =>
  comparacao === null ? (
    <StatusBadge tom="neutro" rotulo="Sem valor declarado" />
  ) : comparacao.diverges ? (
    <StatusBadge tom="critico" rotulo="Divergente" />
  ) : (
    <StatusBadge tom="conforme" rotulo="Confere" />
  );

const Valor = ({ centavos }: { centavos: number | null }) =>
  centavos === null ? <span className="text-muted-foreground">—</span> : <span className={NUMERICO}>{formatarCentavos(centavos)}</span>;

const CartaoDoTotal = ({
  rotulo,
  detalhe,
  calculado,
  comparacao,
}: {
  rotulo: string;
  detalhe?: string;
  calculado: number;
  comparacao: NfeComparisonDto | null;
}) => (
  <div className="flex flex-col gap-xs rounded-md bg-secondary p-md">
    <p className="text-label-sm uppercase text-muted-foreground">{rotulo}</p>
    <dl className="flex flex-col gap-xs">
      <div className="flex items-baseline justify-between gap-md">
        <dt className="text-body-sm text-muted-foreground">Calculado</dt>
        <dd>
          <Valor centavos={calculado} />
        </dd>
      </div>
      <div className="flex items-baseline justify-between gap-md">
        <dt className="text-body-sm text-muted-foreground">Declarado</dt>
        <dd>
          <Valor centavos={comparacao?.declaredCents ?? null} />
        </dd>
      </div>
    </dl>
    <Situacao comparacao={comparacao} />
    {detalhe === undefined ? null : <p className="text-body-sm text-muted-foreground">{detalhe}</p>}
  </div>
);

export const ResultadoDaNfe = ({ resultado }: { resultado: NonNullable<NfeSimulationResultDto> }) => {
  const [abertas, definirAbertas] = useState<ReadonlySet<string>>(new Set());
  const { calculated, ibs, cbs } = resultado.totals;

  const alternar = (chave: string): void =>
    definirAbertas((atuais) => {
      const proximas = new Set(atuais);

      if (!proximas.delete(chave)) {
        proximas.add(chave);
      }

      return proximas;
    });

  return (
    <div className="flex flex-col gap-lg">
      <section aria-label="Totais da NF-e" className="flex flex-col gap-sm">
        <div className="grid gap-md tablet:grid-cols-2">
          <CartaoDoTotal
            rotulo="IBS"
            detalhe={`Estados ${formatarCentavos(calculated.ibsUfCents)} · Municípios ${formatarCentavos(calculated.ibsMunCents)}`}
            calculado={calculated.ibsCents}
            comparacao={ibs}
          />
          <CartaoDoTotal rotulo="CBS" calculado={calculated.cbsCents} comparacao={cbs} />
        </div>
      </section>

      <p className="text-body-sm text-muted-foreground">
        A comparação confronta o valor calculado pelo motor com o declarado no XML. A divergência não indica qual valor está
        correto; o declarado no documento nunca é alterado.
      </p>

      {/* Tabela larga: rola na horizontal dentro do próprio contêiner. O colapso em cartões abaixo de
          768 px é a pendência P-02 do design system e fica registrado na PR. */}
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full min-w-[48rem] border-collapse text-left">
          <caption className="sr-only">Cálculo por item da NF-e</caption>
          <thead>
            <tr className="border-b border-border bg-muted/40">
              {TITULOS.map((titulo) => (
                <th
                  key={titulo}
                  scope="col"
                  className={`px-md py-sm text-label-sm uppercase text-muted-foreground ${
                    ['Base', 'Calculado', 'Declarado', 'Diferença'].includes(titulo) ? 'text-right' : ''
                  }`}
                >
                  {titulo}
                </th>
              ))}
              <th scope="col" className="px-md py-sm text-right text-label-sm uppercase text-muted-foreground">
                Memória
              </th>
            </tr>
          </thead>
          <tbody>
            {resultado.items.flatMap((item) =>
              item.taxes.flatMap((linha) => {
                const chave = `${item.number}-${linha.taxType}`;
                const aberta = abertas.has(chave);
                const rotulo = ROTULO_DO_TRIBUTO[linha.taxType];
                const diferenca = linha.comparison?.differenceCents ?? null;

                return [
                  <tr key={chave} className="border-b border-border align-middle hover:bg-accent/40">
                    <th scope="row" className={`px-md py-sm text-left ${NUMERICO}`}>
                      {item.number}
                    </th>
                    <td className="px-md py-sm text-body-md text-foreground">{rotulo}</td>
                    <td className="px-md py-sm text-right">
                      <Valor centavos={item.baseCents} />
                    </td>
                    <td className="px-md py-sm text-right">
                      <Valor centavos={linha.simulation.memory.resultCents} />
                    </td>
                    <td className="px-md py-sm text-right">
                      <Valor centavos={linha.comparison?.declaredCents ?? null} />
                    </td>
                    <td className="px-md py-sm text-right">
                      <Valor centavos={diferenca} />
                    </td>
                    <td className="px-md py-sm">
                      <Situacao comparacao={linha.comparison} />
                    </td>
                    <td className="px-md py-sm text-right">
                      <Button
                        variante="fantasma"
                        tamanho="compacto"
                        aria-expanded={aberta}
                        aria-controls={`memoria-${chave}`}
                        aria-label={`${aberta ? 'Ocultar' : 'Ver'} memória de cálculo: item ${item.number}, ${rotulo}`}
                        onClick={() => alternar(chave)}
                      >
                        {aberta ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
                        Memória
                      </Button>
                    </td>
                  </tr>,
                  aberta ? (
                    <tr key={`${chave}-memoria`} className="border-b border-border bg-secondary/50">
                      <td id={`memoria-${chave}`} colSpan={TITULOS.length + 1} className="p-md">
                        <ResultadoDaSimulacao resultado={linha.simulation} />
                      </td>
                    </tr>
                  ) : null,
                ];
              }),
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
