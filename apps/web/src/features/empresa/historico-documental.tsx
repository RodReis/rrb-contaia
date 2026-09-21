/**
 * Histórico documental da empresa (SPEC-004 §3.2).
 *
 * Somente leitura, sem nenhuma ação de escrita: o histórico é append-only no
 * banco, e uma tela que oferecesse editar ou excluir prometeria o que o
 * servidor recusa.
 */
'use client';

import { ScrollText } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { EmptyState, ErroDeTela, Skeleton } from '@/components/ui/estados';
import { StatusBadge } from '@/components/ui/status-badge';
import { ErroDaApi } from '@/lib/http';
import { mensagemDoCodigo } from '@/lib/mensagens';
import type { AcaoDocumental } from './documentos-api';
import { LIMITE_DO_HISTORICO, useHistoricoDocumental } from './documentos-queries';
import { APARENCIA_DO_ESTADO } from './estado-do-documento';

const ROTULO_DA_ACAO: Readonly<Record<AcaoDocumental, string>> = {
  EXIGENCIA_CRIADA: 'Exigência criada',
  ENVIO: 'Arquivo enviado',
  SUBSTITUICAO: 'Arquivo substituído',
  APROVACAO: 'Documento aprovado',
  REJEICAO: 'Documento rejeitado',
  DISPENSA: 'Exigência dispensada',
  VENCIMENTO: 'Documento vencido',
  VISUALIZACAO: 'Documento visualizado',
  DOWNLOAD: 'Documento baixado',
};

const formatarMomento = (iso: string): string =>
  new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(iso));

export const HistoricoDocumental = ({ empresaId }: { empresaId: string }) => {
  const [deslocamento, definirDeslocamento] = useState(0);
  const { data, isPending, isError, error, refetch } = useHistoricoDocumental(
    empresaId,
    deslocamento,
  );

  if (isPending) {
    return (
      <div
        className="flex flex-col gap-sm rounded-lg border border-border bg-card p-lg"
        aria-busy="true"
        aria-live="polite"
      >
        <span className="sr-only">Carregando o histórico documental</span>
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
    );
  }

  if (isError) {
    const problema = error instanceof ErroDaApi ? error.problema : null;

    return (
      <ErroDeTela
        titulo="Não foi possível carregar o histórico"
        descricao={
          problema === null ? 'Tente novamente em instantes.' : mensagemDoCodigo(problema.code)
        }
        correlationId={problema?.correlationId}
        acao={
          <Button variante="contorno" tamanho="compacto" onClick={() => void refetch()}>
            Tentar de novo
          </Button>
        }
      />
    );
  }

  if (data.total === 0) {
    return (
      <EmptyState
        icone={<ScrollText />}
        titulo="Nenhum registro ainda"
        descricao="Envios, análises, visualizações e downloads desta empresa aparecem aqui, com autor e data."
      />
    );
  }

  const primeiro = deslocamento + 1;
  const ultimo = Math.min(deslocamento + LIMITE_DO_HISTORICO, data.total);

  return (
    <section className="flex flex-col gap-md rounded-lg border border-border bg-card p-lg">
      <div className="flex flex-col gap-xs">
        <h3 className="text-title-sm text-foreground">Histórico documental</h3>
        <p className="text-body-sm text-muted-foreground">
          Registro permanente. Nada aqui pode ser alterado ou excluído.
        </p>
      </div>

      {/*
        Tabela numa coluna só abaixo de 768px seria ilegível com cinco campos
        por linha; a lista de blocos preserva a ordem e a leitura.
      */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] border-collapse text-left">
          <caption className="sr-only">
            Eventos documentais da empresa, do mais recente para o mais antigo
          </caption>
          <thead>
            <tr className="border-b border-border">
              <th scope="col" className="px-sm py-sm text-label-sm text-muted-foreground">
                Quando
              </th>
              <th scope="col" className="px-sm py-sm text-label-sm text-muted-foreground">
                Exigência
              </th>
              <th scope="col" className="px-sm py-sm text-label-sm text-muted-foreground">
                Ação
              </th>
              <th scope="col" className="px-sm py-sm text-label-sm text-muted-foreground">
                Estado
              </th>
              <th scope="col" className="px-sm py-sm text-label-sm text-muted-foreground">
                Autor
              </th>
            </tr>
          </thead>
          <tbody>
            {data.eventos.map((evento) => {
              const aparencia =
                evento.estadoNovo === null ? null : APARENCIA_DO_ESTADO[evento.estadoNovo];

              return (
                <tr key={evento.id} className="border-b border-border last:border-b-0">
                  <td className="px-sm py-sm font-mono text-code-sm tabular-nums text-muted-foreground">
                    {formatarMomento(evento.ocorridoEm)}
                  </td>
                  <td className="px-sm py-sm text-body-sm text-foreground">
                    {evento.exigenciaNome}
                    {evento.versaoNumero === null ? null : (
                      <span className="ml-xs font-mono text-code-sm tabular-nums text-muted-foreground">
                        v{evento.versaoNumero}
                      </span>
                    )}
                  </td>
                  <td className="px-sm py-sm text-body-sm text-foreground">
                    {ROTULO_DA_ACAO[evento.acao]}
                    {evento.justificativa === null ? null : (
                      <span className="block text-body-sm text-muted-foreground">
                        {evento.justificativa}
                      </span>
                    )}
                  </td>
                  <td className="px-sm py-sm">
                    {aparencia === null ? (
                      <span className="text-body-sm text-muted-foreground">—</span>
                    ) : (
                      <StatusBadge tom={aparencia.tom} rotulo={aparencia.rotulo} />
                    )}
                  </td>
                  <td className="px-sm py-sm text-body-sm text-muted-foreground">
                    {/* Vencimento é apurado pela aplicação, sem autor humano. */}
                    {evento.usuarioNome ?? 'Sistema'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-sm">
        <p className="text-body-sm text-muted-foreground">
          <span className="font-mono tabular-nums">
            {primeiro}–{ultimo}
          </span>{' '}
          de <span className="font-mono tabular-nums">{data.total}</span>
        </p>

        <div className="flex gap-sm">
          <Button
            variante="contorno"
            tamanho="compacto"
            disabled={deslocamento === 0}
            onClick={() =>
              definirDeslocamento((atual) => Math.max(0, atual - LIMITE_DO_HISTORICO))
            }
          >
            Anterior
          </Button>
          <Button
            variante="contorno"
            tamanho="compacto"
            disabled={ultimo >= data.total}
            onClick={() => definirDeslocamento((atual) => atual + LIMITE_DO_HISTORICO)}
          >
            Próxima
          </Button>
        </div>
      </div>
    </section>
  );
};
