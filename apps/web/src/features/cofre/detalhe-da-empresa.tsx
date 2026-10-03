/**
 * Detalhe da empresa no cofre (SPEC-011 §5.2): metadados do certificado vigente,
 * responsável, as mesmas ações da linha e o histórico de versões. O painel é um
 * `Dialog` lateral aberto pela URL (`?empresa=<id>`): é o destino do clique no
 * nome da empresa e da notificação do sino, e se compartilha por link.
 *
 * Só metadados. Não existe download nem exibição do conteúdo do certificado
 * (SPEC-011 §11); a impressão digital completa é copiável porque é um
 * identificador de conferência, não um segredo.
 */
'use client';

import * as Dialog from '@radix-ui/react-dialog';
import type { CertificadoMetadados, DetalheDoCofre, ItemDoCofre } from '@contaia/shared';
import { Copy, X } from 'lucide-react';
import Link from 'next/link';
import { useRef, type ReactNode } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/estados';
import { StatusBadge } from '@/components/ui/status-badge';
import { cnpjFormatado, formatarQuando } from '../carteira/rotulos';
import { rotuloDoRegime } from '../empresa/rotulos';
import { AcoesDoItem } from './acoes-do-item';
import {
  APRESENTACAO_DA_SITUACAO_DO_RESPONSAVEL,
  APRESENTACAO_DA_VERSAO,
  APRESENTACAO_DO_ESTADO,
  formatarDataCivil,
  impressaoDigitalAgrupada,
  prazoEmTexto,
} from './apresentacao';
import { ErroDoCofre } from './erro-do-cofre';
import { FUNDO_DA_SOBREPOSICAO } from './estilos';
import { useDetalheDoCofre } from './queries';

const Linha = ({ rotulo, children }: { rotulo: string; children: ReactNode }) => (
  <div className="flex flex-col gap-xs tablet:flex-row tablet:gap-md">
    <dt className="text-label-md text-muted-foreground tablet:w-[9.5rem] tablet:shrink-0">{rotulo}</dt>
    <dd className="min-w-0 text-body-md text-foreground [overflow-wrap:anywhere]">{children}</dd>
  </div>
);

/** A impressão digital é identificador de conferência; copiar é um clique (PATTERNS.md §3). */
const ImpressaoDigital = ({ valor, empresa }: { valor: string; empresa: string }) => {
  const copiar = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(valor);
      toast.success('Impressão digital copiada.');
    } catch {
      toast.error('Não foi possível copiar. Selecione o texto e copie manualmente.');
    }
  };

  return (
    <span className="flex flex-wrap items-start gap-sm">
      <span className="font-mono text-code-sm tabular-nums">{impressaoDigitalAgrupada(valor)}</span>
      <Button
        variante="fantasma"
        tamanho="compacto"
        onClick={() => void copiar()}
        aria-label={`Copiar a impressão digital completa do certificado de ${empresa}`}
      >
        <Copy aria-hidden="true" />
        Copiar
      </Button>
    </span>
  );
};

const Certificado = ({ item }: { item: ItemDoCofre }) => {
  const certificado = item.certificado;

  if (certificado === null) {
    return (
      <p className="rounded-md bg-muted px-md py-sm text-body-sm text-muted-foreground">
        Esta empresa ainda não tem certificado A1 no cofre. Cadastre um para que ele passe a ser
        o vigente.
      </p>
    );
  }

  return (
    <dl className="flex flex-col gap-sm">
      <Linha rotulo="Titular">{certificado.titular}</Linha>
      <Linha rotulo="Autoridade">{certificado.autoridadeCertificadora}</Linha>
      <Linha rotulo="Válido de">
        <span className="font-mono text-code-sm tabular-nums">
          {formatarDataCivil(certificado.validoDe)}
        </span>
      </Linha>
      <Linha rotulo="Válido até">
        <span className="font-mono text-code-sm tabular-nums">
          {formatarDataCivil(certificado.validoAte)}
        </span>
      </Linha>
      <Linha rotulo="Número de série">
        <span className="font-mono text-code-sm tabular-nums">{certificado.numeroSerie}</span>
      </Linha>
      <Linha rotulo="Impressão digital">
        <ImpressaoDigital valor={certificado.impressaoDigital} empresa={item.empresaNome} />
      </Linha>
      <Linha rotulo="Cadastrado em">
        <span className="tabular-nums">{formatarQuando(certificado.cadastradoEm)}</span>
      </Linha>
      {item.estado === 'DESATIVADO' && certificado.encerradoEm !== null ? (
        <Linha rotulo="Desativado em">
          <span className="tabular-nums">{formatarQuando(certificado.encerradoEm)}</span>
          {certificado.justificativa === null ? null : (
            <span className="mt-xs block text-muted-foreground">
              Motivo: {certificado.justificativa}
            </span>
          )}
        </Linha>
      ) : null}
    </dl>
  );
};

