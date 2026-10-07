/**
 * Histórico completo de notificações (SPEC-006 §3, "Ver todas" do sino).
 *
 * Mesma estrutura de estado/paginação de `CentralDePendencias`
 * (`features/pendencias/central-de-pendencias.tsx`): página na URL via
 * `useSearchParams`/`router.replace`, 4 estados explícitos (carregando,
 * vazio, erro, sucesso — PATTERNS.md §5).
 *
 * Sem tela de referência no protótipo para este histórico (SPEC-006 §4.2
 * autoriza seguir DESIGN-SYSTEM.md quando o protótipo não cobre). Reusa as
 * decisões de cor já tomadas no sino (Task 8, `sino-de-notificacoes.tsx`):
 * indicador "não lida" com `bg-danger-indicator` — aqui sem texto sobre o
 * fundo (é só um ponto), então o achado de contraste texto-branco-sobre-
 * indicador da Task 8 não se aplica a este marcador.
 *
 * Comparação visual ao vivo (Playwright, ambos os temas) é responsabilidade
 * da Task 11 (impeccable) — não executada nesta task.
 *
 * Acabamento (Task 11, impeccable): `text-body-xs` (data/status de cada
 * linha) não existe em TOKENS.md §5.2 nem em `globals.css` (escala real é
 * `body-lg/md/sm`, `label-md/sm` — sem `body-xs`), então a classe Tailwind
 * não tinha efeito nenhum (tamanho herdado do pai). Trocado para `body-sm`
 * ("Texto de apoio, descrição"), o token correto para este uso.
 */
'use client';

import { Bell } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { EmptyState, ErroDeTela, Skeleton } from '@/components/ui/estados';
import { SemCarteira } from '@/components/ui/sem-carteira';
import { ErroDaApi } from '@/lib/http';
import { mensagemDoCodigo } from '@/lib/mensagens';

import Link from 'next/link';

import {
  ehAvisoDeCarteira,
  ehAvisoDoSigner,
  resumoDaCarteira,
  resumoDoSigner,
  rotaDaNotificacao,
  tipoDaNotificacao,
  tituloDaNotificacao,
} from './apresentacao';
import { useHistoricoDeNotificacoes } from './queries';

const POR_PAGINA = 25;

const formatarQuando = (isoString: string): string =>
  new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(isoString));

const EsqueletoDaLista = () => (
  <div className="flex flex-col gap-sm" aria-busy="true" aria-live="polite">
    <span className="sr-only">Carregando as notificações</span>
    {Array.from({ length: 6 }, (_, indice) => (
      <Skeleton key={indice} className="h-14 w-full" />
    ))}
  </div>
);

export const PaginaDeHistorico = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pagina = Math.max(0, Number(searchParams.get('pagina') ?? '0') || 0);

  const { data, isPending, isError, error, refetch } = useHistoricoDeNotificacoes(
    pagina,
    POR_PAGINA,
  );

  const irParaPagina = (proxima: number): void => {
    const parametros = new URLSearchParams(searchParams.toString());
    if (proxima <= 0) {
      parametros.delete('pagina');
    } else {
      parametros.set('pagina', String(proxima));
    }
    router.replace(`/notificacoes?${parametros.toString()}`, { scroll: false });
  };

  if (isError) {
    const problema = error instanceof ErroDaApi ? error.problema : null;

    return (
      <div className="flex flex-col gap-xl p-lg">
        <h1 className="font-display text-headline-lg text-foreground">Notificações</h1>
        <ErroDeTela
          nivel={2}
          titulo="Não foi possível carregar as notificações"
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
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-xl p-lg">
      <h1 className="font-display text-headline-lg text-foreground">Notificações</h1>

      {isPending ? (
        <EsqueletoDaLista />
      ) : data.escopoDeEmpresas === 'NENHUMA' ? (
        <SemCarteira descricao="Quando houver empresas na sua carteira, os avisos delas aparecem aqui." />
      ) : data.notificacoes.length === 0 ? (
        <EmptyState
          nivel={2}
          icone={<Bell />}
          titulo="Nenhuma notificação"
          descricao="Você será avisado quando houver pendências novas."
        />
      ) : (
        <>
          <ul role="list" className="divide-y divide-border rounded-lg border border-border bg-card">
            {data.notificacoes.map((notificacao) => (
              <li key={notificacao.id} className="flex items-center justify-between gap-md px-md py-sm">
                <div className="flex items-center gap-xs">
                  {!notificacao.lida ? (
                    <span
                      aria-hidden="true"
                      className="size-2 shrink-0 rounded-full bg-danger-indicator"
                    />
                  ) : null}
                  <div>
                    <p className="text-body-sm font-medium text-foreground">
                      {tituloDaNotificacao(notificacao)} — {tipoDaNotificacao(notificacao)}
                      {!notificacao.lida ? <span className="sr-only"> (não lida)</span> : null}
                    </p>
                    {ehAvisoDeCarteira(notificacao) ? (
                      <p className="break-words text-body-sm text-foreground">
                        {resumoDaCarteira(notificacao)}{' '}
                        <Link
                          href={rotaDaNotificacao(notificacao)}
                          className="underline underline-offset-2 hover:no-underline"
                        >
                          Ver minha carteira
                        </Link>
                      </p>
                    ) : null}
                    {ehAvisoDoSigner(notificacao) ? (
                      <p className="break-words text-body-sm text-foreground">
                        {resumoDoSigner(notificacao)}{' '}
                        <Link
                          href={rotaDaNotificacao(notificacao)}
                          className="underline underline-offset-2 hover:no-underline"
                        >
                          Ver o estado do Signer
                        </Link>
                      </p>
                    ) : null}
                    <p className="text-body-sm text-muted-foreground">
                      {formatarQuando(notificacao.criadoEm)}
                    </p>
                  </div>
                </div>
                <span className="text-body-sm text-muted-foreground">
                  {notificacao.lida ? 'Lida' : 'Não lida'}
                </span>
              </li>
            ))}
          </ul>

          <nav
            className="flex items-center justify-between gap-md"
            aria-label="Paginação das notificações"
          >
            <p className="text-body-sm text-muted-foreground">
              Página {pagina + 1} de {Math.max(1, Math.ceil(data.total / POR_PAGINA))}
            </p>
            <div className="flex gap-xs">
              <Button
                variante="contorno"
                tamanho="compacto"
                disabled={pagina === 0}
                onClick={() => irParaPagina(pagina - 1)}
              >
                Anterior
              </Button>
              <Button
                variante="contorno"
                tamanho="compacto"
                disabled={(pagina + 1) * POR_PAGINA >= data.total}
                onClick={() => irParaPagina(pagina + 1)}
              >
                Próxima
              </Button>
            </div>
          </nav>
        </>
      )}
    </div>
  );
};
