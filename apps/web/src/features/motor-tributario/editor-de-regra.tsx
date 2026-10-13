/**
 * Painel lateral da versão de regra (FRONTEND.md §10.1: formulário curto abre em Sheet). Aberto pela
 * URL (`?regra=<id>` ou `?regra=nova`), então o estado é compartilhável. Prende o foco, fecha com Esc
 * e devolve o foco ao acionador (Radix Dialog). A versão vem do servidor a cada abertura: quem edita
 * precisa do `lockVersion` atual.
 */
'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useRef } from 'react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/estados';
import { StatusBadge } from '@/components/ui/status-badge';
import { FUNDO_DA_SOBREPOSICAO } from '../cofre/estilos';
import { APRESENTACAO_DO_ESTADO } from './apresentacao';
import { ErroDoMotor } from './erro-do-motor';
import { FormularioDaRegra } from './formulario-da-regra';
import { useRegra } from './queries';
import { rotuloDaRegra } from './resultado-da-simulacao';
import { NOVA_REGRA } from './use-filtro-do-catalogo';

export const EditorDeRegra = ({
  regraId,
  podeAdministrar,
  aoFechar,
}: {
  regraId: string;
  podeAdministrar: boolean;
  aoFechar: () => void;
}) => {
  const painel = useRef<HTMLDivElement>(null);
  const nova = regraId === NOVA_REGRA;
  const consulta = useRegra(nova ? null : regraId);
  const regra = consulta.data;

  return (
    <Dialog.Root open onOpenChange={(aberto) => (aberto ? undefined : aoFechar())}>
      <Dialog.Portal>
        <Dialog.Overlay className={FUNDO_DA_SOBREPOSICAO} />
        <Dialog.Content
          ref={painel}
          tabIndex={-1}
          aria-describedby={undefined}
          // O foco abre no próprio painel (o título é lido), não no botão de fechar.
          onOpenAutoFocus={(evento) => {
            evento.preventDefault();
            painel.current?.focus();
          }}
          className="painel-entra outline-none fixed inset-y-0 right-0 z-50 flex w-full max-w-[34rem] flex-col border-l border-border bg-popover text-popover-foreground shadow-[var(--elevation-4)]"
        >
          <header className="flex items-start justify-between gap-md border-b border-border px-lg py-md">
            <div className="flex min-w-0 flex-col gap-xs">
              <Dialog.Title className="font-display text-headline-sm text-foreground">
                {nova ? 'Nova regra' : regra === undefined ? 'Regra tributária' : `Regra tributária, versão ${regra.versionNumber}`}
              </Dialog.Title>
              {regra === undefined ? null : (
                <p className="flex flex-wrap items-center gap-sm text-body-sm text-muted-foreground">
                  <span className="[overflow-wrap:anywhere]">{rotuloDaRegra(regra)}</span>
                  <StatusBadge tom={APRESENTACAO_DO_ESTADO[regra.status].tom} rotulo={APRESENTACAO_DO_ESTADO[regra.status].rotulo} />
                </p>
              )}
            </div>
            <Dialog.Close asChild>
              <Button variante="fantasma" tamanho="icone" aria-label="Fechar o painel da regra">
                <X aria-hidden="true" />
              </Button>
            </Dialog.Close>
          </header>

          <div className="flex-1 overflow-y-auto px-lg py-lg">
            {nova ? (
              <FormularioDaRegra regra={null} podeAdministrar={podeAdministrar} aoConcluir={aoFechar} aoRecarregar={async () => undefined} />
            ) : consulta.isPending ? (
              <div className="flex flex-col gap-md" aria-busy="true" aria-live="polite">
                <span className="sr-only">Carregando a regra</span>
                <Skeleton className="h-8 w-40" />
                <Skeleton className="h-48 w-full" />
                <Skeleton className="h-24 w-full" />
              </div>
            ) : consulta.isError ? (
              <ErroDoMotor
                erro={consulta.error}
                titulo="Não foi possível abrir a regra"
                acao={
                  <div>
                    <Button variante="contorno" tamanho="compacto" onClick={() => void consulta.refetch()}>
                      Tentar de novo
                    </Button>
                  </div>
                }
              />
            ) : (
              <FormularioDaRegra
                // Remonta só quando o estado muda (publicar, arquivar). O refetch após um conflito mantém o
                // mesmo formulário: o que a pessoa digitou não pode ser descartado.
                key={`${consulta.data.id}-${consulta.data.status}`}
                regra={consulta.data}
                podeAdministrar={podeAdministrar}
                aoConcluir={aoFechar}
                aoRecarregar={async () => (await consulta.refetch()).data}
              />
            )}
          </div>

          <footer className="flex justify-start border-t border-border px-lg py-md">
            <Dialog.Close asChild>
              <Button variante="fantasma">Fechar</Button>
            </Dialog.Close>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
