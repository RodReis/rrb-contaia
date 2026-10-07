/**
 * Coluna `Signer mTLS` por empresa (SPEC-012 §5.2), reaproveitada pela linha da tabela e pelo
 * cartão abaixo de 1024px. DF-e e eSocial aparecem separados, cada um com estado, último teste e
 * latência; o resumo é o pior estado das duas. O estado vai em texto e em ícone de forma
 * diferente, nunca só em cor.
 *
 * A falta de dado é dita: carregando tem esqueleto, falha de leitura diz que o estado está
 * indisponível e, com um estado anterior em mãos, ele é mantido e marcado como desatualizado.
 */
'use client';

import type { EstadoDaEmpresaNoSigner, EstadoDaFinalidadeNoSigner } from '@contaia/shared';
import { CircleCheck, CircleDashed, CircleMinus, CircleX, PanelRightOpen } from 'lucide-react';
import type { ComponentType } from 'react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/estados';
import { StatusBadge } from '@/components/ui/status-badge';

import { juntar } from '../estilos';
import {
  APRESENTACAO_DA_FINALIDADE_NO_SIGNER,
  ROTULO_DA_FINALIDADE,
  mensagemDoSigner,
  textoDaLatencia,
  textoDoUltimoTeste,
} from './apresentacao';

export type SituacaoDaLeitura = 'carregando' | 'falha' | 'pronto';

const ICONE: Readonly<Record<EstadoDaFinalidadeNoSigner, ComponentType<{ className?: string }>>> = {
  OPERACIONAL: CircleCheck,
  FALHA: CircleX,
  NAO_TESTADO: CircleDashed,
  SEM_CERTIFICADO: CircleMinus,
};

const COR_DO_ICONE: Readonly<Record<EstadoDaFinalidadeNoSigner, string>> = {
  OPERACIONAL: 'text-success-indicator',
  FALHA: 'text-danger-indicator',
  NAO_TESTADO: 'text-muted-foreground',
  SEM_CERTIFICADO: 'text-warning-indicator',
};

export const FinalidadeDoSigner = ({
  finalidade,
  comMotivo = false,
}: {
  finalidade: EstadoDaEmpresaNoSigner['finalidades'][number];
  /** No painel a falha traz o motivo acionável; na linha da tabela só o estado cabe. */
  comMotivo?: boolean;
}) => {
  const apresentacao = APRESENTACAO_DA_FINALIDADE_NO_SIGNER[finalidade.estado];
  const Icone = ICONE[finalidade.estado];

  return (
    <li className="flex flex-col gap-0.5">
      <p className="flex flex-wrap items-center gap-x-xs">
        <Icone className={juntar('size-icon-xs shrink-0', COR_DO_ICONE[finalidade.estado])} aria-hidden="true" />
        <span className="text-label-md text-foreground">{ROTULO_DA_FINALIDADE[finalidade.finalidade]}</span>
        <span className="text-body-sm text-foreground">{apresentacao.rotulo}</span>
      </p>
      {finalidade.estado === 'SEM_CERTIFICADO' ? null : (
        <p className="flex flex-wrap items-center gap-x-xs pl-5text-body-sm text-muted-foreground">
          <span className="tabular-nums">{textoDoUltimoTeste(finalidade.ultimoTesteEm)}</span>
          <span aria-hidden="true">·</span>
          <span className="tabular-nums">{textoDaLatencia(finalidade.latenciaMs)}</span>
        </p>
      )}
      {comMotivo && finalidade.estado === 'FALHA' && finalidade.codigo !== null ? (
        <p className="pl-5 text-body-sm text-foreground [overflow-wrap:anywhere]">
          {mensagemDoSigner(finalidade.codigo)}
        </p>
      ) : null}
    </li>
  );
};

export const EstadoNaLinha = ({
  empresaId,
  empresaNome,
  estado,
  situacao,
  aoAbrir,
}: {
  empresaId: string;
  empresaNome: string;
  estado: EstadoDaEmpresaNoSigner | undefined;
  situacao: SituacaoDaLeitura;
  aoAbrir: (empresaId: string) => void;
}) => {
  if (estado === undefined) {
    if (situacao === 'carregando') {
      return (
        <div className="flex flex-col gap-xs" aria-busy="true">
          <span className="sr-only">Carregando o estado do Signer da empresa</span>
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-28" />
        </div>
      );
    }

    return (
      <span className="text-body-sm text-muted-foreground">
        {situacao === 'falha' ? 'Estado indisponível agora' : '—'}
      </span>
    );
  }

  const resumo = APRESENTACAO_DA_FINALIDADE_NO_SIGNER[estado.resumo];

  return (
    <div className="flex flex-col items-start gap-sm">
      <div role="group" aria-label="Resumo do Signer mTLS" className="flex flex-wrap items-center gap-xs">
        <StatusBadge tom={resumo.tom} rotulo={resumo.rotulo} />
        {situacao === 'falha' ? (
          <span className="text-body-sm text-warning-foreground">Desatualizado</span>
        ) : null}
      </div>

      <ul className="flex flex-col gap-xs" aria-label="Finalidades do Signer mTLS">
        {estado.finalidades.map((finalidade) => (
          <FinalidadeDoSigner key={finalidade.finalidade} finalidade={finalidade} />
        ))}
      </ul>

      <Button
        variante="fantasma"
        tamanho="compacto"
        onClick={() => aoAbrir(empresaId)}
        aria-label={`Abrir o painel do Signer de ${empresaNome}`}
      >
        <PanelRightOpen aria-hidden="true" />
        Painel
      </Button>
    </div>
  );
};
