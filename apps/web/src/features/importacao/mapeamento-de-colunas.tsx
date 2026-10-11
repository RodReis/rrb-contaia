/**
 * Mapeamento das colunas do arquivo para os campos do contrato do domínio (SPEC-013/014 §3.3, §7;
 * SPEC-015 §3.4).
 *
 * As colunas com o mesmo nome do modelo já vêm escolhidas; o resto é decisão de quem importa. A
 * regra é a do domínio (a mesma da API): todos os campos associados e nenhuma
 * coluna alimentando dois campos. O botão continua clicável (PATTERNS.md §6): com pendência, ele
 * destaca os campos, diz o que falta e leva o foco ao primeiro — e nada é enviado.
 *
 * A coluna é uma opção `{ valor, rotulo }`: no CSV os dois são o nome do cabeçalho; na planilha o
 * valor é a letra (o que vai para a API) e o rótulo é inequívoco ("Coluna C — Nome",
 * "Coluna D (sem nome)"), porque nomes repetidos ou vazios são comuns em planilha.
 */
'use client';

import { ArrowRight, FileText, LoaderCircle, RefreshCw } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import type { Problema } from '@/lib/http';
import { mensagemDoCodigo } from '@/lib/mensagens';
import { tamanhoEmTexto } from '@/lib/arquivo';
import { cn } from '@/lib/cn';
import { mapeamentoCompleto, type DominioDaImportacao, type PendenciaDoRascunho, type RascunhoDoMapeamento } from './dominio';
import type { ArquivoLido } from './envio-do-arquivo';
import { CodigoDeSuporte, RegiaoRolavel } from './pecas';

const NENHUMA_COLUNA = '__nenhuma-coluna__';

export type OpcaoDeColuna = Readonly<{ valor: string; rotulo: string }>;

const NOME_DO_DELIMITADOR: Readonly<Record<string, string>> = {
  ';': 'ponto e vírgula',
  ',': 'vírgula',
  '\t': 'tabulação',
};

const erroDoCampo = (
  dominio: DominioDaImportacao,
  pendencia: PendenciaDoRascunho | undefined,
  coluna: OpcaoDeColuna | undefined,
  tentou: boolean,
): string | undefined => {
  if (pendencia?.motivo === 'COLUNA_REPETIDA') {
    return `A coluna “${coluna?.rotulo ?? ''}” já alimenta outro campo; cada coluna serve a um campo só.`;
  }

  if (pendencia !== undefined && tentou) {
    return `Escolha a coluna para o campo ${dominio.rotuloDoCampo(pendencia.campo)}.`;
  }

  return undefined;
};

