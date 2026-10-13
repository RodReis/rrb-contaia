/**
 * O que a NF-e informa (SPEC-016 §3.6): só o que a análise extraiu para a simulação. Nada de emitente,
 * chave de acesso ou texto do documento: a API nem devolve esses dados. A ausência do grupo IBS/CBS
 * e o regime que o XML não mapeia ficam explícitos, para o usuário saber o que ainda precisa informar.
 */
import type { NfeExtractionDto } from '@contaia/shared';

import { formatarCentavos } from '@/lib/moeda';
import { ROTULO_DO_REGIME, formatarDataCivil } from './apresentacao';

const NUMERICO = 'font-mono text-code-sm tabular-nums';

const Linha = ({ rotulo, children }: { rotulo: string; children: React.ReactNode }) => (
  <div className="flex flex-col gap-xs border-b border-border py-sm last:border-b-0 tablet:flex-row tablet:gap-md">
    <dt className="text-label-md text-muted-foreground tablet:w-[13rem] tablet:shrink-0">{rotulo}</dt>
    <dd className="min-w-0 text-body-md text-foreground">{children}</dd>
  </div>
);

export const ResumoDaNfe = ({ extracao }: { extracao: NfeExtractionDto }) => {
  const total = extracao.items.length;
  const comGrupo = extracao.items.filter((item) => item.ibsCbs !== null).length;
  const { layout, declaredTotals } = extracao;

  return (
    <section aria-label="O que a NF-e informa" className="flex flex-col gap-sm rounded-lg border border-border bg-card p-md">
      <h3 className="text-headline-sm text-foreground">O que a NF-e informa</h3>
      <dl className="flex flex-col">
        <Linha rotulo="Leiaute aceito">
          NF-e {layout.nfeVersion} · NT {layout.nt} v{layout.ntVersion}
        </Linha>
        <Linha rotulo="Emissão (fato gerador)">
          <span className={NUMERICO}>{formatarDataCivil(extracao.issueDate)}</span>
        </Linha>
        <Linha rotulo="Regime">
          {extracao.regime === null ? (
            <span className="text-warning-foreground">Regime não mapeável pelo XML: informe no complemento.</span>
          ) : (
            ROTULO_DO_REGIME[extracao.regime]
          )}
        </Linha>
        <Linha rotulo="Itens">
          {total === 1 ? '1 item' : `${total} itens`}
          {' · '}
          {comGrupo === total
            ? 'todos com o grupo IBS/CBS'
            : comGrupo === 0
              ? 'nenhum com o grupo IBS/CBS (a base vem do complemento)'
              : `${comGrupo} com o grupo IBS/CBS; os demais pedem a base no complemento`}
        </Linha>
        {declaredTotals === null ? (
          <Linha rotulo="Totais declarados">O documento não traz os totais IBS/CBS.</Linha>
        ) : (
          <Linha rotulo="Totais declarados">
            IBS{' '}
            <span className={NUMERICO}>{declaredTotals.ibsCents === null ? 'não informado' : formatarCentavos(declaredTotals.ibsCents)}</span>
            {' · '}CBS{' '}
            <span className={NUMERICO}>{declaredTotals.cbsCents === null ? 'não informado' : formatarCentavos(declaredTotals.cbsCents)}</span>
          </Linha>
        )}
      </dl>
    </section>
  );
};
