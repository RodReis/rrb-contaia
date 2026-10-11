/**
 * Histórico de importações da empresa (SPEC-013/014 §3.9): 15 por página, da mais recente para a mais
 * antiga, página na URL. Cada linha abre a tentativa com o resumo e o relatório. Se a leitura
 * falha, só esta seção mostra o erro: a importação e a base continuam usáveis.
 */
'use client';

import type { TentativaDoHistorico } from '@contaia/shared';
import { ArrowRight, History } from 'lucide-react';
import { clsx } from 'clsx';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { EmptyState, ErroDeTela, Skeleton } from '@/components/ui/estados';
import { StatusBadge } from '@/components/ui/status-badge';
import { ErroDaApi } from '@/lib/http';
import { mensagemDoCodigo } from '@/lib/mensagens';
import { cn } from '@/lib/cn';
import { APARENCIA_DO_ESTADO, formatarInstante, formatarNumero } from './apresentacao';
import type { DominioDaImportacao } from './dominio';
import { Paginacao, RegiaoRolavel, Secao } from './pecas';
import { useHistorico } from './queries';
import type { EstadoNaUrl } from './use-estado-na-url';

export const TENTATIVAS_POR_PAGINA = 15;

const quemDecidiu = (tentativa: TentativaDoHistorico): string | null => {
  const outro = tentativa.usuarioConfirmadorOuCancelador;

  if (outro === null || outro.id === tentativa.usuarioIniciador.id) {
    return null;
  }

  if (tentativa.estado === 'CANCELADA') {
    return `cancelada por ${outro.nome}`;
  }

  // FALHA depois da confirmação: houve a decisão, mas nada foi aplicado.
  return tentativa.estado === 'FALHA' ? `confirmação tentada por ${outro.nome}` : `confirmada por ${outro.nome}`;
};

// `clsx`, não `cn`: o tailwind-merge trata `text-code-sm` e a cor como o mesmo grupo e descartaria o tamanho.
const Numero = ({ valor, critico = false }: { valor: number; critico?: boolean }) => (
  <td
    className={clsx(
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
      <th scope="row" className="px-md py-sm text-left font-normal">
        {/* Uma linha só: nome longo termina em reticências e segue inteiro no título e no botão "Abrir". */}
        <span title={tentativa.arquivo.nome} className="block max-w-[14rem] truncate font-mono text-code-sm text-foreground">
          {tentativa.arquivo.nome}
        </span>
        {tentativa.reutilizadaPorIdempotencia ? (
          <span className="text-body-sm text-muted-foreground">Resultado reaproveitado</span>
        ) : null}
      </th>
      {/* `text-label-sm` na célula: o selo herda daqui o tamanho do contrato (COMPONENTS §3.4), que o
          tailwind-merge descarta dentro do próprio StatusBadge (achado global, fora desta fatia). Sem isso
          o selo sai no corpo de 16 px e empurra "Abrir" para fora da tabela em 1024/1440. */}
      <td className="px-md py-sm text-label-sm">
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

export const HistoricoDeImportacoes = ({
  dominio,
  empresaId,
  url,
}: {
  dominio: DominioDaImportacao;
  empresaId: string;
  url: EstadoNaUrl;
}) => {
  const consulta = useHistorico(dominio, empresaId, url.paginaDoHistorico);
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
      <RegiaoRolavel
        rotulo="Tabela das tentativas, rolável na horizontal"
        className={cn(consulta.isPlaceholderData && 'opacity-60 transition-opacity duration-fast')}
      >
        <table className="w-full text-left">
          <caption className="sr-only">
            {dominio.textos.legendaDoHistorico}, página {dados.pagina}
          </caption>
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
      </RegiaoRolavel>
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
