/**
 * Troca do responsável pelo certificado vigente (SPEC-011 §3.5). Não existe
 * reatribuição automática: quem escolhe é uma pessoa, entre os elegíveis da
 * empresa. A escolha encerra a pendência de "sem responsável" e vira evento.
 *
 * `Dialog` e não `AlertDialog`: a troca é reversível (basta trocar de novo) e o
 * formulário precisa fechar só quando o servidor confirma.
 */
'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { LoaderCircle } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { ItemDoCofre } from '@contaia/shared';

import { Button } from '@/components/ui/button';
import { cnpjFormatado } from '../carteira/rotulos';
import { APRESENTACAO_DA_SITUACAO_DO_RESPONSAVEL } from './apresentacao';
import { CAIXA_DE_DIALOGO, FUNDO_DA_SOBREPOSICAO } from './estilos';
import { useTrocarResponsavel } from './queries';
import { ERRO_DE_RESPONSAVEL } from './schema';
import { SelecaoDeResponsavel } from './selecao-de-responsavel';

/** Montado só com o diálogo aberto: reabrir recomeça sem estado da vez anterior. */
const Conteudo = ({
  item,
  aoConcluir,
}: {
  item: ItemDoCofre;
  aoConcluir: () => void;
}) => {
  const [escolhido, definirEscolhido] = useState('');
  const [erro, definirErro] = useState<string | undefined>(undefined);
  const trocar = useTrocarResponsavel(item.empresaId);
  const atual = item.responsavel;

  const confirmar = async (): Promise<void> => {
    if (escolhido === '') {
      definirErro(ERRO_DE_RESPONSAVEL);

      return;
    }

    try {
      await trocar.mutateAsync(escolhido);
      aoConcluir();
    } catch {
      // O toast de erro já foi publicado pela mutação; o diálogo fica aberto.
    }
  };

  return (
    <>
      <Dialog.Title className="text-headline-sm text-foreground">
        Trocar o responsável pelo certificado
      </Dialog.Title>
      <Dialog.Description className="text-body-md text-muted-foreground">
        {item.empresaNome} (
        <span className="font-mono text-code-sm tabular-nums">{cnpjFormatado(item.cnpj)}</span>).{' '}
        {atual === null
          ? 'O certificado está sem responsável.'
          : `Hoje: ${atual.nome} (${APRESENTACAO_DA_SITUACAO_DO_RESPONSAVEL[atual.situacao].rotulo.toLowerCase()}).`}
      </Dialog.Description>

      <SelecaoDeResponsavel
        empresaId={item.empresaId}
        valor={escolhido}
        aoMudar={(valor) => {
          definirEscolhido(valor);
          definirErro(undefined);
        }}
        erro={erro}
        rotulo="Novo responsável"
      />

      <div className="flex flex-wrap justify-end gap-sm">
        <Dialog.Close asChild>
          <Button variante="contorno" tamanho="compacto" disabled={trocar.isPending}>
            Cancelar
          </Button>
        </Dialog.Close>
        <Button
          tamanho="compacto"
          onClick={() => void confirmar()}
          disabled={trocar.isPending}
          aria-busy={trocar.isPending}
        >
          {trocar.isPending ? (
            <LoaderCircle className="motion-safe:animate-spin" aria-hidden="true" />
          ) : null}
          Salvar responsável
        </Button>
      </div>
    </>
  );
};

export const DialogoDeResponsavel = ({
  gatilho,
  item,
}: {
  gatilho: ReactNode;
  item: ItemDoCofre;
}) => {
  const [aberto, definirAberto] = useState(false);

  return (
    <Dialog.Root open={aberto} onOpenChange={definirAberto}>
      <Dialog.Trigger asChild>{gatilho}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className={FUNDO_DA_SOBREPOSICAO} />
        <Dialog.Content className={CAIXA_DE_DIALOGO}>
          <Conteudo item={item} aoConcluir={() => definirAberto(false)} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
