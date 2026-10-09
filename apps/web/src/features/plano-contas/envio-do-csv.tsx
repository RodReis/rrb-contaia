/**
 * Seleção do CSV (SPEC-013 §3.2, §5.3 "arquivo rejeitado antes do envio").
 *
 * Dropzone de verdade, como a dos documentos: `<input type="file">` real, estado de arrasto e a
 * checagem de extensão, tamanho e conteúdo **antes** do envio — o protótipo tinha um `<div>`
 * clicável sem input (DEBITO.md §D-15). O cabeçalho já é lido aqui para montar o mapeamento.
 */
'use client';

import { REGRAS_DE_ARQUIVO, mensagemDaFalha, validarArquivo } from '@contaia/shared';
import { FileUp, LoaderCircle, Upload } from 'lucide-react';
import { useId, useRef, useState, type DragEvent } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { mensagemDoCodigo } from '@/lib/mensagens';
import { lerCabecalhoDoArquivo, type LeituraDoCabecalho } from './cabecalho-csv';

const REGRA = REGRAS_DE_ARQUIVO.IMPORTACAO_PLANO_CONTAS;

export type ArquivoLido = Readonly<{
  arquivo: File;
  leitura: Extract<LeituraDoCabecalho, { tipo: 'LIDO' }>;
}>;

/**
 * Pela extensão, não pelo `type` do navegador: o Windows com Excel instalado entrega `.csv` como
 * `application/vnd.ms-excel` e alguns sistemas não entregam tipo nenhum. Outra extensão (até
 * `.txt`, que o navegador chama de `text/plain`) é formato não aceito; o conteúdo ainda é conferido
 * na leitura do cabeçalho.
 */
const tipoDeclarado = (arquivo: File): string =>
  REGRA.extensoesAceitas.some((extensao) => arquivo.name.toLowerCase().endsWith(extensao))
    ? 'text/csv'
    : 'application/octet-stream';

export const EnvioDoCsv = ({ aoLer }: { aoLer: (lido: ArquivoLido) => void }) => {
  const [arrastando, definirArrastando] = useState(false);
  const [lendo, definirLendo] = useState(false);
  const [recusa, definirRecusa] = useState<Readonly<{ nome: string; motivo: string }> | null>(null);
  const entrada = useRef<HTMLInputElement>(null);
  // Trava síncrona: dois arquivos soltos em sequência chegam antes de o estado `lendo` renderizar,
  // e o segundo não pode atropelar a leitura do primeiro.
  const leituraEmCurso = useRef(false);
  const id = useId();
  const idDaAjuda = `${id}-ajuda`;
  const idDaRecusa = `${id}-recusa`;

  const escolher = async (arquivo: File | undefined): Promise<void> => {
    if (arquivo === undefined || leituraEmCurso.current) {
      return;
    }

    const falha = validarArquivo('IMPORTACAO_PLANO_CONTAS', {
      tipoConteudo: tipoDeclarado(arquivo),
      tamanhoBytes: arquivo.size,
    });

    if (falha !== null) {
      definirRecusa({ nome: arquivo.name, motivo: mensagemDaFalha('IMPORTACAO_PLANO_CONTAS', falha) });
      return;
    }

    leituraEmCurso.current = true;
    definirLendo(true);
    definirRecusa(null);
    let leitura: LeituraDoCabecalho;

    try {
      leitura = await lerCabecalhoDoArquivo(arquivo);
    } finally {
      leituraEmCurso.current = false;
      definirLendo(false);
    }

    if (leitura.tipo === 'RECUSADO') {
      definirRecusa({ nome: arquivo.name, motivo: mensagemDoCodigo(leitura.codigo) });
      return;
    }

    aoLer({ arquivo, leitura });
  };

  const soltar = (evento: DragEvent<HTMLDivElement>): void => {
    evento.preventDefault();
    definirArrastando(false);
    void escolher(evento.dataTransfer.files[0]);
  };

  return (
    <div className="flex flex-col gap-md">
      {/*
        A zona é um `<div>` com o input real dentro, e não um `<label>` envolvendo tudo: o botão
        precisa ser alcançável por teclado de forma previsível (mesma decisão dos documentos).
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
          arrastando ? 'border-ring bg-accent' : 'border-input bg-secondary/60',
          recusa !== null && !arrastando && 'border-danger-indicator/60',
        )}
      >
        <span className="text-muted-foreground [&_svg]:size-icon-xl" aria-hidden="true">
          <FileUp />
        </span>
        <p className="text-title-md text-foreground">Arraste o CSV do plano de contas aqui</p>
        <p id={idDaAjuda} className="text-body-sm text-muted-foreground">
          Arquivo <span className="font-mono text-code-sm">.csv</span> de até{' '}
          <span className="font-mono text-code-sm tabular-nums">10 MB</span> e até{' '}
          <span className="font-mono text-code-sm tabular-nums">10.000</span> linhas de dados.
        </p>

        <input
          ref={entrada}
          id={id}
          type="file"
          // Fora da ordem de Tab: escondido, teria foco invisível (WCAG 2.4.7). O botão abaixo aciona.
          tabIndex={-1}
          className="sr-only"
          accept=".csv,text/csv"
          aria-label="Arquivo CSV do plano de contas"
          aria-describedby={recusa === null ? idDaAjuda : `${idDaAjuda} ${idDaRecusa}`}
          onChange={(evento) => {
            void escolher(evento.target.files?.[0]);
            // Escolher o mesmo arquivo de novo (já corrigido) precisa disparar outra leitura.
            evento.target.value = '';
          }}
        />

        <Button variante="contorno" tamanho="compacto" disabled={lendo} onClick={() => entrada.current?.click()}>
          {lendo ? (
            <LoaderCircle className="motion-safe:animate-spin" aria-hidden="true" />
          ) : (
            <Upload aria-hidden="true" />
          )}
          {lendo ? 'Lendo o cabeçalho' : 'Escolher arquivo CSV'}
        </Button>
      </div>

      {recusa === null ? null : (
        <div
          id={idDaRecusa}
          role="alert"
          className="flex flex-col gap-xs rounded-md border border-danger-indicator/40 bg-danger px-md py-sm"
        >
          <p className="text-title-sm text-danger-foreground">
            Arquivo recusado antes do envio: <span className="[overflow-wrap:anywhere]">{recusa.nome}</span>
          </p>
          <p className="text-body-sm text-danger-foreground">
            {recusa.motivo} Nada foi enviado; corrija o arquivo e escolha de novo.
          </p>
        </div>
      )}
    </div>
  );
};