const AmostraDoArquivo = ({
  dominio,
  lido,
  rascunho,
}: {
  dominio: DominioDaImportacao;
  lido: ArquivoLido;
  rascunho: RascunhoDoMapeamento;
}) => {
  const campoDaColuna = (coluna: string): string | undefined =>
    dominio.campos.find((campo) => rascunho[campo] === coluna);

  return (
    <div className="flex flex-col gap-xs">
      <p className="text-title-sm text-foreground">Primeiras linhas do arquivo</p>
      <RegiaoRolavel rotulo="Tabela da amostra do arquivo, rolável na horizontal" className="rounded-md border border-border">
        <table className="w-full min-w-max text-left">
          <caption className="sr-only">Amostra das primeiras linhas de {lido.arquivo.name}</caption>
          <thead className="bg-muted">
            <tr>
              {lido.leitura.cabecalho.map((coluna) => {
                const campo = campoDaColuna(coluna);

                return (
                  <th key={coluna} scope="col" className="px-sm py-sm align-top">
                    <span className="block text-label-sm uppercase text-muted-foreground">{coluna}</span>
                    <span
                      className={cn(
                        'mt-xs inline-block rounded-sm px-xs text-label-sm',
                        campo === undefined ? 'text-muted-foreground' : 'bg-info text-info-foreground',
                      )}
                    >
                      {campo === undefined ? 'não usada' : `→ ${dominio.rotuloDoCampo(campo)}`}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {lido.leitura.amostra.map((linha, indice) => (
              <tr key={indice} className="border-t border-border">
                {lido.leitura.cabecalho.map((coluna, posicao) => (
                  <td key={coluna} className="whitespace-nowrap px-sm py-sm font-mono text-code-sm tabular-nums text-foreground">
                    {linha[posicao] === '' ? <span className="text-muted-foreground">vazio</span> : linha[posicao]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </RegiaoRolavel>
    </div>
  );
};

/**
 * Faixa do arquivo escolhido: nome (numa linha, inteiro no título), tamanho e o que se sabe dele, e
 * a troca de arquivo. Comum ao CSV e à planilha.
 */
export const FaixaDoArquivo = ({
  arquivo,
  detalhes,
  bloqueada,
  aoTrocar,
}: {
  arquivo: File;
  detalhes: ReactNode;
  bloqueada: boolean;
  aoTrocar: () => void;
}) => (
  <div className="flex flex-col gap-sm rounded-md bg-secondary px-md py-sm tablet:flex-row tablet:items-center tablet:justify-between">
    <p className="flex min-w-0 flex-wrap items-center gap-xs text-body-sm text-muted-foreground">
      <FileText className="size-icon-sm shrink-0 text-foreground" aria-hidden="true" />
      <span title={arquivo.name} className="min-w-0 max-w-full truncate font-mono text-code-sm text-foreground tablet:max-w-[22rem]">
        {arquivo.name}
      </span>
      <span aria-hidden="true">·</span>
      <span className="tabular-nums">{tamanhoEmTexto(arquivo.size)}</span>
      {detalhes}
    </p>
    <Button variante="fantasma" tamanho="compacto" disabled={bloqueada} onClick={aoTrocar}>
      <RefreshCw aria-hidden="true" />
      Trocar arquivo
    </Button>
  </div>
);

export const MapeamentoDeColunas = ({
  dominio,
  colunas,
  sugestao,
  enviando,
  falhaDoEnvio,
  aoEnviar,
  amostra,
}: {
  dominio: DominioDaImportacao;
  colunas: readonly OpcaoDeColuna[];
  /** Ponto de partida visível e editável: campo → valor da coluna. */
  sugestao: RascunhoDoMapeamento;
  enviando: boolean;
  falhaDoEnvio: Problema | null;
  aoEnviar: (mapeamento: Readonly<Record<string, string>>) => void;
  /** Amostra do arquivo, que pode marcar a coluna de cada campo no rascunho atual. */
  amostra?: (rascunho: RascunhoDoMapeamento) => ReactNode;
}) => {
  const [rascunho, definirRascunho] = useState<RascunhoDoMapeamento>(sugestao);
  const [tentou, definirTentou] = useState(false);
  const campos = useRef<HTMLDivElement>(null);

  const pendencias = dominio.pendenciasDoRascunho(
    colunas.map((coluna) => coluna.valor),
    rascunho,
  );
  const pendenciaDe = (campo: string): PendenciaDoRascunho | undefined =>
    pendencias.find((pendencia) => pendencia.campo === campo);
  const colunaDe = (valor: string | undefined): OpcaoDeColuna | undefined => colunas.find((coluna) => coluna.valor === valor);

  const opcoes = [{ valor: NENHUMA_COLUNA, rotulo: 'Nenhuma coluna' }, ...colunas];

  const associar = (campo: string, valor: string): void => {
    definirRascunho((atual) => {
      const proximo: Partial<Record<string, string>> = { ...atual };

      if (valor === NENHUMA_COLUNA) {
        delete proximo[campo];
      } else {
        proximo[campo] = valor;
      }

      return proximo;
    });
  };

  const validar = (): void => {
    definirTentou(true);
    const primeira = pendencias[0];

    if (primeira !== undefined) {
      campos.current?.querySelector<HTMLButtonElement>(`[data-campo="${primeira.campo}"] button`)?.focus();
      return;
    }

    aoEnviar(mapeamentoCompleto(dominio, rascunho));
  };

  return (
    <div className="flex flex-col gap-lg">
      <fieldset className="flex flex-col gap-md">
        <legend className="mb-sm flex flex-col gap-xs">
          <span className="text-title-md text-foreground">Associe as colunas do arquivo</span>
          <span className="text-body-sm text-muted-foreground">
            Os cinco campos são obrigatórios, e cada coluna alimenta um campo só. Colunas com o nome do modelo
            do ContaIA já vêm escolhidas; confira antes de validar.
          </span>
        </legend>

        <div ref={campos} className="grid gap-md tablet:grid-cols-2">
          {dominio.campos.map((campo) => (
            <div key={campo} data-campo={campo} className="min-w-0">
              <Select
                rotulo={dominio.rotuloDoCampo(campo)}
                obrigatorio
                opcoes={opcoes}
                valor={rascunho[campo]}
                placeholder="Escolha a coluna"
                onValorChange={(valor) => associar(campo, valor)}
                erro={erroDoCampo(dominio, pendenciaDe(campo), colunaDe(rascunho[campo]), tentou)}
                ajuda={dominio.ajudaDoCampo(campo)}
                disabled={enviando}
              />
            </div>
          ))}
        </div>
      </fieldset>

      {amostra?.(rascunho)}

      {tentou && pendencias.length > 0 ? (
        <p role="alert" className="rounded-md bg-danger px-md py-sm text-body-sm text-danger-foreground">
          O mapeamento ainda não pode ser validado. Revise:{' '}
          {pendencias.map((pendencia) => dominio.rotuloDoCampo(pendencia.campo)).join(', ')}.
        </p>
      ) : null}

      {falhaDoEnvio === null ? null : (
        <div role="alert" className="flex flex-col gap-xs rounded-md border border-danger-indicator/40 bg-danger px-md py-sm">
          <p className="text-title-sm text-danger-foreground">O arquivo não foi aceito para validação</p>
          <p className="text-body-sm text-danger-foreground">{mensagemDoCodigo(falhaDoEnvio.code)}</p>
          <CodigoDeSuporte valor={falhaDoEnvio.correlationId} className="text-body-sm text-danger-foreground" />
        </div>
      )}

      <div className="flex flex-wrap justify-end gap-sm">
        <Button disabled={enviando} onClick={validar}>
          {enviando ? <LoaderCircle className="motion-safe:animate-spin" aria-hidden="true" /> : null}
          Validar arquivo
          {enviando ? null : <ArrowRight aria-hidden="true" />}
        </Button>
      </div>
    </div>
  );
};

/** O caminho do CSV, como nas F13/F14: colunas pelo nome do cabeçalho lido no navegador. */
export const MapeamentoDoCsv = ({
  dominio,
  lido,
  enviando,
  falhaDoEnvio,
  aoEnviar,
  aoTrocar,
}: {
  dominio: DominioDaImportacao;
  lido: ArquivoLido;
  enviando: boolean;
  falhaDoEnvio: Problema | null;
  aoEnviar: (mapeamento: Readonly<Record<string, string>>) => void;
  aoTrocar: () => void;
}) => {
  const { cabecalho } = lido.leitura;

  return (
    <div className="flex flex-col gap-lg">
      <FaixaDoArquivo
        arquivo={lido.arquivo}
        bloqueada={enviando}
        aoTrocar={aoTrocar}
        detalhes={
          <>
            <span aria-hidden="true">·</span>
            <span>
              {cabecalho.length} colunas separadas por {NOME_DO_DELIMITADOR[lido.leitura.delimitador] ?? 'delimitador'}
            </span>
          </>
        }
      />
      <MapeamentoDeColunas
        dominio={dominio}
        colunas={cabecalho.map((coluna) => ({ valor: coluna, rotulo: coluna }))}
        sugestao={dominio.mapeamentoSugerido(cabecalho)}
        enviando={enviando}
        falhaDoEnvio={falhaDoEnvio}
        aoEnviar={aoEnviar}
        amostra={(rascunho) => <AmostraDoArquivo dominio={dominio} lido={lido} rascunho={rascunho} />}
      />
    </div>
  );
};
