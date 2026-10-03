/**
 * Peças de um item do cofre, reaproveitadas pela linha da tabela e pelo cartão
 * (a tabela vira cartões abaixo de 1024px). Só metadados (SPEC-011 §5.2).
 *
 * Cor nunca é o único sinal (SPEC-011 §5.3): todo estado tem rótulo, e o prazo
 * vem por extenso ("Venceu há 3 dias"), não só pela cor do ponto.
 */
'use client';

import type { ItemDoCofre } from '@contaia/shared';
import { KeyRound } from 'lucide-react';

import { StatusBadge, type TomDoStatus } from '@/components/ui/status-badge';
import { juntar } from './estilos';
import { cnpjFormatado } from '../carteira/rotulos';
import { rotuloDoRegime } from '../empresa/rotulos';
import {
  APRESENTACAO_DA_SITUACAO_DO_RESPONSAVEL,
  APRESENTACAO_DO_ESTADO,
  formatarDataCivil,
  formatarDiaDoInstante,
  impressaoDigitalCurta,
  iniciaisDe,
  prazoEmTexto,
} from './apresentacao';

const COR_DO_PRAZO: Readonly<Record<TomDoStatus, string>> = {
  conforme: 'text-muted-foreground',
  atencao: 'text-warning-foreground',
  critico: 'text-danger-foreground',
  processando: 'text-muted-foreground',
  ia: 'text-muted-foreground',
  neutro: 'text-muted-foreground',
};

/**
 * A linha que vence ou venceu é tingida com o mesmo token do badge de estado: no tema claro
 * o fundo do badge sumia na linha e sobrava só o texto. O contorno na cor do próprio rótulo
 * mantém o selo legível sobre qualquer fundo, nos dois temas, sem trocar a cor do estado.
 */
const CONTORNO_DO_ESTADO = 'ring-1 ring-inset ring-current/25';

const Vazio = ({ texto = '—' }: { texto?: string }) => (
  <span className="text-body-sm text-muted-foreground">{texto}</span>
);

/** O CN do certificado ICP-Brasil termina em `:CNPJ`; o CNPJ já está na coluna da empresa. */
const titularLegivel = (titular: string): string => titular.replace(/:\d{14}$/u, '');

const EstadoDoItem = ({ item }: { item: ItemDoCofre }) => {
  const estado = APRESENTACAO_DO_ESTADO[item.estado];
  const desde = item.estado === 'DESATIVADO' ? item.certificado?.encerradoEm : null;

  return (
    <div className="flex flex-col items-start gap-xs">
      <StatusBadge tom={estado.tom} rotulo={estado.rotulo} className={CONTORNO_DO_ESTADO} />
      {desde === null || desde === undefined ? null : (
        <span className="text-body-sm text-muted-foreground">desde {formatarDiaDoInstante(desde)}</span>
      )}
    </div>
  );
};

