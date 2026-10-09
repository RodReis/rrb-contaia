/**
 * Confirmação de ação irreversível ou de efeito jurídico (COMPONENTS.md §4.1):
 * `AlertDialog`, que não fecha por clique fora e nomeia o registro afetado.
 *
 * O botão de confirmação **não** é `AlertDialog.Action`: aquele fecha o diálogo
 * ao ser acionado, e aqui a ação pode falhar no servidor — fechar antes da
 * resposta esconderia o erro. O diálogo só fecha quando a ação conclui.
 *
 * Um bloqueio que o produto sabe explicar (ex.: último administrador) troca o
 * conteúdo por uma mensagem com um único "Entendi", em vez de um toast que some.
 */
'use client';

import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { LoaderCircle } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { Button } from './button';

export const ConfirmacaoDeAcao = ({
  gatilho,
  titulo,
  descricao,
  rotuloDeConfirmacao,
  rotuloDeRecusa = 'Cancelar',
  destrutivo = false,
  aoConfirmar,
  explicarBloqueio,
}: {
  gatilho: ReactNode;
  titulo: string;
  descricao: string;
  rotuloDeConfirmacao: string;
  /**
   * Botão que desiste sem efeito. Quando a ação destrutiva também é um "cancelar" (cancelar uma
   * importação), dizer o que fica ("Manter prévia") evita dois botões "Cancelar" lado a lado.
   */
  rotuloDeRecusa?: string;
  destrutivo?: boolean;
  aoConfirmar: () => Promise<unknown>;
  /** Devolve o texto do bloqueio se o erro for um que o produto explica; `null` caso contrário. */
  explicarBloqueio?: (erro: unknown) => string | null;
}) => {
  const [aberto, definirAberto] = useState(false);
  const [ocupado, definirOcupado] = useState(false);
  const [bloqueio, definirBloqueio] = useState<string | null>(null);

  // Reabrir começa do zero: o bloqueio de uma tentativa não vale para a seguinte.
  // A limpeza acontece no evento de abertura, não num efeito (regra do React Compiler).
  const alternar = (proximo: boolean): void => {
    if (ocupado) {
      return;
    }

    definirAberto(proximo);

    if (proximo) {
      definirBloqueio(null);
    }
  };

  const confirmar = async (): Promise<void> => {
    definirOcupado(true);

    try {
      await aoConfirmar();
      definirAberto(false);
    } catch (erro) {
      // O toast de erro já é publicado pela camada de query; o diálogo fica
      // aberto para a pessoa tentar de novo — a não ser que haja o que explicar.
      definirBloqueio(explicarBloqueio?.(erro) ?? null);
    } finally {
      definirOcupado(false);
    }
  };

  return (
    <AlertDialog.Root open={aberto} onOpenChange={alternar}>
      <AlertDialog.Trigger asChild>{gatilho}</AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-primary/40" />
        <AlertDialog.Content className="fixed left-1/2 top-1/2 z-50 flex w-[calc(100vw-2rem)] max-w-[28rem] -translate-x-1/2 -translate-y-1/2 flex-col gap-md rounded-lg border border-border bg-popover p-lg text-popover-foreground shadow-lg">
          <AlertDialog.Title className="text-headline-sm text-foreground [overflow-wrap:anywhere]">
            {bloqueio === null ? titulo : 'Não é possível continuar'}
          </AlertDialog.Title>
          <AlertDialog.Description className="text-body-md text-muted-foreground">
            {bloqueio ?? descricao}
          </AlertDialog.Description>

          <div className="flex flex-wrap justify-end gap-sm">
            {bloqueio === null ? (
              <>
                <AlertDialog.Cancel asChild>
                  <Button variante="contorno" tamanho="compacto" disabled={ocupado}>
                    {rotuloDeRecusa}
                  </Button>
                </AlertDialog.Cancel>
                <Button
                  tamanho="compacto"
                  variante={destrutivo ? 'destrutiva' : 'primaria'}
                  onClick={() => void confirmar()}
                  disabled={ocupado}
                  aria-busy={ocupado}
                >
                  {/* O rótulo fica; o indicador entra ao lado (COMPONENTS.md §1.1). */}
                  {ocupado ? <LoaderCircle className="motion-safe:animate-spin" aria-hidden="true" /> : null}
                  {rotuloDeConfirmacao}
                </Button>
              </>
            ) : (
              <AlertDialog.Cancel asChild>
                <Button tamanho="compacto">Entendi</Button>
              </AlertDialog.Cancel>
            )}
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
};
