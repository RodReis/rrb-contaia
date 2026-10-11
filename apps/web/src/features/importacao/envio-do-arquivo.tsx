/**
 * Seleção do arquivo (SPEC-013/014 §3.2, §5.3 "arquivo rejeitado antes do envio"; SPEC-015 §3.1,
 * §5.2 itens 1 e 2): CSV, XLSX ou ODS, com os formatos aceitos e os modelos oficiais do domínio ao
 * lado da área de envio.
 *
 * Dropzone de verdade, como a dos documentos: `<input type="file">` real, estado de arrasto e a
 * checagem de extensão e tamanho **antes** do envio — o protótipo tinha um `<div>` clicável sem
 * input (DEBITO.md §D-15). Há dois inputs, um por caminho, para o seletor do sistema já abrir
 * filtrado; os dois (e o arrasto) passam pela mesma checagem. O CSV tem o cabeçalho lido aqui; a
 * planilha segue para a inspeção no servidor (o navegador não abre XLSX/ODS).
 */
'use client';

import {
  TIPO_DE_CONTEUDO_ODS,
  TIPO_DE_CONTEUDO_XLSX,
  formatoPelaExtensao,
  mensagemDaFalha,
  tipoDeConteudoDoFormato,
  validarArquivo,
} from '@contaia/shared';
import { FileSpreadsheet, FileUp, LoaderCircle, Upload } from 'lucide-react';
import { useId, useRef, useState, type DragEvent } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { mensagemDoCodigo } from '@/lib/mensagens';
import { caminhoDoModelo, novoCorrelationId } from './api';
import { FORMATOS_DO_MODELO, nomeDoModelo } from './apresentacao-da-planilha';
import { lerCabecalhoDoArquivo, type LeituraDoCabecalho } from './cabecalho-csv';
import type { DominioDaImportacao } from './dominio';
import { BotaoDeDownload } from './pecas';

export type ArquivoLido = Readonly<{
  tipo: 'CSV';
  arquivo: File;
  leitura: Extract<LeituraDoCabecalho, { tipo: 'LIDO' }>;
}>;

/** Planilha escolhida: ainda não lida. `selecao` identifica esta escolha no cache da inspeção. */
export type PlanilhaEscolhida = Readonly<{
  tipo: 'PLANILHA';
  arquivo: File;
  formato: 'XLSX' | 'ODS';
  selecao: string;
}>;

export type ArquivoEscolhido = ArquivoLido | PlanilhaEscolhida;

const ACEITOS_NA_PLANILHA = ['.xlsx', '.ods', TIPO_DE_CONTEUDO_XLSX, TIPO_DE_CONTEUDO_ODS].join(',');

/**
 * Pela extensão, não pelo `type` do navegador: o Windows com Excel entrega `.csv` como
 * `application/vnd.ms-excel` e alguns sistemas não entregam tipo nenhum. Outra extensão (até `.txt`)
 * é formato não aceito; `.xls` e `.xlsm` têm recusa própria, dita pelo nome.
 */
const tipoDeclarado = (arquivo: File): string => {
  const formato = formatoPelaExtensao(arquivo.name);

  return formato === null ? 'application/octet-stream' : tipoDeConteudoDoFormato(formato);
};

const ModelosOficiais = ({ dominio, empresaId }: { dominio: DominioDaImportacao; empresaId: string }) => {
  const id = useId();

  return (
    <div role="group" aria-labelledby={id} className="flex flex-col gap-xs tablet:flex-row tablet:items-start tablet:gap-md">
      <p id={id} className="pt-sm text-label-sm uppercase text-muted-foreground tablet:shrink-0">
        {dominio.textos.modelos}
      </p>
      <div className="flex flex-wrap gap-sm">
        {FORMATOS_DO_MODELO.map((formato) => (
          <BotaoDeDownload
            key={formato}
            rotulo={`Baixar modelo ${formato.toUpperCase()}`}
            variante="fantasma"
            caminho={caminhoDoModelo(dominio, empresaId, formato)}
            nomePadrao={nomeDoModelo(dominio.nomeDoModelo, formato)}
            indisponivel={`O modelo ${formato.toUpperCase()} não está disponível agora.`}
            rotuloDeNovaTentativa={`Tentar baixar de novo o modelo ${formato.toUpperCase()}`}
          />
        ))}
      </div>
    </div>
  );
};

const Formato = ({ extensao }: { extensao: string }) => (
  <code className="rounded-sm bg-muted px-xs font-mono text-code-sm text-foreground">{extensao}</code>
);

