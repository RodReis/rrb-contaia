/**
 * Acompanhamento de uma tentativa aberta pela URL (`?tentativa=`): progresso enquanto o worker
 * valida, prévia para decidir, desfecho no fim (SPEC-013 §5.2 itens 5 a 9).
 *
 * A consulta se repete só enquanto há trabalho em curso (`refetchInterval`). O anúncio para
 * tecnologia assistiva sai de uma única região `aria-live="polite"` cujo texto depende só do
 * estado: cada nova consulta com o mesmo estado não repete nada.
 */
'use client';

import type { PreviaDaImportacao } from '@contaia/shared';
import { FileSearch, LoaderCircle } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { EmptyState, ErroDeTela, Skeleton } from '@/components/ui/estados';
import { StatusBadge } from '@/components/ui/status-badge';
import { ErroDaApi } from '@/lib/http';
import { mensagemDoCodigo } from '@/lib/mensagens';
import { avisarFalha } from '../escritorio/queries';
import { baixarArquivo, caminhoDoOriginal, caminhoDoRelatorio } from './api';
import { APARENCIA_DO_ESTADO, emAndamento, plural } from './apresentacao';
import { EtapasDaImportacao, etapaDoEstado } from './etapas';
import { BotaoDeDownload } from './pecas';
import type { PermissoesDoPlano } from './permissoes';
import { Previa } from './previa';
import { useTentativa } from './queries';
import { Resultado } from './resultado';
import type { EstadoNaUrl } from './use-estado-na-url';

const anuncioDo = (previa: PreviaDaImportacao): string => {
  switch (previa.estado) {
    case 'RECEBIDA':
      return 'Arquivo recebido. A validação vai começar.';
    case 'VALIDANDO':
      return 'Validando o arquivo.';
    case 'APLICANDO':
      return 'Aplicando as linhas válidas ao plano de contas.';
    case 'AGUARDANDO_CONFIRMACAO':
      return `Validação concluída: ${plural(previa.totais?.rejeitadas ?? 0, 'linha rejeitada', 'linhas rejeitadas')}. Revise a prévia e confirme ou cancele.`;
    default:
      return `Importação ${APARENCIA_DO_ESTADO[previa.estado].rotulo.toLowerCase()}.`;
  }
};

const nomeDoRelatorio = (previa: PreviaDaImportacao): string =>
  `relatorio-${previa.arquivo.nome.replace(/\.csv$/iu, '')}.csv`;

const Progresso = ({ previa }: { previa: PreviaDaImportacao }) => (
  <div className="flex flex-col items-center gap-md rounded-md border border-info-indicator/40 bg-info px-lg py-xl text-center">
    <LoaderCircle className="size-icon-xl text-info-foreground motion-safe:animate-spin" aria-hidden="true" />
    <div className="flex flex-col gap-xs">
      <p className="font-display text-headline-sm text-info-foreground">
        {previa.estado === 'APLICANDO' ? 'Aplicando ao plano de contas' : 'Validando o arquivo inteiro'}
      </p>
      <p className="mx-auto max-w-prose text-body-sm text-info-foreground">
        {previa.estado === 'APLICANDO'
          ? 'As linhas válidas entram numa única transação. O resultado aparece aqui assim que terminar.'
          : 'Cada linha é conferida contra o plano atual e contra as demais linhas do arquivo. Nada muda no plano antes da sua confirmação; você pode sair desta tela e voltar pelo histórico.'}
      </p>
    </div>
    <p className="font-mono text-code-xs text-info-foreground [overflow-wrap:anywhere]">{previa.arquivo.nome}</p>
  </div>
);