const Responsavel = ({ item }: { item: ItemDoCofre }) => {
  const responsavel = item.responsavel;

  if (responsavel === null) {
    return (
      <p className="text-body-md text-muted-foreground">
        {item.certificado === null || item.estado === 'DESATIVADO'
          ? 'Sem certificado vigente, não há responsável.'
          : 'O certificado está sem responsável. Escolha alguém para receber os alertas.'}
      </p>
    );
  }

  const situacao = APRESENTACAO_DA_SITUACAO_DO_RESPONSAVEL[responsavel.situacao];

  return (
    <div className="flex flex-wrap items-center justify-between gap-sm">
      <div className="flex min-w-0 flex-col">
        <span className="text-title-sm text-foreground [overflow-wrap:anywhere]">{responsavel.nome}</span>
        <span className="text-body-sm text-muted-foreground [overflow-wrap:anywhere]">
          {responsavel.email}
        </span>
      </div>
      <StatusBadge tom={situacao.tom} rotulo={situacao.rotulo} />
    </div>
  );
};

const Versao = ({ versao }: { versao: CertificadoMetadados }) => {
  const estado = APRESENTACAO_DA_VERSAO[versao.estado];

  return (
    <li className="flex flex-col gap-xs rounded-md border border-border bg-card p-md">
      <div className="flex flex-wrap items-center justify-between gap-sm">
        <span className="text-title-sm text-foreground">Versão {versao.versao}</span>
        <StatusBadge tom={estado.tom} rotulo={estado.rotulo} />
      </div>
      <p className="text-body-sm text-muted-foreground [overflow-wrap:anywhere]">
        {versao.titular} · {versao.autoridadeCertificadora}
      </p>
      <p className="text-body-sm text-muted-foreground">
        Válido de{' '}
        <span className="font-mono text-code-sm tabular-nums text-foreground">
          {formatarDataCivil(versao.validoDe)}
        </span>{' '}
        até{' '}
        <span className="font-mono text-code-sm tabular-nums text-foreground">
          {formatarDataCivil(versao.validoAte)}
        </span>
      </p>
      <p className="text-body-sm text-muted-foreground">
        Cadastrado em <span className="tabular-nums">{formatarQuando(versao.cadastradoEm)}</span>
      </p>
      {versao.encerradoEm === null ? null : (
        <p className="text-body-sm text-muted-foreground">
          {versao.motivoDoEncerramento === 'SUBSTITUICAO' ? 'Substituído' : 'Desativado'} em{' '}
          <span className="tabular-nums">{formatarQuando(versao.encerradoEm)}</span>
          {versao.justificativa === null ? null : ` · Motivo: ${versao.justificativa}`}
        </p>
      )}
    </li>
  );
};

const Conteudo = ({
  detalhe,
  aoEnviar,
}: {
  detalhe: DetalheDoCofre;
  aoEnviar: (item: ItemDoCofre) => void;
}) => {
  const { item, versoes } = detalhe;
  const estado = APRESENTACAO_DO_ESTADO[item.estado];
  const prazo = prazoEmTexto(item.diasParaVencer);

  return (
    <div className="flex flex-col gap-lg">
      <section aria-labelledby="detalhe-situacao" className="flex flex-col gap-sm">
        <h3 id="detalhe-situacao" className="text-label-sm uppercase text-muted-foreground">
          Situação
        </h3>
        <div className="flex flex-wrap items-center gap-sm">
          <StatusBadge tom={estado.tom} rotulo={estado.rotulo} />
          {prazo === null ? null : <span className="text-body-sm text-muted-foreground">{prazo}</span>}
          {item.semResponsavel ? <StatusBadge tom="atencao" rotulo="Sem responsável ativo" /> : null}
        </div>
      </section>

      <section aria-labelledby="detalhe-certificado" className="flex flex-col gap-sm">
        <h3 id="detalhe-certificado" className="text-label-sm uppercase text-muted-foreground">
          {item.estado === 'DESATIVADO' ? 'Último certificado' : 'Certificado vigente'}
        </h3>
        <Certificado item={item} />
      </section>

      <section aria-labelledby="detalhe-responsavel" className="flex flex-col gap-sm">
        <h3 id="detalhe-responsavel" className="text-label-sm uppercase text-muted-foreground">
          Responsável
        </h3>
        <Responsavel item={item} />
      </section>

      <section aria-labelledby="detalhe-acoes" className="flex flex-col gap-sm">
        <h3 id="detalhe-acoes" className="text-label-sm uppercase text-muted-foreground">
          Ações
        </h3>
        <AcoesDoItem item={item} variante="detalhe" aoEnviar={aoEnviar} />
      </section>

      <section aria-labelledby="detalhe-versoes" className="flex flex-col gap-sm">
        <h3 id="detalhe-versoes" className="text-label-sm uppercase text-muted-foreground">
          Versões ({versoes.length})
        </h3>
        {versoes.length === 0 ? (
          <p className="text-body-sm text-muted-foreground">
            Nenhuma versão registrada. Os envios aceitos e as recusas aparecem no histórico.
          </p>
        ) : (
          <ol className="flex flex-col gap-sm" aria-label="Versões do certificado, da mais recente para a mais antiga">
            {versoes.map((versao) => (
              <Versao key={versao.id} versao={versao} />
            ))}
          </ol>
        )}
        <Link
          href={`/historico?aba=CERTIFICADOS&empresaId=${item.empresaId}`}
          className="w-fit rounded-sm text-body-sm text-foreground underline underline-offset-2 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Ver o histórico completo de certificados
        </Link>
      </section>
    </div>
  );
};

