/**
 * Desfecho da tentativa (SPEC-013 §3.11): concluída, concluída com rejeições, rejeitada,
 * cancelada ou falha técnica. Terminal não reabre: a saída é sempre uma nova tentativa. A falha
 * mostra o diagnóstico fechado da API e o `correlationId` copiável, nunca a mensagem crua.
 */
'use client';

import type { EstadoDaImportacao, PreviaDaImportacao } from '@contaia/shared';
import { Ban, CheckCircle2, CircleX, FileUp, OctagonAlert, TriangleAlert } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { mensagemDoCodigo } from '@/lib/mensagens';
import { cn } from '@/lib/cn';
import { plural } from './apresentacao';
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

const aplicadas = (totais: PreviaDaImportacao['totais']): string =>
  `${plural(totais?.novas ?? 0, 'conta nova incluída', 'contas novas incluídas')} e ${plural(
    totais?.atualizadas ?? 0,
    'atualizada',
    'atualizadas',
  )}`;

const desfechoDe = (previa: PreviaDaImportacao): Desfecho => {
  const estado: EstadoDaImportacao = previa.estado;

  switch (estado) {
    case 'CONCLUIDA':
      return {
        tom: 'conforme',
        icone: <CheckCircle2 />,
        titulo: 'Importação concluída',
        descricao: `${aplicadas(previa.totais)}. As contas que não estavam no arquivo continuam como estavam.`,
      };
    case 'CONCLUIDA_COM_REJEICOES':
      return {
        tom: 'atencao',
        icone: <TriangleAlert />,
        titulo: 'Importação concluída com rejeições',
        descricao: `${aplicadas(previa.totais)}. ${plural(
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
        descricao:
          previa.diagnostico?.mensagem ??
          'Nenhuma linha do arquivo pôde ser aplicada. Veja os motivos abaixo, corrija o CSV de origem e envie de novo. Enquanto a empresa não tiver nenhuma conta válida, a pendência de plano de contas segue aberta na Central de Pendências.',
      };
    case 'CANCELADA':
      return {
        tom: 'neutro',
        icone: <Ban />,
        titulo: 'Importação cancelada',
        descricao: 'O plano de contas não foi alterado. A tentativa, o arquivo e o relatório ficam no histórico.',
      };
    default:
      return {
        tom: 'critico',
        icone: <OctagonAlert />,
        titulo: 'A importação falhou por um problema técnico',
        descricao: previa.diagnostico?.mensagem ?? mensagemDoCodigo('FALHA_TECNICA'),
      };
  }
};

export const Resultado = ({
  empresaId,
  previa,
  podeImportar,
  paginaDasRejeicoes,
  aoIrParaRejeicoes,
  aoNovaImportacao,
  downloads,
}: {
  empresaId: string;
  previa: PreviaDaImportacao;
  podeImportar: boolean;
  paginaDasRejeicoes: number;
  aoIrParaRejeicoes: (pagina: number) => void;
  aoNovaImportacao: () => void;
  downloads: ReactNode;
}) => {
  const desfecho = desfechoDe(previa);
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
      <ResumoDaTentativa previa={previa} mostrarCodigoDeSuporte={previa.estado !== 'FALHA'} />

      <TabelaDeRejeicoes empresaId={empresaId} previa={previa} pagina={paginaDasRejeicoes} aoIr={aoIrParaRejeicoes} />

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
