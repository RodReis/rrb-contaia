/**
 * Histórico de importações da empresa (SPEC-013 §3.9): 15 por página, da mais recente para a mais
 * antiga, página na URL. Cada linha abre a tentativa com o resumo e o relatório. Se a leitura
 * falha, só esta seção mostra o erro: a importação e o plano continuam usáveis.
 */
'use client';

import type { TentativaDoHistorico } from '@contaia/shared';
import { ArrowRight, History } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { EmptyState, ErroDeTela, Skeleton } from '@/components/ui/estados';
import { StatusBadge } from '@/components/ui/status-badge';
import { ErroDaApi } from '@/lib/http';
import { mensagemDoCodigo } from '@/lib/mensagens';
import { cn } from '@/lib/cn';
import { APARENCIA_DO_ESTADO, formatarInstante, formatarNumero } from './apresentacao';
import { Paginacao, Secao } from './pecas';
import { useHistoricoDoPlano } from './queries';
import type { EstadoNaUrl } from './use-estado-na-url';

export const TENTATIVAS_POR_PAGINA = 15;

const quemDecidiu = (tentativa: TentativaDoHistorico): string | null => {
  const outro = tentativa.usuarioConfirmadorOuCancelador;

  if (outro === null || outro.id === tentativa.usuarioIniciador.id) {
    return null;
  }

  return tentativa.estado === 'CANCELADA' ? `cancelada por ${outro.nome}` : `confirmada por ${outro.nome}`;
};

const Numero = ({ valor, critico = false }: { valor: number; critico?: boolean }) => (
  <td
    className={cn(
      'whitespace-nowrap px-md py-sm text-right font-mono text-code-sm tabular-nums',
      critico && valor > 0 ? 'text-danger-foreground' : 'text-foreground',
    )}
  >
    {formatarNumero(valor)}
  </td>
);

const Linha = ({
  tentativa,
  aberta,
  aoAbrir,
}: {
  tentativa: TentativaDoHistorico;
  aberta: boolean;
  aoAbrir: (id: string) => void;
}) => {
  const aparencia = APARENCIA_DO_ESTADO[tentativa.estado];
  const decisao = quemDecidiu(tentativa);

  return (
    <tr aria-current={aberta ? 'true' : undefined} className={cn('border-t border-border align-top', aberta ? 'bg-accent' : 'hover:bg-accent/40')}>
      <td className="whitespace-nowrap px-md py-sm font-mono text-code-sm tabular-nums text-muted-foreground">
        {formatarInstante(tentativa.inicioEm)}
      </td>
      <th scope="row" className="max-w-[16rem] px-md py-sm text-left font-normal">
        <span className="block font-mono text-code-sm text-foreground [overflow-wrap:anywhere]">{tentativa.arquivo.nome}</span>
        {tentativa.reutilizadaPorIdempotencia ? (
          <span className="text-body-sm text-muted-foreground">Resultado reaproveitado</span>
        ) : null}
      </th>
      <td className="px-md py-sm">
        <StatusBadge tom={aparencia.tom} rotulo={aparencia.rotulo} />
      </td>
      <Numero valor={tentativa.totais.novas} />
      <Numero valor={tentativa.totais.atualizadas} />
      <Numero valor={tentativa.totais.rejeitadas} critico />
      <td className="px-md py-sm text-body-sm text-foreground">
        {tentativa.usuarioIniciador.nome}
        {decisao === null ? null : <span className="block text-muted-foreground">{decisao}</span>}
      </td>
      <td className="px-md py-sm text-right">
        <Button
          variante="fantasma"
          tamanho="compacto"
          aria-label={`Abrir a importação de ${tentativa.arquivo.nome} enviada em ${formatarInstante(tentativa.inicioEm)}`}
          onClick={() => aoAbrir(tentativa.id)}
        >
          Abrir
          <ArrowRight aria-hidden="true" />
        </Button>
      </td>
    </tr>
  );
};