export const Acompanhamento = ({
  empresaId,
  tentativaId,
  permissoes,
  url,
}: {
  empresaId: string;
  tentativaId: string;
  permissoes: PermissoesDoPlano;
  url: EstadoNaUrl;
}) => {
  const consulta = useTentativa(empresaId, tentativaId);
  const previa = consulta.data;

  if (previa === undefined) {
    if (consulta.isPending) {
      return (
        <div className="flex flex-col gap-md px-lg py-lg" aria-busy="true">
          <span className="sr-only">Carregando a importação</span>
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      );
    }

    const problema = consulta.error instanceof ErroDaApi ? consulta.error.problema : null;

    return (
      <div className="px-lg py-lg">
        {problema?.code === 'TENTATIVA_NAO_ENCONTRADA' ? (
          <EmptyState
            icone={<FileSearch />}
            titulo="Importação não encontrada nesta empresa"
            descricao="O link aponta para uma tentativa que não pertence a esta empresa ou não existe. As importações desta empresa estão no histórico abaixo."
            acao={
              <Button variante="contorno" tamanho="compacto" onClick={url.fecharTentativa}>
                Voltar à importação
              </Button>
            }
          />
        ) : (
          <ErroDeTela
            titulo="Não foi possível carregar a importação"
            descricao={problema === null ? mensagemDoCodigo('FALHA_DE_REDE') : mensagemDoCodigo(problema.code)}
            correlationId={problema?.correlationId}
            acao={
              <Button variante="contorno" tamanho="compacto" onClick={() => void consulta.refetch()}>
                Tentar de novo
              </Button>
            }
          />
        )}
      </div>
    );
  }

  const relatorioDisponivel = permissoes.baixar && previa.relatorioDisponivel;
  const relatorio = relatorioDisponivel ? (
    <BotaoDeDownload
      rotulo="Baixar relatório CSV"
      caminho={caminhoDoRelatorio(empresaId, previa.tentativaId)}
      nomePadrao={nomeDoRelatorio(previa)}
      indisponivel="O relatório não está disponível agora; o histórico continua abaixo."
    />
  ) : null;
  const original = permissoes.baixar ? (
    <BotaoDeDownload
      rotulo="Baixar arquivo enviado"
      variante="fantasma"
      caminho={caminhoDoOriginal(empresaId, previa.tentativaId)}
      nomePadrao={previa.arquivo.nome}
      indisponivel="O arquivo enviado não está disponível agora."
    />
  ) : null;
  // Na confirmação parcial, o toast `warning` leva ao relatório (FRONTEND.md §13). A falha desse
  // atalho vira toast persistente com o código de suporte; o botão do relatório segue na tela.
  const baixarRelatorio = permissoes.baixar
    ? (): void => {
        void baixarArquivo(caminhoDoRelatorio(empresaId, previa.tentativaId), nomeDoRelatorio(previa)).catch(
          avisarFalha,
        );
      }
    : null;

  const corpo = (): ReactNode => {
    if (emAndamento(previa.estado)) {
      return <Progresso previa={previa} />;
    }

    if (previa.estado === 'AGUARDANDO_CONFIRMACAO') {
      return (
        <Previa
          empresaId={empresaId}
          previa={previa}
          permissoes={permissoes}
          paginaDasRejeicoes={url.paginaDasRejeicoes}
          aoIrParaRejeicoes={url.irParaRejeicoes}
          aoNovaImportacao={url.fecharTentativa}
          aoBaixarRelatorio={baixarRelatorio}
          relatorio={relatorio}
        />
      );
    }

    return (
      <Resultado
        empresaId={empresaId}
        previa={previa}
        podeImportar={permissoes.importar}
        paginaDasRejeicoes={url.paginaDasRejeicoes}
        aoIrParaRejeicoes={url.irParaRejeicoes}
        aoNovaImportacao={url.fecharTentativa}
        downloads={
          <>
            {relatorio}
            {original}
          </>
        }
      />
    );
  };

  return (
    <div className="flex flex-col gap-lg px-lg py-lg">
      <EtapasDaImportacao atual={etapaDoEstado(previa.estado)} />

      <div className="flex flex-wrap items-center gap-sm">
        <span className="text-label-sm uppercase text-muted-foreground">Situação</span>
        <StatusBadge tom={APARENCIA_DO_ESTADO[previa.estado].tom} rotulo={APARENCIA_DO_ESTADO[previa.estado].rotulo} />
      </div>

      <p role="status" aria-live="polite" className="sr-only">
        {anuncioDo(previa)}
      </p>

      {corpo()}
    </div>
  );
};
