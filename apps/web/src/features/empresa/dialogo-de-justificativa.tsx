/**
 * Confirmação com justificativa obrigatória para arquivar e reativar a empresa
 * (SPEC-003 §3.5).
 *
 * Usa `Dialog` e não `AlertDialog`: o `AlertDialog.Action` fecha o diálogo ao
 * ser acionado, e aqui a confirmação pode falhar na validação ou no servidor —
 * fechar antes da resposta perderia o texto que a pessoa escreveu.
 */
'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { useState, type ReactNode } from 'react';

import { AreaDeTexto } from '@/components/ui/area-de-texto';
import { Button } from '@/components/ui/button';

export const DialogoDeJustificativa = ({
  gatilho,
  titulo,
  descricao,
  rotuloDeConfirmacao,
  destrutivo = false,
  ocupado,
  aoConfirmar,
}: {
  gatilho: ReactNode;
  titulo: string;
  descricao: string;
  rotuloDeConfirmacao: string;
  destrutivo?: boolean;
  ocupado: boolean;
  aoConfirmar: (justificativa: string) => Promise<unknown>;
}) => {
  const [aberto, definirAberto] = useState(false);
  const [justificativa, definirJustificativa] = useState('');
  const [erro, definirErro] = useState<string | undefined>(undefined);

  // Reabrir o diálogo começa do zero: justificativa de uma operação não pode
  // vazar para a seguinte, que é outro fato no histórico. A limpeza acontece no
  // próprio evento de abertura, e não num efeito — `setState` dentro de efeito
  // dispara renderização em cascata (regra do React Compiler).
  const alternar = (proximo: boolean): void => {
    definirAberto(proximo);

    if (proximo) {
      definirJustificativa('');
      definirErro(undefined);
    }
  };

  const confirmar = async (): Promise<void> => {
    if (justificativa.trim().length === 0) {
      definirErro('Informe a justificativa.');
      return;
    }

    try {
      await aoConfirmar(justificativa.trim());
      definirAberto(false);
    } catch {
      // O toast de erro já é publicado pela camada de query; o diálogo fica
      // aberto com o texto preservado para a pessoa tentar de novo (§5).
    }
  };

  return (
    <Dialog.Root open={aberto} onOpenChange={alternar}>
      <Dialog.Trigger asChild>{gatilho}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-primary/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex w-[calc(100vw-2rem)] max-w-[32rem] -translate-x-1/2 -translate-y-1/2 flex-col gap-md rounded-lg border border-border bg-popover p-lg text-popover-foreground shadow-lg">
          <Dialog.Title className="text-headline-sm text-foreground">{titulo}</Dialog.Title>
          <Dialog.Description className="text-body-md text-muted-foreground">
            {descricao}
          </Dialog.Description>

          <AreaDeTexto
            rotulo="Justificativa"
            obrigatorio
            value={justificativa}
            onValorChange={(valor) => {
              definirJustificativa(valor);
              definirErro(undefined);
            }}
            erro={erro}
            ajuda="Fica registrada no Histórico de Informações, junto com o autor e a data."
            maxLength={500}
          />

          <div className="flex flex-wrap justify-end gap-sm">
            <Dialog.Close asChild>
              <Button variante="contorno" tamanho="compacto" disabled={ocupado}>
                Cancelar
              </Button>
            </Dialog.Close>
            <Button
              tamanho="compacto"
              variante={destrutivo ? 'destrutiva' : 'primaria'}
              onClick={() => void confirmar()}
              disabled={ocupado}
            >
              {ocupado ? 'Salvando…' : rotuloDeConfirmacao}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