export const EnvioDoArquivo = ({
  dominio,
  empresaId,
  podeBaixar,
  aoEscolher,
}: {
  dominio: DominioDaImportacao;
  empresaId: string;
  podeBaixar: boolean;
  aoEscolher: (escolhido: ArquivoEscolhido) => void;
}) => {
  const [arrastando, definirArrastando] = useState(false);
  const [lendo, definirLendo] = useState(false);
  const [recusa, definirRecusa] = useState<Readonly<{ nome: string; motivo: string }> | null>(null);
  const entradaDoCsv = useRef<HTMLInputElement>(null);
  const entradaDaPlanilha = useRef<HTMLInputElement>(null);
  // Trava síncrona: dois arquivos soltos em sequência chegam antes de o estado `lendo` renderizar,
  // e o segundo não pode atropelar a leitura do primeiro.
  const leituraEmCurso = useRef(false);
  const id = useId();
  const idDaAjuda = `${id}-ajuda`;
  const idDaRecusa = `${id}-recusa`;
  const descricao = recusa === null ? idDaAjuda : `${idDaAjuda} ${idDaRecusa}`;

  const escolher = async (arquivo: File | undefined): Promise<void> => {
    if (arquivo === undefined || leituraEmCurso.current) {
      return;
    }

    const falha = validarArquivo(dominio.tipoDeArquivo, {
      tipoConteudo: tipoDeclarado(arquivo),
      tamanhoBytes: arquivo.size,
      nome: arquivo.name,
    });

    if (falha !== null) {
      definirRecusa({ nome: arquivo.name, motivo: mensagemDaFalha(dominio.tipoDeArquivo, falha) });
      return;
    }

    const formato = formatoPelaExtensao(arquivo.name);

    if (formato === 'XLSX' || formato === 'ODS') {
      definirRecusa(null);
      aoEscolher({ tipo: 'PLANILHA', arquivo, formato, selecao: novoCorrelationId() });
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

    aoEscolher({ tipo: 'CSV', arquivo, leitura });
  };

  const soltar = (evento: DragEvent<HTMLDivElement>): void => {
    evento.preventDefault();
    definirArrastando(false);
    void escolher(evento.dataTransfer.files[0]);
  };

  return (
    <div className="flex flex-col gap-md">
      {/*
        A zona é um `<div>` com os inputs reais dentro, e não um `<label>` envolvendo tudo: os botões
        precisam ser alcançáveis por teclado de forma previsível (mesma decisão dos documentos).
      */}
      <div
        data-zona-de-envio=""
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
        <p className="text-title-md text-foreground">{dominio.textos.arrasteAqui}</p>
        <div id={idDaAjuda} className="flex max-w-prose flex-col gap-xs text-body-sm text-muted-foreground">
          <p className="flex flex-wrap items-center justify-center gap-xs">
            <span>Formatos aceitos:</span>
            <Formato extensao=".csv" />
            <Formato extensao=".xlsx" />
            <Formato extensao=".ods" />
            <span aria-hidden="true">·</span>
            <span>
              até <span className="font-mono text-code-sm tabular-nums">10 MB</span> e{' '}
              <span className="font-mono text-code-sm tabular-nums">10.000</span> linhas de dados
            </span>
          </p>
          <p>Na planilha, uma aba por vez: você escolhe a aba e a linha do cabeçalho antes de associar as colunas.</p>
        </div>

        <input
          ref={entradaDoCsv}
          type="file"
          // Fora da ordem de Tab: escondido, teria foco invisível (WCAG 2.4.7). Os botões abaixo acionam.
          tabIndex={-1}
          className="sr-only"
          accept=".csv,text/csv"
          aria-label={dominio.textos.arquivoCsv}
          aria-describedby={descricao}
          onChange={(evento) => {
            void escolher(evento.target.files?.[0]);
            // Escolher o mesmo arquivo de novo (já corrigido) precisa disparar outra leitura.
            evento.target.value = '';
          }}
        />
        <input
          ref={entradaDaPlanilha}
          type="file"
          tabIndex={-1}
          className="sr-only"
          accept={ACEITOS_NA_PLANILHA}
          aria-label={dominio.textos.arquivoPlanilha}
          aria-describedby={descricao}
          onChange={(evento) => {
            void escolher(evento.target.files?.[0]);
            evento.target.value = '';
          }}
        />

        <div className="flex flex-wrap justify-center gap-sm">
          <Button variante="contorno" tamanho="compacto" disabled={lendo} onClick={() => entradaDoCsv.current?.click()}>
            {lendo ? <LoaderCircle className="motion-safe:animate-spin" aria-hidden="true" /> : <Upload aria-hidden="true" />}
            {lendo ? 'Lendo o cabeçalho' : 'Escolher arquivo CSV'}
          </Button>
          <Button variante="contorno" tamanho="compacto" disabled={lendo} onClick={() => entradaDaPlanilha.current?.click()}>
            <FileSpreadsheet aria-hidden="true" />
            Escolher planilha XLSX ou ODS
          </Button>
        </div>
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

      {podeBaixar ? <ModelosOficiais dominio={dominio} empresaId={empresaId} /> : null}
    </div>
  );
};

