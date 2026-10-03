/**
 * Cartões-resumo do cofre (SPEC-011 §5.2, COMPONENTS.md §3.3 `KpiCard`): barra
 * de acento de 2px no token de status, rótulo, valor grande em `tabular-nums`,
 * texto de apoio e uma ação no rodapé que aplica o filtro correspondente na URL.
 *
 * O protótipo mostrava aqui o microserviço Signer e as procurações e-CAC; ambos
 * estão fora desta fatia (SPEC-011 §5.1), então os quatro cartões são só o que o
 * cofre sabe: quem está válido, quem vence, quem venceu e quem não tem certificado.
 */
'use client';

import type { ResumoDoCofre } from '@contaia/shared';
import { ArrowRight, CircleAlert, Clock, KeyRound, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';

import { Skeleton } from '@/components/ui/estados';
import { juntar } from './estilos';

type Acento = 'conforme' | 'atencao' | 'critico' | 'processando';

const CLASSE_DO_ACENTO: Readonly<Record<Acento, string>> = {
  conforme: 'bg-success-indicator',
  atencao: 'bg-warning-indicator',
  critico: 'bg-danger-indicator',
  processando: 'bg-info-indicator',
};

const CLASSE_DO_ICONE: Readonly<Record<Acento, string>> = {
  conforme: 'bg-success text-success-foreground',
  atencao: 'bg-warning text-warning-foreground',
  critico: 'bg-danger text-danger-foreground',
  processando: 'bg-info text-info-foreground',
};

const Acao = ({ rotulo, aoAcionar }: { rotulo: string; aoAcionar: () => void }) => (
  <button
    type="button"
    onClick={aoAcionar}
    className={juntar(
      'inline-flex items-center gap-xs rounded-sm text-label-md text-foreground underline-offset-2',
      'hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      'focus-visible:ring-offset-2 focus-visible:ring-offset-card',
    )}
  >
    {rotulo}
    <ArrowRight className="size-icon-xs" aria-hidden="true" />
  </button>
);

const Cartao = ({
  rotulo,
  icone,
  acento,
  valor,
  complemento,
  apoio,
  rodape,
  filho,
}: {
  rotulo: string;
  icone: ReactNode;
  acento: Acento;
  valor: number;
  complemento: string;
  apoio: string;
  rodape: ReactNode;
  filho?: ReactNode;
}) => (
  <li className="relative flex flex-col justify-between gap-md overflow-hidden rounded-xl border border-border bg-card p-lg shadow-[var(--elevation-1)]">
    <span className={juntar('absolute inset-x-0 top-0 h-0.5', CLASSE_DO_ACENTO[acento])} aria-hidden="true" />
    <div className="flex items-start justify-between gap-sm">
      <h3 className="text-label-sm uppercase text-muted-foreground">{rotulo}</h3>
      <span
        className={juntar('flex size-8 shrink-0 items-center justify-center rounded-lg', CLASSE_DO_ICONE[acento])}
        aria-hidden="true"
      >
        {icone}
      </span>
    </div>
    <div className="flex flex-col gap-xs">
      <p className="flex flex-wrap items-baseline gap-x-sm">
        <span className="font-display text-headline-lg tabular-nums text-foreground">
          {valor.toLocaleString('pt-BR')}
        </span>
        <span className="text-body-md text-muted-foreground">{complemento}</span>
      </p>
      <p className="text-body-sm text-muted-foreground">{apoio}</p>
      {filho}
    </div>
    <div className="flex flex-wrap items-center gap-md">{rodape}</div>
  </li>
);

export const EsqueletoDosCartoes = () => (
  <div aria-busy="true" className="grid gap-md tablet:grid-cols-2 desktop:grid-cols-4">
    <span className="sr-only">Carregando o resumo do cofre</span>
    {Array.from({ length: 4 }, (_, indice) => (
      <Skeleton key={indice} className="h-44 w-full rounded-xl" />
    ))}
  </div>
);

export const CartoesDoResumo = ({
  resumo,
  aoFiltrar,
}: {
  resumo: ResumoDoCofre;
  /** Aplica estado e/ou ordem na URL da lista. */
  aoFiltrar: (estado: string | null, ordem: string | null) => void;
}) => {
  // Válido ou na janela de alerta: o certificado ainda vale. Vencido já não vale.
  const dentroDaValidade = resumo.validos + resumo.vencendo;
  const proporcao = resumo.total === 0 ? 0 : Math.min(1, dentroDaValidade / resumo.total);
  const percentual = Math.round(proporcao * 1000) / 10;

  return (
    <ul aria-label="Resumo do cofre" className="grid gap-md tablet:grid-cols-2 desktop:grid-cols-4">
      <Cartao
        rotulo="Certificados válidos"
        icone={<ShieldCheck className="size-icon-md" />}
        acento="conforme"
        valor={dentroDaValidade}
        complemento={`/ ${resumo.total.toLocaleString('pt-BR')} empresas`}
        apoio={`${percentual.toLocaleString('pt-BR')}% das empresas com certificado dentro da validade`}
        filho={
          <div
            role="progressbar"
            aria-label="Empresas com certificado dentro da validade"
            aria-valuemin={0}
            aria-valuemax={resumo.total}
            aria-valuenow={dentroDaValidade}
            className="mt-xs h-1.5 w-full overflow-hidden rounded-full bg-muted"
          >
            <div
              className="h-full origin-left rounded-full bg-success-indicator"
              style={{ transform: `scaleX(${proporcao})` }}
            />
          </div>
        }
        rodape={<Acao rotulo="Ver os válidos" aoAcionar={() => aoFiltrar('VALIDO', null)} />}
      />

      <Cartao
        rotulo="Vencem em até 30 dias"
        icone={<Clock className="size-icon-md" />}
        acento="atencao"
        valor={resumo.vencendo}
        complemento={resumo.vencendo === 1 ? 'certificado' : 'certificados'}
        apoio="Já entraram na janela de alerta de 30, 15 ou 7 dias. Renove antes do vencimento."
        rodape={
          <Acao rotulo="Ver por vencimento" aoAcionar={() => aoFiltrar(null, 'VENCIMENTO')} />
        }
      />

      <Cartao
        rotulo="Vencidos"
        icone={<CircleAlert className="size-icon-md" />}
        acento="critico"
        valor={resumo.vencidos}
        complemento={resumo.vencidos === 1 ? 'certificado' : 'certificados'}
        apoio={
          resumo.desativados === 0
            ? 'Nenhum certificado desativado.'
            : resumo.desativados === 1
              ? 'Há também 1 certificado desativado.'
              : `Há também ${resumo.desativados.toLocaleString('pt-BR')} certificados desativados.`
        }
        rodape={
          <>
            <Acao rotulo="Ver vencidos" aoAcionar={() => aoFiltrar('VENCIDO', null)} />
            <Acao rotulo="Ver desativados" aoAcionar={() => aoFiltrar('DESATIVADO', null)} />
          </>
        }
      />

      <Cartao
        rotulo="Sem certificado"
        icone={<KeyRound className="size-icon-md" />}
        acento="processando"
        valor={resumo.semCertificado}
        complemento={resumo.semCertificado === 1 ? 'empresa' : 'empresas'}
        apoio={
          resumo.semResponsavel === 0
            ? 'Todo certificado vigente tem responsável.'
            : resumo.semResponsavel === 1
              ? '1 certificado vigente está sem responsável.'
              : `${resumo.semResponsavel.toLocaleString('pt-BR')} certificados vigentes estão sem responsável.`
        }
        rodape={
          <>
            <Acao rotulo="Ver sem certificado" aoAcionar={() => aoFiltrar('SEM_CERTIFICADO', null)} />
            <Acao rotulo="Ver sem responsável" aoAcionar={() => aoFiltrar('SEM_RESPONSAVEL', null)} />
          </>
        }
      />
    </ul>
  );
};
