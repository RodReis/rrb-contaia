/**
 * Cartão geral `Microserviço Signer` (SPEC-012 §5.2): estado agregado, instante da última
 * verificação, latência da última resposta válida e o detalhe do incidente quando existir.
 *
 * O cartão só afirma o que a API mediu: sem verificação recente ele diz "desatualizado" em vez de
 * mostrar "operacional", e em falha de comunicação mantém o último estado conhecido (§5.4). Não
 * há uptime, HSM, KMS nem destino de produção: o que a fatia entrega é o Signer local e os
 * dublês (§5.1).
 */
'use client';

import { ShieldAlert, ShieldCheck, ShieldX, TriangleAlert } from 'lucide-react';
import { useId, useState } from 'react';

import { Button } from '@/components/ui/button';
import { EmptyState, ErroDeTela, Skeleton } from '@/components/ui/estados';
import type { TomDoStatus } from '@/components/ui/status-badge';
import { ErroDaApi } from '@/lib/http';
import { mensagemDoCodigo } from '@/lib/mensagens';
import type { EstadoDeSaudeDoSigner } from '@contaia/shared';

import { juntar } from '../estilos';
import { APRESENTACAO_DO_SERVICO, descreverVerificacao, textoDaLatencia } from './apresentacao';
import { usePainelDoSigner } from './queries';

const ICONE_DO_ESTADO = {
  OPERACIONAL: ShieldCheck,
  DEGRADADO: ShieldAlert,
  INDISPONIVEL: ShieldX,
} as const satisfies Record<EstadoDeSaudeDoSigner, unknown>;

const CLASSE_DO_ACENTO: Readonly<Partial<Record<TomDoStatus, string>>> = {
  conforme: 'bg-success-indicator',
  atencao: 'bg-warning-indicator',
  critico: 'bg-danger-indicator',
};

const CLASSE_DO_ICONE: Readonly<Partial<Record<TomDoStatus, string>>> = {
  conforme: 'bg-success text-success-foreground',
  atencao: 'bg-warning text-warning-foreground',
  critico: 'bg-danger text-danger-foreground',
};

const Moldura = ({
  tom,
  children,
}: {
  tom?: TomDoStatus;
  children: React.ReactNode;
}) => (
  <section
    aria-labelledby="titulo-signer"
    className="relative overflow-hidden rounded-xl border border-border bg-card shadow-[var(--elevation-1)]"
  >
    {tom === undefined ? null : (
      <span
        className={juntar('absolute inset-x-0 top-0 h-0.5', CLASSE_DO_ACENTO[tom])}
        aria-hidden="true"
      />
    )}
    {children}
  </section>
);

const Titulo = () => (
  <h2 id="titulo-signer" className="text-label-sm uppercase text-muted-foreground">
    Microserviço Signer
  </h2>
);

const DetalheDoIncidente = () => {
  const [aberto, definirAberto] = useState(false);
  const idDoDetalhe = useId();

  return (
    <div className="flex flex-col gap-sm rounded-lg border border-danger-indicator/40 bg-danger px-md py-sm">
      <div className="flex flex-wrap items-center justify-between gap-sm">
        <p className="flex items-center gap-xs text-title-sm text-danger-foreground">
          <TriangleAlert className="size-icon-sm" aria-hidden="true" />
          Incidente em andamento
        </p>
        <Button
          variante="contorno"
          tamanho="compacto"
          aria-expanded={aberto}
          aria-controls={idDoDetalhe}
          onClick={() => definirAberto((anterior) => !anterior)}
        >
          Ver detalhe do incidente
        </Button>
      </div>
      {aberto ? (
        <div id={idDoDetalhe} className="flex flex-col gap-xs text-body-sm text-danger-foreground/90">
          <p>
            O monitor registrou três verificações seguidas sem resposta válida do Signer e abriu o
            incidente. Enquanto ele durar, assinatura e teste mTLS não são feitos.
          </p>
          <p>
            Os administradores do escritório foram avisados no sino, uma vez. Quando a primeira
            verificação válida chegar, o incidente se encerra e eles são avisados da recuperação.
          </p>
        </div>
      ) : null}
    </div>
  );
};

