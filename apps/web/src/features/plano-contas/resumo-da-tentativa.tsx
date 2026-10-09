/**
 * Resumo da tentativa (SPEC-013 §3.5): arquivo e instante, mapeamento usado e os totais de lidas,
 * novas, atualizadas e rejeitadas, e o `correlationId` da tentativa (§3.9), copiável. Segue a faixa
 * de metadados do cartão do protótipo, sem as métricas que ele inventava ("vetorizadas",
 * percentual de garantia) e sem barra de proporção (FRONTEND.md §16/§21: o número já está escrito).
 */
import { CAMPOS_DO_CONTRATO } from '@contaia/domain';
import type { PreviaDaImportacao } from '@contaia/shared';
import { Recycle } from 'lucide-react';

import { tamanhoEmTexto } from '@/lib/arquivo';
import { cn } from '@/lib/cn';
import { ROTULO_DO_CAMPO, formatarInstante, formatarNumero, hashCurto, plural } from './apresentacao';
import { CodigoDeSuporte } from './pecas';

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

/** Linhas aproveitáveis, em texto: a contagem é a informação (sem barra decorativa). */
const aproveitamento = (totais: Totais, previstas: boolean): string => {
  const validas = totais.novas + totais.atualizadas;

  if (totais.lidas === 0) {
    return 'Nenhuma linha lida.';
  }

  const frase = `${plural(validas, 'linha válida', 'linhas válidas')} de ${formatarNumero(totais.lidas)} lidas.`;

  return previstas ? `${frase} Nenhuma foi aplicada: a aplicação falhou e o plano não mudou.` : frase;
};

export const ResumoDaTentativa = ({
  previa,
  mostrarCodigoDeSuporte = true,
}: {
  previa: PreviaDaImportacao;
  /** Falso quando quem hospeda o resumo já mostra o código junto da mensagem da falha. */
  mostrarCodigoDeSuporte?: boolean;
}) => {
  // Na FALHA da aplicação os totais são os da prévia: o que entraria, não o que entrou.
  const previstas = previa.estado === 'FALHA';

  return (
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
          {mostrarCodigoDeSuporte ? (
            <dd className="text-body-sm text-muted-foreground">
              <CodigoDeSuporte valor={previa.correlationId} />
            </dd>
          ) : null}
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
            <Total rotulo={previstas ? 'Novas previstas' : 'Novas'} valor={previa.totais.novas} />
            <Total rotulo={previstas ? 'Atualizadas previstas' : 'Atualizadas'} valor={previa.totais.atualizadas} />
            <Total rotulo="Rejeitadas" valor={previa.totais.rejeitadas} destaque="critico" />
          </dl>
          <p className="text-body-sm text-muted-foreground">{aproveitamento(previa.totais, previstas)}</p>
        </div>
      )}
    </div>
  );
};
