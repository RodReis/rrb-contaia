/**
 * Envio e substituição de arquivo da exigência (SPEC-004 §2.3).
 *
 * Dropzone de verdade: `<input type="file">` real, estado de arrasto e
 * validação de formato e tamanho **antes** de gastar a rede — o catálogo
 * registra que o protótipo tem um `<div>` sem input nenhum
 * (COMPONENTS.md §5.3).
 *
 * A validação aqui não substitui a do servidor; ela existe para o erro chegar
 * na mesma tela em que a pessoa escolheu o arquivo, e não depois de 20 MB de
 * upload.
 */
'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { REGRAS_DE_ARQUIVO, mensagemDaFalha, validarArquivo } from '@contaia/shared';
import { FileUp, Upload, X } from 'lucide-react';
import { useId, useRef, useState, type DragEvent, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Campo } from '@/components/ui/campo';
import { tamanhoEmTexto } from '@/lib/arquivo';
import { cn } from '@/lib/cn';

const REGRA = REGRAS_DE_ARQUIVO.DOCUMENTO_DA_EMPRESA;

const hojeEmSaoPaulo = (): string =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

export const EnvioDeDocumento = ({
  gatilho,
  titulo,
  descricao,
  substituicao,
  ocupado,
  aoEnviar,
}: {
  gatilho: ReactNode;
  titulo: string;
  descricao: string;
  substituicao: boolean;
  ocupado: boolean;
  aoEnviar: (entrada: { arquivo: File; validade: string | null }) => Promise<unknown>;
}) => {
  const [aberto, definirAberto] = useState(false);
  const [arquivo, definirArquivo] = useState<File | null>(null);
  const [validade, definirValidade] = useState('');
  const [erro, definirErro] = useState<string | undefined>(undefined);
  const [arrastando, definirArrastando] = useState(false);
  const entradaRef = useRef<HTMLInputElement>(null);
  const idDaZona = useId();
  const idDaDescricaoDaZona = `${idDaZona}-ajuda`;

  // Reabrir começa do zero: arquivo escolhido numa tentativa não pode vazar
  // para a seguinte, que é outro fato no histórico. A limpeza acontece no
  // evento de abertura, não em efeito — `setState` em efeito dispara
  // renderização em cascata (regra do React Compiler).
  const alternar = (proximo: boolean): void => {
    definirAberto(proximo);

    if (proximo) {
      definirArquivo(null);
      definirValidade('');
      definirErro(undefined);
      definirArrastando(false);
    }
  };

  const escolher = (escolhido: File | undefined): void => {
    if (escolhido === undefined) {
      return;
    }

    const falha = validarArquivo('DOCUMENTO_DA_EMPRESA', {
      tipoConteudo: escolhido.type,
      tamanhoBytes: escolhido.size,
    });

    if (falha !== null) {
      definirArquivo(null);
      definirErro(mensagemDaFalha('DOCUMENTO_DA_EMPRESA', falha));
      return;
    }

    definirArquivo(escolhido);
    definirErro(undefined);
  };

  const soltar = (evento: DragEvent<HTMLDivElement>): void => {
    evento.preventDefault();
    definirArrastando(false);
    escolher(evento.dataTransfer.files[0]);
  };

  const enviar = async (): Promise<void> => {
    if (arquivo === null) {
      definirErro('Escolha um arquivo para enviar.');
      return;
    }

    try {
      await aoEnviar({ arquivo, validade: validade.length > 0 ? validade : null });
      definirAberto(false);
    } catch {
      // O toast de falha já é emitido pela camada de dados; o diálogo fica
      // aberto com o arquivo escolhido para a pessoa tentar de novo.
    }
  };

  return (
    <Dialog.Root open={aberto} onOpenChange={alternar}>
      <Dialog.Trigger asChild>{gatilho}</Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-primary/40 backdrop-blur-sm motion-safe:animate-in motion-safe:fade-in" />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 w-[min(34rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2',
            'flex flex-col gap-lg rounded-lg border border-border bg-popover p-lg',
            'shadow-[var(--elevation-4)] motion-safe:animate-in motion-safe:fade-in',
          )}
        >
          <div className="flex flex-col gap-xs">
            <Dialog.Title className="font-display text-headline-sm text-popover-foreground">
              {titulo}
            </Dialog.Title>
            <Dialog.Description className="text-body-sm text-muted-foreground">
              {descricao}
            </Dialog.Description>
          </div>

          {/*
            A zona é um `<div>` com o input real dentro, e não um `<label>`
            envolvendo tudo: o botão de escolher arquivo precisa ser alcançável
            por teclado de forma previsível, e um label clicável que contém um
            botão duplica o disparo.
          */}
          <div
            onDragOver={(evento) => {
              evento.preventDefault();
              definirArrastando(true);
            }}
            onDragLeave={() => definirArrastando(false)}
            onDrop={soltar}
            className={cn(
              'flex flex-col items-center gap-sm rounded-lg border border-dashed px-lg py-xl text-center',
              'transition-colors duration-fast ease-out',
              arrastando ? 'border-ring bg-accent' : 'border-input bg-card',
            )}
          >
            <span className="text-muted-foreground [&_svg]:size-icon-xl" aria-hidden="true">
              <FileUp />
            </span>

            <p className="text-body-sm text-foreground">
              {arquivo === null
                ? 'Arraste o arquivo aqui ou escolha no computador.'
                : arquivo.name}
            </p>

            <p id={idDaDescricaoDaZona} className="text-body-sm text-muted-foreground">
              {arquivo === null
                ? `${REGRA.extensoesAceitas.join(', ')} · até 20 MB`
                : tamanhoEmTexto(arquivo.size)}
            </p>

            <input
              ref={entradaRef}
              id={idDaZona}
              type="file"
              className="sr-only"
              accept={REGRA.tiposAceitos.join(',')}
              aria-describedby={idDaDescricaoDaZona}
              onChange={(evento) => escolher(evento.target.files?.[0])}
            />

            <div className="flex flex-wrap items-center justify-center gap-sm">
              <Button
                variante="contorno"
                tamanho="compacto"
                onClick={() => entradaRef.current?.click()}
              >
                <Upload aria-hidden="true" />
                {arquivo === null ? 'Escolher arquivo' : 'Trocar arquivo'}
              </Button>

              {arquivo === null ? null : (
                <Button
                  variante="fantasma"
                  tamanho="compacto"
                  onClick={() => {
                    definirArquivo(null);

                    if (entradaRef.current !== null) {
                      entradaRef.current.value = '';
                    }
                  }}
                >
                  <X aria-hidden="true" />
                  Remover
                </Button>
              )}
            </div>
          </div>

          <Campo
            rotulo="Validade do documento"
            type="date"
            value={validade}
            onValorChange={definirValidade}
            // Validade é prazo do documento entregue: futura é o caso normal,
            // diferente da vigência da F3, que não pode ser futura.
            min={hojeEmSaoPaulo()}
            ajuda="Opcional. Depois desta data o documento aparece como vencido."
          />

          {erro === undefined ? null : (
            <p role="alert" className="text-body-sm text-danger-foreground">
              {erro}
            </p>
          )}

          <p className="text-body-sm text-muted-foreground">
            {substituicao
              ? 'A versão atual será arquivada e ficará disponível no histórico. O arquivo novo entra como Enviado e depende de análise.'
              : 'O arquivo entra como Enviado e depende de análise para ser aprovado.'}
          </p>

          <div className="flex flex-wrap justify-end gap-sm">
            <Dialog.Close asChild>
              <Button variante="fantasma" tamanho="compacto" disabled={ocupado}>
                Cancelar
              </Button>
            </Dialog.Close>

            <Button
              tamanho="compacto"
              disabled={ocupado || arquivo === null}
              onClick={() => void enviar()}
            >
              {ocupado ? 'Enviando…' : substituicao ? 'Substituir arquivo' : 'Enviar arquivo'}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
