/**
 * Desfecho da tentativa (SPEC-013/014 §3.11): concluída, concluída com rejeições, rejeitada,
 * cancelada ou falha técnica. Terminal não reabre: a saída é sempre uma nova tentativa. A falha
 * mostra o diagnóstico fechado da API e o `correlationId` copiável, nunca a mensagem crua.
 */
'use client';

import type { EstadoDaImportacao } from '@contaia/shared';
import { Ban, CheckCircle2, CircleX, FileUp, OctagonAlert, TriangleAlert } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { plural } from './apresentacao';
import type { DominioDaImportacao, PreviaBase } from './dominio';
import { CodigoDeSuporte } from './pecas';
import { ResumoDaTentativa } from './resumo-da-tentativa';
import { TabelaDeRejeicoes } from './tabela-de-rejeicoes';

type Tom = 'conforme' | 'atencao' | 'critico' | 'neutro';

const CLASSES_DO_TOM: Readonly<Record<Tom, string>> = {
  conforme: 'border-success-indicator/40 bg-success text-success-foreground',
  atencao: 'border-warning-indicator/40 bg-warning text-warning-foreground',
  critico: 'border-danger-indicator/40 bg-danger text-danger-foreground',
  neutro: 'border-border bg-secondary text-foreground',
};

type Desfecho = Readonly<{ tom: Tom; icone: ReactNode; titulo: string; descricao: string }>;

const desfechoDe = (dominio: DominioDaImportacao, previa: PreviaBase): Desfecho => {
  const { textos } = dominio;
  const estado: EstadoDaImportacao = previa.estado;

  switch (estado) {
    case 'CONCLUIDA':
      return {
        tom: 'conforme',
        icone: <CheckCircle2 />,
        titulo: 'Importação concluída',
        descricao: `${textos.aplicadas(previa.totais)}. ${textos.concluida}`,
      };
    case 'CONCLUIDA_COM_REJEICOES':
      return {
        tom: 'atencao',
        icone: <TriangleAlert />,
        titulo: 'Importação concluída com rejeições',
        descricao: `${textos.aplicadas(previa.totais)}. ${plural(
          previa.totais?.rejeitadas ?? 0,
          'linha rejeitada ficou',
          'linhas rejeitadas ficaram',
        )} de fora e está no relatório; corrija o CSV de origem e envie de novo para incluí-las.`,
      };
    case 'REJEITADA':
      return {
        tom: 'critico',
        icone: <CircleX />,
        titulo: 'Nenhuma linha foi aplicada',
        descricao: previa.diagnostico?.mensagem ?? textos.rejeitada,
      };
    case 'CANCELADA':
      return {
        tom: 'neutro',
        icone: <Ban />,
        titulo: 'Importação cancelada',
        descricao: textos.cancelada,
      };
    default:
      return {
        tom: 'critico',
        icone: <OctagonAlert />,
        titulo: 'A importação falhou por um problema técnico',
        descricao: previa.diagnostico?.mensagem ?? textos.falhaTecnica,
      };
  }
};

export const Resultado = ({
  dominio,
  empresaId,
  previa,
  podeImportar,
  paginaDasRejeicoes,
  aoIrParaRejeicoes,
  aoNovaImportacao,
  downloads,
}: {
  dominio: DominioDaImportacao;
  empresaId: string;
  previa: PreviaBase;
  podeImportar: boolean;
  paginaDasRejeicoes: number;
  aoIrParaRejeicoes: (pagina: number) => void;
  aoNovaImportacao: () => void;
  downloads: ReactNode;
}) => {
  const desfecho = desfechoDe(dominio, previa);
  const titulo = useRef<HTMLHeadingElement>(null);

  // O desfecho substitui a prévia (ou chega pelo link da notificação): o foco vai para ele, em vez
  // de cair no início da página com o botão que acabou de sumir.
  useEffect(() => {
    titulo.current?.focus();
  }, [previa.estado]);

  return (
    <div className="flex flex-col gap-lg">
      <div className={cn('flex flex-col gap-sm rounded-md border px-md py-md', CLASSES_DO_TOM[desfecho.tom])}>
        <div className="flex items-start gap-sm">
          <span className="mt-xs shrink-0 [&_svg]:size-icon-lg" aria-hidden="true">
            {desfecho.icone}
          </span>
          <div className="flex flex-col gap-xs">
            <h4 ref={titulo} tabIndex={-1} className="font-display text-headline-sm focus-visible:outline-none">
              {desfecho.titulo}
            </h4>
            <p className="max-w-prose text-body-md">{desfecho.descricao}</p>
            {previa.estado === 'FALHA' ? (
              <CodigoDeSuporte valor={previa.correlationId} className="text-body-sm" />
            ) : null}
          </div>
        </div>
      </div>

      {/* Na falha o código de suporte já está na mensagem persistente acima: uma vez só. */}
      <ResumoDaTentativa dominio={dominio} previa={previa} mostrarCodigoDeSuporte={previa.estado !== 'FALHA'} />

      <TabelaDeRejeicoes
        dominio={dominio}
        empresaId={empresaId}
        previa={previa}
        pagina={paginaDasRejeicoes}
        aoIr={aoIrParaRejeicoes}
      />

      <div className="flex flex-col gap-md border-t border-border pt-md tablet:flex-row tablet:items-start tablet:justify-between">
        <div className="flex flex-wrap gap-sm">{downloads}</div>
        {podeImportar ? (
          <Button tamanho="compacto" onClick={aoNovaImportacao}>
            <FileUp aria-hidden="true" />
            {previa.estado === 'FALHA' ? 'Enviar nova tentativa' : 'Nova importação'}
          </Button>
        ) : null}
      </div>
    </div>
  );
};