export const CartaoDoSigner = () => {
  const consulta = usePainelDoSigner(true);
  const painel = consulta.data;

  if (painel === undefined && consulta.isPending) {
    return (
      <Moldura>
        <div className="flex flex-col gap-md p-lg" aria-busy="true">
          <span className="sr-only">Carregando o estado do Signer</span>
          <Titulo />
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-5 w-72 max-w-full" />
        </div>
      </Moldura>
    );
  }

  if (painel === undefined) {
    const problema = consulta.error instanceof ErroDaApi ? consulta.error.problema : null;

    return (
      <Moldura>
        <div className="flex flex-col gap-md p-lg">
          <Titulo />
          {problema?.code === 'SEM_AUTORIZACAO' ? (
            <EmptyState
              icone={<ShieldX />}
              titulo="Você não tem permissão para ver o Signer"
              descricao="O seu papel não inclui a consulta do estado do Signer. Se você precisa dela, peça a um administrador do escritório."
            />
          ) : (
            <ErroDeTela
              titulo="Não foi possível ler o estado do Signer"
              descricao={
                problema === null
                  ? mensagemDoCodigo('FALHA_DE_REDE')
                  : mensagemDoCodigo(problema.code)
              }
              correlationId={problema?.correlationId}
              acao={
                <Button variante="contorno" tamanho="compacto" onClick={() => void consulta.refetch()}>
                  Tentar de novo
                </Button>
              }
            />
          )}
        </div>
      </Moldura>
    );
  }

  const apresentacao = APRESENTACAO_DO_SERVICO[painel.estado];
  const Icone = ICONE_DO_ESTADO[painel.estado];
  const semResposta = consulta.isError;

  return (
    <Moldura tom={apresentacao.tom}>
      <div className="flex flex-col gap-md p-lg">
        <div className="flex items-start justify-between gap-sm">
          <Titulo />
          <span
            className={juntar(
              'flex size-8 shrink-0 items-center justify-center rounded-lg',
              CLASSE_DO_ICONE[apresentacao.tom],
            )}
            aria-hidden="true"
          >
            <Icone className="size-icon-md" />
          </span>
        </div>

        <div className="grid gap-md tablet:grid-cols-[minmax(0,1fr)_auto] tablet:items-end">
          <div className="flex flex-col gap-xs">
            <p className="font-display text-headline-lg text-foreground">{apresentacao.rotulo}</p>
            <p className="text-body-sm text-muted-foreground">
              {descreverVerificacao(painel.ultimaVerificacaoEm)}
            </p>
          </div>
          <dl className="flex flex-col gap-xs tablet:items-end">
            <dt className="text-label-sm uppercase text-muted-foreground">
              Latência da última resposta válida
            </dt>
            <dd className="font-mono text-code-md tabular-nums text-foreground">
              {textoDaLatencia(painel.ultimaLatenciaMs)}
            </dd>
          </dl>
        </div>

        {painel.desatualizado || semResposta ? (
          <p className="flex items-start gap-xs rounded-md bg-warning px-md py-sm text-body-sm text-warning-foreground">
            <TriangleAlert className="mt-0.5 size-icon-sm shrink-0" aria-hidden="true" />
            <span>
              <strong className="font-semibold">Desatualizado</strong>.{' '}
              {semResposta
                ? 'Sem resposta da API agora; este é o último estado conhecido.'
                : 'O monitor não confirmou o estado recentemente; o que aparece pode estar defasado.'}
            </span>
          </p>
        ) : null}

        {painel.incidenteAberto ? <DetalheDoIncidente /> : null}

        {/* Só o texto muda quando o estado muda: a região não relê a cada atualização. */}
        <p role="status" className="sr-only">
          {`Signer ${apresentacao.rotulo.toLowerCase()}`}
        </p>
      </div>
    </Moldura>
  );
};