export const DetalheDaEmpresa = ({
  empresaId,
  aoFechar,
  aoEnviar,
}: {
  /** Aberto enquanto houver `empresa` na URL. */
  empresaId: string | null;
  aoFechar: () => void;
  aoEnviar: (item: ItemDoCofre) => void;
}) => {
  const painel = useRef<HTMLDivElement>(null);
  const { data, isPending, isError, error, refetch } = useDetalheDoCofre(empresaId);
  const item = data?.item;

  return (
    <Dialog.Root open={empresaId !== null} onOpenChange={(aberto) => (aberto ? undefined : aoFechar())}>
      <Dialog.Portal>
        <Dialog.Overlay className={FUNDO_DA_SOBREPOSICAO} />
        <Dialog.Content
          ref={painel}
          tabIndex={-1}
          aria-describedby={undefined}
          // O foco abre no próprio painel (o título é lido), e não no botão de fechar, que
          // ganharia um anel de foco pesado antes de a pessoa ter feito qualquer coisa.
          onOpenAutoFocus={(evento) => {
            evento.preventDefault();
            painel.current?.focus();
          }}
          className="painel-entra outline-none fixed inset-y-0 right-0 z-50 flex w-full max-w-[34rem] flex-col border-l border-border bg-popover text-popover-foreground shadow-[var(--elevation-4)]"
        >
          <header className="flex items-start justify-between gap-md border-b border-border px-lg py-md">
            <div className="flex min-w-0 flex-col gap-xs">
              <Dialog.Title className="font-display text-headline-sm text-foreground">
                Certificado da empresa
              </Dialog.Title>
              {item === undefined ? null : (
                <p className="text-body-md text-foreground [overflow-wrap:anywhere]">
                  {item.empresaNome}
                  <span className="mt-xs flex flex-wrap items-center gap-x-sm gap-y-xs">
                    <span className="font-mono text-code-sm tabular-nums text-muted-foreground">
                      {cnpjFormatado(item.cnpj)}
                    </span>
                    {item.regime === null ? null : (
                      <StatusBadge tom="neutro" rotulo={rotuloDoRegime(item.regime)} />
                    )}
                  </span>
                </p>
              )}
            </div>
            <Dialog.Close asChild>
              <Button variante="fantasma" tamanho="icone" aria-label="Fechar os detalhes do certificado">
                <X aria-hidden="true" />
              </Button>
            </Dialog.Close>
          </header>

          <div className="flex-1 overflow-y-auto px-lg py-lg">
            {isPending ? (
              <div className="flex flex-col gap-md" aria-busy="true" aria-live="polite">
                <span className="sr-only">Carregando o certificado da empresa</span>
                <Skeleton className="h-8 w-40" />
                <Skeleton className="h-48 w-full" />
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-32 w-full" />
              </div>
            ) : isError ? (
              <ErroDoCofre
                nivel={3}
                erro={error}
                titulo="Não foi possível carregar o certificado"
                aoTentarDeNovo={() => void refetch()}
              />
            ) : (
              <Conteudo
                detalhe={data}
                aoEnviar={(alvo) => {
                  aoFechar();
                  aoEnviar(alvo);
                }}
              />
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