export const HistoricoDeImportacoes = ({ empresaId, url }: { empresaId: string; url: EstadoNaUrl }) => {
  const consulta = useHistoricoDoPlano(empresaId, url.paginaDoHistorico);
  const dados = consulta.data;

  const corpo = (): ReactNode => {
    if (dados === undefined && consulta.isPending) {
      return (
        <div className="flex flex-col gap-xs px-lg py-md" aria-busy="true">
          <span className="sr-only">Carregando o histórico de importações</span>
          {Array.from({ length: 4 }, (_, indice) => (
            <Skeleton key={indice} className="h-9 w-full" />
          ))}
        </div>
      );
    }

    if (dados === undefined || consulta.isError) {
      const problema = consulta.error instanceof ErroDaApi ? consulta.error.problema : null;

      return (
        <div className="px-lg py-md">
          <ErroDeTela
            titulo="Não foi possível carregar o histórico de importações"
            descricao={problema === null ? mensagemDoCodigo('FALHA_DE_REDE') : mensagemDoCodigo(problema.code)}
            correlationId={problema?.correlationId}
            acao={
              <Button variante="contorno" tamanho="compacto" onClick={() => void consulta.refetch()}>
                Tentar de novo
              </Button>
            }
          />
        </div>
      );
    }

    if (dados.itens.length === 0) {
      return (
        <div className="px-lg py-md">
          {dados.total > 0 ? (
            <EmptyState
              icone={<History />}
              titulo="Esta página não tem importações"
              descricao="O histórico tem tentativas, mas nenhuma nesta página. Volte à primeira para ver as mais recentes."
              acao={
                <Button variante="contorno" tamanho="compacto" onClick={() => url.irParaHistorico(1)}>
                  Voltar à primeira página
                </Button>
              }
            />
          ) : (
            <EmptyState
              icone={<History />}
              titulo="Nenhuma importação ainda"
              descricao="Cada envio de CSV aparece aqui, da mais recente para a mais antiga, com a situação, os totais e o relatório."
            />
          )}
        </div>
      );
    }

    return (
      <div className={cn('overflow-x-auto', consulta.isPlaceholderData && 'opacity-60 transition-opacity duration-fast')}>
        <table className="w-full text-left">
          <caption className="sr-only">Importações do plano de contas, página {dados.pagina}</caption>
          <thead className="bg-muted">
            <tr>
              <th scope="col" className="px-md py-sm text-label-sm uppercase text-muted-foreground">Enviada em</th>
              <th scope="col" className="px-md py-sm text-label-sm uppercase text-muted-foreground">Arquivo</th>
              <th scope="col" className="px-md py-sm text-label-sm uppercase text-muted-foreground">Situação</th>
              <th scope="col" className="px-md py-sm text-right text-label-sm uppercase text-muted-foreground">Novas</th>
              <th scope="col" className="px-md py-sm text-right text-label-sm uppercase text-muted-foreground">Atualizadas</th>
              <th scope="col" className="px-md py-sm text-right text-label-sm uppercase text-muted-foreground">Rejeitadas</th>
              <th scope="col" className="px-md py-sm text-label-sm uppercase text-muted-foreground">Enviada por</th>
              <th scope="col" className="px-md py-sm text-label-sm uppercase text-muted-foreground">
                <span className="sr-only">Ação</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {dados.itens.map((tentativa) => (
              <Linha key={tentativa.id} tentativa={tentativa} aberta={tentativa.id === url.tentativaId} aoAbrir={url.abrirTentativa} />
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <Secao
      id="historico-de-importacoes"
      icone={<History />}
      titulo="Histórico de importações"
      descricao="Quinze tentativas por página, da mais recente para a mais antiga."
    >
      {corpo()}
      {dados === undefined ? null : (
        <Paginacao
          rotulo="Paginação do histórico de importações"
          pagina={url.paginaDoHistorico}
          total={dados.total}
          porPagina={TENTATIVAS_POR_PAGINA}
          aoIr={url.irParaHistorico}
          unidade={dados.total === 1 ? 'importação' : 'importações'}
        />
      )}
    </Secao>
  );
};