export const EmpresaDoItem = ({
  item,
  aoAbrir,
}: {
  item: ItemDoCofre;
  aoAbrir: (empresaId: string) => void;
}) => (
  <div className="flex min-w-0 flex-col gap-xs">
    <button
      type="button"
      onClick={() => aoAbrir(item.empresaId)}
      aria-label={`Ver detalhes do certificado de ${item.empresaNome}`}
      className={juntar(
        'w-fit max-w-full rounded-sm text-left text-title-sm text-foreground [overflow-wrap:anywhere]',
        'underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      )}
    >
      {item.empresaNome}
    </button>
    <span className="flex flex-wrap items-center gap-x-sm gap-y-xs">
      <span className="font-mono text-code-xs tabular-nums text-muted-foreground">
        {cnpjFormatado(item.cnpj)}
      </span>
      {item.regime === null ? null : (
        <span className="rounded-sm bg-muted px-sm py-xs text-label-sm text-muted-foreground">
          {rotuloDoRegime(item.regime)}
        </span>
      )}
    </span>
  </div>
);

export const CertificadoDoItem = ({ item }: { item: ItemDoCofre }) => {
  const certificado = item.certificado;

  if (certificado === null) {
    return <Vazio texto="Nenhum certificado vigente" />;
  }

  return (
    <div className="flex min-w-0 flex-col gap-xs">
      <span className="flex items-start gap-xs text-body-sm text-foreground">
        <KeyRound className="mt-xs size-icon-xs shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="[overflow-wrap:anywhere]">{titularLegivel(certificado.titular)}</span>
      </span>
      <span className="text-body-sm text-muted-foreground [overflow-wrap:anywhere]">
        {certificado.autoridadeCertificadora}
      </span>
      <span
        className="font-mono text-code-xs tabular-nums text-muted-foreground"
        title={`Impressão digital completa: ${certificado.impressaoDigital}`}
      >
        <span className="sr-only">Impressão digital </span>
        {impressaoDigitalCurta(certificado.impressaoDigital)}
      </span>
    </div>
  );
};

/**
 * Situação e validade na mesma célula: o estado diz o que fazer, a data diz até quando.
 * Um certificado desativado não tem validade a mostrar — só desde quando está desativado.
 */
export const SituacaoDoItem = ({ item }: { item: ItemDoCofre }) => (
  <div className="flex flex-col items-start gap-sm">
    <EstadoDoItem item={item} />
    {item.certificado === null || item.estado === 'DESATIVADO' ? null : (
      <ValidadeDoItem item={item} />
    )}
  </div>
);

const ValidadeDoItem = ({ item }: { item: ItemDoCofre }) => {
  if (item.certificado === null) {
    return <Vazio />;
  }

  const tom = APRESENTACAO_DO_ESTADO[item.estado].tom;
  const prazo = prazoEmTexto(item.diasParaVencer);

  return (
    <div className="flex flex-col gap-xs">
      <span className="font-mono text-code-sm tabular-nums text-foreground">
        <span className="sr-only">Válido até </span>
        {formatarDataCivil(item.certificado.validoAte)}
      </span>
      {prazo === null ? null : (
        <span className={juntar('text-body-sm', COR_DO_PRAZO[tom])}>{prazo}</span>
      )}
    </div>
  );
};

export const ResponsavelDoItem = ({ item }: { item: ItemDoCofre }) => {
  const responsavel = item.responsavel;

  if (item.semResponsavel) {
    const motivo =
      responsavel === null
        ? null
        : `Antes: ${responsavel.nome} (${APRESENTACAO_DA_SITUACAO_DO_RESPONSAVEL[responsavel.situacao].rotulo.toLowerCase()})`;

    return (
      <div className="flex flex-col items-start gap-xs">
        <StatusBadge tom="atencao" rotulo="Sem responsável ativo" className="whitespace-normal" />
        {motivo === null ? null : (
          <span className="text-body-sm text-muted-foreground [overflow-wrap:anywhere]">{motivo}</span>
        )}
      </div>
    );
  }

  if (responsavel === null || item.certificado === null) {
    return <Vazio />;
  }

  return (
    <div className="flex min-w-0 items-center gap-sm">
      <span
        className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-code-xs text-foreground"
        aria-hidden="true"
      >
        {iniciaisDe(responsavel.nome)}
      </span>
      <span className="min-w-0 text-body-sm text-foreground break-words hyphens-auto">{responsavel.nome}</span>
    </div>
  );
};

/**
 * Fundo tingido só do que vence ou venceu: reforço do badge, nunca substituto dele
 * (COMPONENTS.md §3.1). "Sem certificado" não tinge — com centenas de empresas, uma
 * lista inteira amarela esconderia o que de fato pede ação hoje.
 */
export const tingimentoDoItem = (item: ItemDoCofre): string | null => {
  if (item.estado === 'VENCIDO' || item.estado === 'VENCE_D7') {
    return 'bg-danger';
  }

  return item.estado === 'VENCE_D15' || item.estado === 'VENCE_D30' ? 'bg-warning' : null;
};
