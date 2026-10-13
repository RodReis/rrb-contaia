/**
 * Área de envio da NF-e de teste (SPEC-016 §3.6): `<input type="file">` real e acessível, estado de
 * arrasto, arquivo escolhido visível e erro ligado ao campo. Extensão e tamanho são conferidos aqui
 * antes de gastar a rede; a fronteira real é a API. O arquivo nunca é lido nem guardado por esta
 * peça: o navegador só o entrega ao `FormData` do envio, e nada do conteúdo vai a estado, URL ou log.
 */
'use client';

import { LIMITE_DA_NFE_BYTES } from '@contaia/shared';
import { CloudUpload, FileCode, X } from 'lucide-react';
import { useId, useRef, useState, type DragEvent } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { formatarTamanho } from '@/lib/arquivo';

const LIMITE_EM_MB = LIMITE_DA_NFE_BYTES / (1024 * 1024);

export const ERRO_DE_EXTENSAO = 'O arquivo precisa ser um XML de NF-e (.xml).';
export const ERRO_DE_ARQUIVO_GRANDE = `O arquivo passa do limite de ${LIMITE_EM_MB} MB para a simulação.`;
export const ERRO_DE_VARIOS_ARQUIVOS = 'Envie uma única NF-e por vez.';

export const ZonaDeXml = ({
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
  /** Arquivo recusado antes do envio (extensão, tamanho, quantidade): a decisão de exibir é da tela. */
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
    if (!primeiro.name.toLowerCase().endsWith('.xml')) {
      aoRejeitar(ERRO_DE_EXTENSAO);

      return;
    }
    if (primeiro.size > LIMITE_DA_NFE_BYTES) {
      aoRejeitar(ERRO_DE_ARQUIVO_GRANDE);

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
    <div className="flex flex-col gap-xs">
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
        className={cn(
          'flex min-h-[11rem] flex-col items-center justify-center gap-sm rounded-xl border-2 border-dashed',
          'px-lg py-lg text-center transition-colors duration-fast ease-out',
          arrastando ? 'border-ring bg-accent' : temErro ? 'border-destructive bg-secondary' : 'border-input bg-secondary hover:bg-muted',
        )}
      >
        <span className="flex size-12 items-center justify-center rounded-full bg-card text-foreground ring-1 ring-border" aria-hidden="true">
          {arquivo === null ? <CloudUpload className="size-icon-lg" /> : <FileCode className="size-icon-lg" />}
        </span>

        {arquivo === null || escolhido === null ? (
          <div className="flex flex-col gap-xs">
            <p className="text-title-sm text-foreground">{arrastando ? 'Solte para selecionar' : 'Arraste o XML da NF-e de teste aqui'}</p>
            <p id={idDaDescricao} className="text-body-sm text-muted-foreground">
              ou escolha o arquivo no computador
            </p>
          </div>
        ) : (
          <div className="flex min-w-0 max-w-full flex-col gap-xs">
            <p id={idDaDescricao} className="text-title-sm text-foreground [overflow-wrap:anywhere]">
              {arquivo.name}
            </p>
            <p className="text-body-sm text-muted-foreground">
              <span className="font-mono text-code-sm tabular-nums">{escolhido.valor}</span> {escolhido.unidade}
            </p>
          </div>
        )}

        {/* O input é real e acessível a leitor de tela; o botão é o controle do teclado. */}
        <input
          ref={entrada}
          id={id}
          type="file"
          accept=".xml,text/xml,application/xml"
          tabIndex={-1}
          disabled={desabilitada}
          aria-label="Arquivo XML da NF-e"
          aria-describedby={temErro ? `${idDaDescricao} ${idDoErro}` : idDaDescricao}
          aria-invalid={temErro}
          className="sr-only"
          onChange={(evento) => {
            receber(evento.target.files);
            // Permite escolher de novo o mesmo arquivo depois de corrigir o que faltava.
            evento.target.value = '';
          }}
        />

        <div className="flex flex-wrap items-center justify-center gap-sm">
          <Button variante="contorno" tamanho="compacto" disabled={desabilitada} onClick={() => entrada.current?.click()} aria-describedby={idDaDescricao}>
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
          <li className="rounded-sm bg-muted px-sm py-xs font-mono text-code-xs text-foreground">Máx. {LIMITE_EM_MB} MB</li>
          <li className="rounded-sm bg-muted px-sm py-xs font-mono text-code-xs text-foreground">NF-e 4.00 · modelo 55</li>
        </ul>

        <p className="max-w-prose text-body-sm text-muted-foreground">
          O arquivo é lido só para esta simulação: não é gravado nem enviado a serviço externo.
        </p>
      </div>

      {temErro ? (
        <p id={idDoErro} className="text-body-sm text-danger-foreground">
          {erro}
        </p>
      ) : null}
    </div>
  );
};
