/**
 * Área de envio do certificado (SPEC-011 §5.2): o dropzone de verdade que o
 * protótipo não tem. Há um `<input type="file">` real (DEBITO.md D-15, COMPONENTS.md
 * §5.3), estado de arrasto, arquivo escolhido visível, erro ligado ao campo e
 * a mesma validação de extensão e tamanho do cofre antes de gastar a rede.
 *
 * O arquivo nunca é lido aqui: o navegador só o entrega ao `FormData` do envio
 * direto ao cofre (`envio.ts`). Nada do conteúdo vai para estado, URL ou log.
 */
'use client';

import { EXTENSOES_DO_CERTIFICADO, LIMITE_DO_CERTIFICADO_BYTES } from '@contaia/shared';
import { CloudUpload, FileKey, X } from 'lucide-react';
import { useId, useRef, useState, type DragEvent } from 'react';

import { Button } from '@/components/ui/button';
import { formatarTamanho } from '@/lib/arquivo';
import { juntar } from './estilos';

const LIMITE_EM_MB = LIMITE_DO_CERTIFICADO_BYTES / (1024 * 1024);
const ACEITA = EXTENSOES_DO_CERTIFICADO.join(',');

export const ERRO_DE_VARIOS_ARQUIVOS = 'Envie um único arquivo de certificado por vez.';

export const ZonaDeArquivo = ({
  arquivo,
  erro,
  desabilitada = false,
  aoEscolher,
  aoRemover,
  aoRejeitar,
}: {
  arquivo: File | null;
  erro: string | undefined;
  desabilitada?: boolean;
  aoEscolher: (arquivo: File) => void;
  aoRemover: () => void;
  /** Soltou mais de um arquivo: a decisão é da tela, não da zona. */
  aoRejeitar: (mensagem: string) => void;
}) => {
  const id = useId();
  const idDaDescricao = `${id}-descricao`;
  const idDoErro = `${id}-erro`;
  const entrada = useRef<HTMLInputElement>(null);
  const [arrastando, definirArrastando] = useState(false);
  const temErro = erro !== undefined && erro.length > 0;

  const receber = (arquivos: FileList | null): void => {
    if (desabilitada || arquivos === null || arquivos.length === 0) {
      return;
    }

    const primeiro = arquivos[0];

    if (arquivos.length > 1 || primeiro === undefined) {
      aoRejeitar(ERRO_DE_VARIOS_ARQUIVOS);

      return;
    }

    aoEscolher(primeiro);
  };

  const soltar = (evento: DragEvent<HTMLDivElement>): void => {
    evento.preventDefault();
    definirArrastando(false);
    receber(evento.dataTransfer.files);
  };

  const escolhido = arquivo === null ? null : formatarTamanho(arquivo.size);

  return (
    <div className="flex h-full flex-col gap-xs">
      <div
        onDragOver={(evento) => {
          evento.preventDefault();

          if (!desabilitada) {
            definirArrastando(true);
          }
        }}
        onDragLeave={() => definirArrastando(false)}
        onDrop={soltar}
        data-zona-de-arquivo=""
        data-arrastando={arrastando ? 'true' : undefined}
        className={juntar(
          'group flex min-h-[15rem] flex-1 flex-col items-center justify-center gap-md rounded-xl border-2 border-dashed',
          'px-lg py-lg text-center transition-colors duration-fast ease-out',
          arrastando
            ? 'border-ring bg-accent'
            : temErro
              ? 'border-destructive bg-secondary'
              : 'border-input bg-secondary hover:bg-muted',
        )}
      >
        <span
          className={juntar(
            'flex size-14 items-center justify-center rounded-full bg-card text-foreground',
            'shadow-[var(--elevation-1)] ring-1 ring-border transition-transform duration-normal ease-out',
            arrastando ? 'motion-safe:scale-110' : 'motion-safe:group-hover:scale-105',
          )}
          aria-hidden="true"
        >
          {arquivo === null ? (
            <CloudUpload className="size-icon-xl" />
          ) : (
            <FileKey className="size-icon-xl" />
          )}
        </span>

        {arquivo === null || escolhido === null ? (
          <div className="flex flex-col gap-xs">
            <p className="text-title-sm text-foreground">
              {arrastando ? 'Solte para selecionar' : 'Arraste o arquivo .pfx ou .p12 aqui'}
            </p>
            <p id={idDaDescricao} className="text-body-sm text-muted-foreground">
              ou escolha o arquivo no computador
            </p>
          </div>
        ) : (
          <div className="flex min-w-0 max-w-full flex-col gap-xs">
            <p
              id={idDaDescricao}
              className="break-all text-title-sm text-foreground [overflow-wrap:anywhere]"
            >
              {arquivo.name}
            </p>
            <p className="text-body-sm text-muted-foreground">
              <span className="font-mono text-code-sm tabular-nums">{escolhido.valor}</span>{' '}
              {escolhido.unidade} · pronto para validar
            </p>
          </div>
        )}

        {/* O input é real e fica acessível a leitores de tela; o botão é o controle do teclado. */}
        <input
          ref={entrada}
          id={id}
          type="file"
          accept={ACEITA}
          tabIndex={-1}
          disabled={desabilitada}
          aria-label="Arquivo do certificado (.pfx ou .p12)"
          aria-describedby={temErro ? `${idDaDescricao} ${idDoErro}` : idDaDescricao}
          aria-invalid={temErro}
          className="sr-only"
          onChange={(evento) => {
            receber(evento.target.files);
            // Permite escolher de novo o mesmo arquivo depois de corrigir a senha.
            evento.target.value = '';
          }}
        />

        <div className="flex flex-wrap items-center justify-center gap-sm">
          <Button
            variante="contorno"
            tamanho="compacto"
            disabled={desabilitada}
            onClick={() => entrada.current?.click()}
            aria-describedby={idDaDescricao}
          >
            {arquivo === null ? 'Escolher arquivo' : 'Trocar arquivo'}
          </Button>
          {arquivo === null ? null : (
            <Button variante="fantasma" tamanho="compacto" disabled={desabilitada} onClick={aoRemover}>
              <X aria-hidden="true" />
              Remover
            </Button>
          )}
        </div>

        <ul className="flex flex-wrap items-center justify-center gap-sm" aria-label="Requisitos do arquivo">
          <li className="rounded-sm bg-muted px-sm py-xs font-mono text-code-xs text-foreground">
            Máx. {LIMITE_EM_MB} MB
          </li>
          <li className="rounded-sm bg-muted px-sm py-xs font-mono text-code-xs text-foreground">
            PKCS#12
          </li>
        </ul>
      </div>

      {temErro ? (
        <p id={idDoErro} className="text-body-sm text-danger-foreground">
          {erro}
        </p>
      ) : null}
    </div>
  );
};
