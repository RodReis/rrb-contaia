'use client';

import { FileText, Trash2, Upload } from 'lucide-react';
import { useId, useRef, useState } from 'react';

import { REGRAS_DE_ARQUIVO, mensagemDaFalha, validarArquivo } from '@contaia/shared';
import type { TipoDeArquivoDoEscritorio } from '@contaia/shared';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { useArquivarDocumento, useEnviarArquivo } from './queries';
import type { ArquivoDaVisao } from './api';

const formatarTamanho = (bytes: number): string =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;

export const UploadDeArquivo = ({
  tipo,
  rotulo,
  descricao,
  obrigatorio = false,
  arquivos,
  permiteRemover = false,
}: {
  tipo: TipoDeArquivoDoEscritorio;
  rotulo: string;
  descricao: string;
  obrigatorio?: boolean;
  arquivos: readonly ArquivoDaVisao[];
  permiteRemover?: boolean;
}) => {
  const idDoInput = useId();
  const entrada = useRef<HTMLInputElement>(null);
  const [arrastando, definirArrastando] = useState(false);
  const [erroLocal, definirErroLocal] = useState<string | null>(null);

  const enviar = useEnviarArquivo();
  const arquivar = useArquivarDocumento();
  const regra = REGRAS_DE_ARQUIVO[tipo];

  const processar = (arquivo: File | undefined): void => {
    if (arquivo === undefined) {
      return;
    }

    // Mesma regra da API: o limite e os formatos vêm de uma fonte só.
    const falha = validarArquivo(tipo, {
      tipoConteudo: arquivo.type,
      tamanhoBytes: arquivo.size,
    });

    if (falha !== null) {
      definirErroLocal(mensagemDaFalha(tipo, falha));

      return;
    }

    definirErroLocal(null);
    enviar.mutate({ tipo, arquivo });
  };

  return (
    <div className="flex flex-col gap-xs">
      <label htmlFor={idDoInput} className="text-label-md text-foreground">
        {rotulo}
        {obrigatorio ? (
          <span className="ml-xs text-danger-foreground" aria-hidden="true">
            *
          </span>
        ) : null}
      </label>

      <div
        onDragOver={(evento) => {
          evento.preventDefault();
          definirArrastando(true);
        }}
        onDragLeave={() => definirArrastando(false)}
        onDrop={(evento) => {
          evento.preventDefault();
          definirArrastando(false);
          processar(evento.dataTransfer.files[0]);
        }}
        className={cn(
          'flex flex-col items-center gap-sm rounded-lg border border-dashed px-lg py-lg text-center transition-colors duration-fast ease-out',
          arrastando ? 'border-ring bg-accent' : 'border-border bg-card',
        )}
      >
        <Upload className="size-icon-xl text-muted-foreground" aria-hidden="true" />
        <p id={`${idDoInput}-descricao`} className="text-body-sm text-muted-foreground">
          {descricao}
        </p>

        <input
          ref={entrada}
          id={idDoInput}
          type="file"
          accept={regra.tiposAceitos.join(',')}
          required={obrigatorio && arquivos.length === 0}
          aria-describedby={`${idDoInput}-descricao`}
          className="sr-only"
          onChange={(evento) => {
            processar(evento.target.files?.[0]);
            evento.target.value = '';
          }}
        />

        <Button
          variante="contorno"
          tamanho="compacto"
          onClick={() => entrada.current?.click()}
          disabled={enviar.isPending}
        >
          {enviar.isPending ? 'Enviando…' : 'Escolher arquivo'}
        </Button>
      </div>

      {erroLocal !== null ? (
        <p role="alert" className="text-body-sm text-danger-foreground">
          {erroLocal}
        </p>
      ) : null}

      {arquivos.length > 0 ? (
        <ul className="flex flex-col gap-xs" aria-label={`Arquivos enviados: ${rotulo}`}>
          {arquivos.map((arquivo) => (
            <li
              key={arquivo.id}
              className="flex items-center justify-between gap-sm rounded-md border border-border bg-card px-md py-sm"
            >
              <span className="flex min-w-0 items-center gap-sm">
                <FileText className="size-icon-sm shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-body-sm text-foreground">
                    {arquivo.nomeOriginal}
                  </span>
                  <span className="font-mono text-code-xs tabular-nums text-muted-foreground">
                    {formatarTamanho(arquivo.tamanhoBytes)}
                  </span>
                </span>
              </span>

              {permiteRemover ? (
                <Button
                  variante="fantasma"
                  tamanho="icone"
                  aria-label={`Remover ${arquivo.nomeOriginal}`}
                  disabled={arquivar.isPending}
                  onClick={() => arquivar.mutate(arquivo.id)}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
};
