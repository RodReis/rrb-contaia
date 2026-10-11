/**
 * Resumo da tentativa (SPEC-013/014 §3.5): arquivo e instante, mapeamento usado e os totais de lidas,
 * novas, atualizadas e rejeitadas, e o `correlationId` da tentativa (§3.9), copiável. Segue a faixa
 * de metadados do cartão do protótipo, sem as métricas que ele inventava ("vetorizadas",
 * percentual de garantia) e sem barra de proporção (FRONTEND.md §16/§21: o número já está escrito).
 */
import { EyeOff, Recycle } from 'lucide-react';
import type { ReactNode } from 'react';

import { tamanhoEmTexto } from '@/lib/arquivo';
import { cn } from '@/lib/cn';
import { formatarInstante, formatarNumero, hashCurto, plural } from './apresentacao';
import {
  colunaDoMapeamento,
  ehPlanilha,
  quantidadeDoDiagnostico,
  resumoDasLinhas,
  rotuloDaAba,
} from './apresentacao-da-planilha';
import type { DominioDaImportacao, PreviaBase, Totais } from './dominio';
import { CodigoDeSuporte } from './pecas';

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
const aproveitamento = (totais: Totais, previstas: string | null): string => {
  const validas = totais.novas + totais.atualizadas;

  if (totais.lidas === 0) {
    return 'Nenhuma linha lida.';
  }

  const frase = `${plural(validas, 'linha válida', 'linhas válidas')} de ${plural(totais.lidas, 'lida', 'lidas')}.`;

  return previstas === null ? frase : `${frase} ${previstas}`;
};

const Detalhe = ({ rotulo, children }: { rotulo: string; children: ReactNode }) => (
  <div className="flex min-w-0 max-w-full flex-col gap-xs">
    <dt className="text-label-sm uppercase text-muted-foreground">{rotulo}</dt>
    {children}
  </div>
);

/**
 * O que a leitura da planilha decidiu (SPEC-015 §3.7): formato, aba, cabeçalho, linhas ignoradas e
 * ocultas, e as linhas rejeitadas por fórmula ou mescla. Linha oculta é sinalizada (ícone e texto):
 * ela entrou na validação como qualquer outra.
 */
const PlanilhaLida = ({ previa }: { previa: PreviaBase }) => {
  const ignoradas = previa.linhasIgnoradasAntesDoCabecalho ?? 0;
  const ocultas = previa.linhasOcultas ?? 0;
  const formulas = quantidadeDoDiagnostico(previa.diagnosticosDaPlanilha, 'LINHAS_COM_FORMULA_REJEITADAS');
  const mesclas = quantidadeDoDiagnostico(previa.diagnosticosDaPlanilha, 'LINHAS_COM_CELULA_MESCLADA_REJEITADAS');
  const aba = previa.aba ?? null;

  return (
    <div role="group" aria-label="Planilha lida" className="flex flex-col gap-sm rounded-md border border-border px-md py-sm">
      {/* Cada detalhe na largura do próprio conteúdo, quebrando para a linha de baixo quando não cabe:
          a grade de 4 colunas pela largura da janela espremia a aba no cartão estreito (1024 px). */}
      <dl className="flex flex-wrap gap-x-xl gap-y-md">
        <Detalhe rotulo="Formato">
          <dd className="font-mono text-code-sm text-foreground">{previa.formato}</dd>
        </Detalhe>
        <Detalhe rotulo="Aba">
          <dd title={aba === null ? undefined : rotuloDaAba(aba)} className="truncate text-body-sm text-foreground">
            {aba === null ? '—' : rotuloDaAba(aba)}
          </dd>
        </Detalhe>
        <Detalhe rotulo="Cabeçalho">
          <dd className="text-body-sm tabular-nums text-foreground">{`Linha ${formatarNumero(previa.linhaCabecalho ?? 1)}`}</dd>
        </Detalhe>
        <Detalhe rotulo="Linhas fora dos dados">
          <dd className="flex items-start gap-xs text-body-sm text-foreground">
            {ocultas > 0 ? <EyeOff className="mt-xs size-icon-xs shrink-0 text-warning-foreground" aria-hidden="true" /> : null}
            <span>{resumoDasLinhas(ignoradas, ocultas)}</span>
          </dd>
        </Detalhe>
      </dl>
      <p className="text-body-sm text-muted-foreground">
        {formulas === 0 && mesclas === 0
          ? 'Nenhuma linha rejeitada por fórmula ou célula mesclada.'
          : [
              formulas > 0 ? plural(formulas, 'linha rejeitada por fórmula', 'linhas rejeitadas por fórmula') : '',
              mesclas > 0 ? plural(mesclas, 'linha rejeitada por célula mesclada', 'linhas rejeitadas por célula mesclada') : '',
            ]
              .filter((frase) => frase !== '')
              .join(' · ')}
      </p>
    </div>
  );
};

export const ResumoDaTentativa = ({
  dominio,
  previa,
  mostrarCodigoDeSuporte = true,
}: {
  dominio: DominioDaImportacao;
  previa: PreviaBase;
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
            {previa.formato === undefined ? null : `${previa.formato} · `}
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
              {dominio.campos.map((campo) => (
                <li key={campo} className="flex flex-wrap gap-xs">
                  <span className="text-muted-foreground">{dominio.rotuloDoCampo(campo)}:</span>
                  <span className="font-mono text-code-sm text-foreground [overflow-wrap:anywhere]">
                    {colunaDoMapeamento(previa.formato, previa.mapeamento[campo])}
                  </span>
                </li>
              ))}
            </ul>
          </dd>
        </div>
      </dl>

      {ehPlanilha(previa.formato) ? <PlanilhaLida previa={previa} /> : null}

      {previa.reutilizadaPorIdempotencia ? (
        <p className="flex items-start gap-xs rounded-md bg-info px-md py-sm text-body-sm text-info-foreground">
          <Recycle className="mt-xs size-icon-xs shrink-0" aria-hidden="true" />
          {ehPlanilha(previa.formato)
            ? 'Este arquivo, com a mesma aba, o mesmo cabeçalho e o mesmo mapeamento, já tinha sido processado: o resultado foi reaproveitado, sem nova aplicação nem nova notificação.'
            : 'Este arquivo, com o mesmo mapeamento, já tinha sido processado: o resultado foi reaproveitado, sem nova aplicação nem nova notificação.'}
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
          <p className="text-body-sm text-muted-foreground">
            {aproveitamento(previa.totais, previstas ? dominio.textos.previstasNaoAplicadas : null)}
          </p>
        </div>
      )}
    </div>
  );
};
