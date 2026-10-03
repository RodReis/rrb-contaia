/**
 * Desativação do certificado vigente (SPEC-011 §3.4): `AlertDialog` que nomeia
 * empresa e CNPJ, exige o motivo e deixa claro o que muda. Não fecha por clique
 * fora e só fecha quando o servidor confirma — a falha mantém o diálogo aberto
 * com o motivo digitado.
 *
 * Não usa `AlertDialog.Action`: ele fecha o diálogo ao ser acionado, e aqui a
 * ação pode falhar no servidor. A validação do motivo (obrigatório) é do domínio
 * e da API; a tela repete a regra para o erro aparecer no campo.
 */
'use client';

import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { LoaderCircle } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';

import { AreaDeTexto } from '@/components/ui/area-de-texto';
import { Button } from '@/components/ui/button';
import { cnpjFormatado } from '../carteira/rotulos';
import { CAIXA_DE_DIALOGO, FUNDO_DA_SOBREPOSICAO } from './estilos';
import { useDesativarCertificado } from './queries';
import { LIMITE_DO_MOTIVO, motivoSchema } from './schema';

export const DialogoDeDesativacao = ({
  gatilho,
  empresaId,
  empresaNome,
  cnpj,
}: {
  gatilho: ReactNode;
  empresaId: string;
  empresaNome: string;
  cnpj: string;
}) => {
  const conteudo = useRef<HTMLDivElement>(null);
  const [aberto, definirAberto] = useState(false);
  const [motivo, definirMotivo] = useState('');
  const [erro, definirErro] = useState<string | undefined>(undefined);
  const desativar = useDesativarCertificado(empresaId);

  // Reabrir começa do zero: o motivo de uma desativação é outro fato no histórico.
  const alternar = (proximo: boolean): void => {
    if (desativar.isPending) {
      return;
    }

    definirAberto(proximo);

    if (proximo) {
      definirMotivo('');
      definirErro(undefined);
    }
  };

  const confirmar = async (): Promise<void> => {
    const validado = motivoSchema.safeParse(motivo);

    if (!validado.success) {
      definirErro(validado.error.issues[0]?.message);
      conteudo.current?.querySelector<HTMLElement>('textarea')?.focus();

      return;
    }

    try {
      await desativar.mutateAsync(validado.data);
      definirAberto(false);
    } catch {
      // O toast de erro já foi publicado pela mutação; o diálogo fica aberto com o motivo preservado.
    }
  };

  return (
    <AlertDialog.Root open={aberto} onOpenChange={alternar}>
      <AlertDialog.Trigger asChild>{gatilho}</AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className={FUNDO_DA_SOBREPOSICAO} />
        <AlertDialog.Content
          ref={conteudo}
          className={CAIXA_DE_DIALOGO}
          onOpenAutoFocus={(evento) => {
            // O foco vai direto para o motivo, o que a pessoa precisa preencher.
            evento.preventDefault();
            conteudo.current?.querySelector<HTMLElement>('textarea')?.focus();
          }}
        >
          <AlertDialog.Title className="text-headline-sm text-foreground">
            Desativar o certificado de {empresaNome} (
            <span className="font-mono text-code-sm tabular-nums">{cnpjFormatado(cnpj)}</span>)?
          </AlertDialog.Title>

          <AlertDialog.Description asChild>
            <div className="flex flex-col gap-sm text-body-md text-muted-foreground">
              <p>Ao desativar, a empresa fica sem certificado vigente:</p>
              <ul className="list-disc pl-lg">
                <li>o certificado deixa de poder ser usado;</li>
                <li>o registro e o histórico são preservados, sem exclusão;</li>
                <li>uma pendência de certificado ausente é aberta para a empresa.</li>
              </ul>
              <p>
                Não é possível reativar este certificado. Para voltar a usar um, é preciso enviar
                um novo.
              </p>
            </div>
          </AlertDialog.Description>

          <AreaDeTexto
            rotulo="Motivo da desativação"
            obrigatorio
            value={motivo}
            onValorChange={(valor) => {
              definirMotivo(valor);
              definirErro(undefined);
            }}
            erro={erro}
            ajuda="Fica registrado no Histórico de Informações, com o autor e a data."
            maxLength={LIMITE_DO_MOTIVO}
          />

          <div className="flex flex-wrap justify-end gap-sm">
            <AlertDialog.Cancel asChild>
              <Button variante="contorno" tamanho="compacto" disabled={desativar.isPending}>
                Cancelar
              </Button>
            </AlertDialog.Cancel>
            <Button
              variante="destrutiva"
              tamanho="compacto"
              onClick={() => void confirmar()}
              disabled={desativar.isPending}
              aria-busy={desativar.isPending}
            >
              {desativar.isPending ? (
                <LoaderCircle className="motion-safe:animate-spin" aria-hidden="true" />
              ) : null}
              Desativar certificado
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
};
