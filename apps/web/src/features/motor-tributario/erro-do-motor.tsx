/**
 * Falha do motor como ESTADO PERSISTENTE da tela (SPEC-016 §5.3): toast não substitui estado. A
 * mensagem vem do `code` estável da API (FRONTEND.md §14), nunca do `title` cru; o `correlationId`
 * fica visível e copiável. "Nenhuma regra aplicável" é um resultado legítimo do motor, não uma
 * pane: ganha tom de atenção e a orientação de que nada foi calculado de forma improvisada.
 */
'use client';

import { CODIGOS_DE_ERRO } from '@contaia/domain';
import { CircleAlert, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';

import { ErroDaApi } from '@/lib/http';
import { mensagemDoCodigo } from '@/lib/mensagens';
import { CodigoDeSuporte } from '../importacao/pecas';
import { ROTULO_DO_TRIBUTO } from './apresentacao';

const MENSAGEM_GENERICA = 'Não foi possível concluir a operação. Tente de novo em instantes.';

/** A mensagem global de FALHA_TECNICA fala de importação de CSV; aqui a falha é do motor tributário. */
const MENSAGEM_DE_FALHA_TECNICA = 'O motor tributário falhou por um problema técnico. Nada foi alterado; tente de novo em instantes.';

const mensagemDoMotor = (code: string): string =>
  code === CODIGOS_DE_ERRO.FALHA_TECNICA ? MENSAGEM_DE_FALHA_TECNICA : mensagemDoCodigo(code);

/** Onde a falha aconteceu, quando a API diz (item da NF-e e tributo): ajuda a agir sem abrir o XML. */
const localDaFalha = (detalhes: Readonly<Record<string, unknown>> | undefined): string | null => {
  const item = detalhes?.['item'];
  const tributo = detalhes?.['taxType'];

  if (typeof item !== 'number') {
    return null;
  }

  const rotulo = typeof tributo === 'string' ? (ROTULO_DO_TRIBUTO[tributo as keyof typeof ROTULO_DO_TRIBUTO] ?? tributo) : null;

  return rotulo === null ? `Item ${item} da NF-e` : `Item ${item} da NF-e, tributo ${rotulo}`;
};

export const ErroDoMotor = ({
  erro,
  titulo,
  acao,
}: {
  erro: unknown;
  titulo: string;
  acao?: ReactNode;
}) => {
  const problema = erro instanceof ErroDaApi ? erro.problema : null;
  const semRegra = problema?.code === CODIGOS_DE_ERRO.TAX_RULE_NOT_APPLICABLE;
  const local = localDaFalha(problema?.detalhes);
  const Icone = semRegra ? TriangleAlert : CircleAlert;

  return (
    <div
      role={semRegra ? 'status' : 'alert'}
      className={
        semRegra
          ? 'flex flex-col gap-sm rounded-lg border border-warning-indicator/40 bg-warning p-md text-warning-foreground'
          : 'flex flex-col gap-sm rounded-lg border border-danger-indicator/40 bg-danger p-md text-danger-foreground'
      }
    >
      <div className="flex items-start gap-sm">
        <Icone className="mt-xs size-icon-md shrink-0" aria-hidden="true" />
        <div className="flex min-w-0 flex-col gap-xs">
          <p className="text-title-sm">{titulo}</p>
          <p className="text-body-sm">{problema === null ? MENSAGEM_GENERICA : mensagemDoMotor(problema.code)}</p>
          {local === null ? null : <p className="text-body-sm">Onde: {local}.</p>}
          {semRegra ? <p className="text-body-sm">Nenhum cálculo foi improvisado: sem regra publicada vigente, não há resultado.</p> : null}
        </div>
      </div>
      {problema === null ? null : <CodigoDeSuporte valor={problema.correlationId} className="text-body-sm" />}
      {acao}
    </div>
  );
};
