/**
 * Aviso que impede a ação e explica o motivo (COMPONENTS.md §4.1): `AlertDialog`
 * controlado, com um único "Entendi". Usado quando o servidor recusa por uma
 * regra que o produto sabe explicar — um toast sumiria antes de ser lido.
 */
'use client';

import * as AlertDialog from '@radix-ui/react-alert-dialog';

import { Button } from './button';

export const AvisoBloqueante = ({
  aberto,
  titulo,
  descricao,
  aoFechar,
}: {
  aberto: boolean;
  titulo: string;
  descricao: string;
  aoFechar: () => void;
}) => (
  <AlertDialog.Root open={aberto} onOpenChange={(proximo) => (proximo ? undefined : aoFechar())}>
    <AlertDialog.Portal>
      <AlertDialog.Overlay className="fixed inset-0 z-50 bg-primary/40" />
      <AlertDialog.Content className="fixed left-1/2 top-1/2 z-50 flex w-[calc(100vw-2rem)] max-w-[28rem] -translate-x-1/2 -translate-y-1/2 flex-col gap-md rounded-lg border border-border bg-popover p-lg text-popover-foreground shadow-lg">
        <AlertDialog.Title className="text-headline-sm text-foreground">{titulo}</AlertDialog.Title>
        <AlertDialog.Description className="text-body-md text-muted-foreground">
          {descricao}
        </AlertDialog.Description>
        <div className="flex justify-end">
          <AlertDialog.Cancel asChild>
            <Button tamanho="compacto">Entendi</Button>
          </AlertDialog.Cancel>
        </div>
      </AlertDialog.Content>
    </AlertDialog.Portal>
  </AlertDialog.Root>
);
