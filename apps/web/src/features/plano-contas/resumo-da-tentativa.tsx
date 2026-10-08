/**
 * Resumo da tentativa (SPEC-013 §3.5): arquivo e instante, mapeamento usado e os totais de lidas,
 * novas, atualizadas e rejeitadas. Segue a faixa de metadados do cartão do protótipo, sem as
 * métricas que ele inventava ("vetorizadas", percentual de garantia).
 */
import { CAMPOS_DO_CONTRATO } from '@contaia/domain';
import type { PreviaDaImportacao } from '@contaia/shared';
import { Recycle } from 'lucide-react';

import { tamanhoEmTexto } from '@/lib/arquivo';
import { cn } from '@/lib/cn';
import { ROTULO_DO_CAMPO, formatarInstante, formatarNumero, hashCurto, plural } from './apresentacao';

type Totais = NonNullable<PreviaDaImportacao['totais']>;

const Total = ({ rotulo, valor, destaque }: { rotulo: string; valor: number; destaque?: 'critico' }) => (
  <div className="flex flex-col gap-xs rounded-md border border-border bg-card px-md py-sm">
    <dt className="text-label-sm uppercase text-muted-foreground">{rotulo}</dt>
    <dd
      className={cn(
        'font-display text-headline-md tabular-nums',
        destaque === 'critico' && valor > 0 ? 'text-danger-foreground' : 'text-foreground',
      )}
    >
      {formatarNumero(valor)}
    </dd>
  </div>
);

/** Proporção de linhas aproveitáveis; o número vai junto, a barra só reforça (P-01: sem gráfico). */
const Proporcao = ({ totais }: { totais: Totais }) => {
  const validas = totais.novas + totais.atualizadas;
  const descricao =
    totais.lidas === 0
      ? 'Nenhuma linha lida.'
      : `${plural(validas, 'linha válida', 'linhas válidas')} de ${formatarNumero(totais.lidas)} lidas.`;

  return (
    <div className="flex flex-col gap-xs">
      <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label={descricao}>
        <span className="h-full bg-success-indicator" style={{ flexGrow: validas }} />
        <span className="h-full bg-danger-indicator" style={{ flexGrow: totais.rejeitadas }} />
      </div>
      <p className="text-body-sm text-muted-foreground" aria-hidden="true">
        {descricao}
      </p>
    </div>
  );
};

export const ResumoDaTentativa = ({ previa }: { previa: PreviaDaImportacao }) => (
  <div className="flex flex-col gap-md">
    <dl className="grid gap-md rounded-md bg-secondary px-md py-md tablet:grid-cols-3">
      <div className="flex min-w-0 flex-col gap-xs">
        <dt className="text-label-sm uppercase text-muted-foreground">Arquivo</dt>
        <dd className="font-mono text-code-sm text-foreground [overflow-wrap:anywhere]">{previa.arquivo.nome}</dd>
        <dd className="font-mono text-code-xs tabular-nums text-muted-foreground">
          {tamanhoEmTexto(previa.arquivo.tamanho)} · <span title={previa.arquivo.hash}>SHA-256 {hashCurto(previa.arquivo.hash)}</span>
        </dd>
      </div>
      <div className="flex flex-col gap-xs">
        <dt className="text-label-sm uppercase text-muted-foreground">Enviado em</dt>
        <dd className="font-mono text-code-sm tabular-nums text-foreground">{formatarInstante(previa.criadoEm)}</dd>
        {previa.finalizadoEm === null ? null : (
          <dd className="text-body-sm text-muted-foreground">
            Encerrada em <span className="font-mono text-code-xs tabular-nums">{formatarInstante(previa.finalizadoEm)}</span>
          </dd>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-xs">
        <dt className="text-label-sm uppercase text-muted-foreground">Mapeamento usado</dt>
        <dd>
          <ul className="flex flex-col gap-xs text-body-sm">
            {CAMPOS_DO_CONTRATO.map((campo) => (
              <li key={campo} className="flex flex-wrap gap-xs">
                <span className="text-muted-foreground">{ROTULO_DO_CAMPO[campo]}:</span>
                <span className="font-mono text-code-sm text-foreground [overflow-wrap:anywhere]">
                  {previa.mapeamento[campo] ?? '—'}
                </span>
              </li>
            ))}
          </ul>
        </dd>
      </div>
    </dl>

    {previa.reutilizadaPorIdempotencia ? (
      <p className="flex items-start gap-xs rounded-md bg-info px-md py-sm text-body-sm text-info-foreground">
        <Recycle className="mt-xs size-icon-xs shrink-0" aria-hidden="true" />
        Este arquivo, com o mesmo mapeamento, já tinha sido processado: o resultado foi reaproveitado, sem nova
        aplicação nem nova notificação.
      </p>
    ) : null}

    {previa.totais === null ? null : (
      <div className="flex flex-col gap-sm">
        <dl className="grid grid-cols-2 gap-sm tablet:grid-cols-4">
          <Total rotulo="Linhas lidas" valor={previa.totais.lidas} />
          <Total rotulo="Novas" valor={previa.totais.novas} />
          <Total rotulo="Atualizadas" valor={previa.totais.atualizadas} />
          <Total rotulo="Rejeitadas" valor={previa.totais.rejeitadas} destaque="critico" />
        </dl>
        <Proporcao totais={previa.totais} />
      </div>
    )}
  </div>
);
