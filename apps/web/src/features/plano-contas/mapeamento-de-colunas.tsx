/**
 * Mapeamento das colunas do arquivo para os cinco campos do contrato (SPEC-013 §3.3, §7).
 *
 * As colunas com o mesmo nome do modelo já vêm escolhidas; o resto é decisão de quem importa. A
 * regra é a do domínio (`validarMapeamento`, a mesma da API): os cinco campos associados e nenhuma
 * coluna alimentando dois campos. O botão continua clicável (PATTERNS.md §6): com pendência, ele
 * destaca os campos, diz o que falta e leva o foco ao primeiro — e nada é enviado.
 */
'use client';

import { CAMPOS_DO_CONTRATO, type CampoDoContrato, type Mapeamento, type PendenciaDoMapeamento } from '@contaia/domain';
import { ArrowRight, FileText, LoaderCircle, RefreshCw } from 'lucide-react';
import { useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import type { Problema } from '@/lib/http';
import { mensagemDoCodigo } from '@/lib/mensagens';
import { tamanhoEmTexto } from '@/lib/arquivo';
import { cn } from '@/lib/cn';
import { AJUDA_DO_CAMPO, ROTULO_DO_CAMPO } from './apresentacao';
import { mapeamentoSugerido, pendenciasDoRascunho, type RascunhoDoMapeamento } from './cabecalho-csv';
import type { ArquivoLido } from './envio-do-csv';
import { CodigoDeSuporte, RegiaoRolavel } from './pecas';

const NENHUMA_COLUNA = '__nenhuma-coluna__';

const NOME_DO_DELIMITADOR: Readonly<Record<string, string>> = {
  ';': 'ponto e vírgula',
  ',': 'vírgula',
  '\t': 'tabulação',
};

const erroDoCampo = (
  pendencia: PendenciaDoMapeamento | undefined,
  coluna: string | undefined,
  tentou: boolean,
): string | undefined => {
  if (pendencia?.motivo === 'COLUNA_REPETIDA') {
    return `A coluna “${coluna ?? ''}” já alimenta outro campo; cada coluna serve a um campo só.`;
  }

  if (pendencia !== undefined && tentou) {
    return `Escolha a coluna para o campo ${ROTULO_DO_CAMPO[pendencia.campo]}.`;
  }

  return undefined;
};

const mapeamentoCompleto = (rascunho: RascunhoDoMapeamento): Mapeamento => ({
  codigo: rascunho.codigo ?? '',
  nome: rascunho.nome ?? '',
  tipo: rascunho.tipo ?? '',
  natureza: rascunho.natureza ?? '',
  conta_pai: rascunho.conta_pai ?? '',
});

const AmostraDoArquivo = ({
  lido,
  rascunho,
}: {
  lido: ArquivoLido;
  rascunho: RascunhoDoMapeamento;
}) => {
  const campoDaColuna = (coluna: string): CampoDoContrato | undefined =>
    CAMPOS_DO_CONTRATO.find((campo) => rascunho[campo] === coluna);

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
                      {campo === undefined ? 'não usada' : `→ ${ROTULO_DO_CAMPO[campo]}`}
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

export const MapeamentoDeColunas = ({
  lido,
  enviando,
  falhaDoEnvio,
  aoEnviar,
  aoTrocar,
}: {
  lido: ArquivoLido;
  enviando: boolean;
  falhaDoEnvio: Problema | null;
  aoEnviar: (mapeamento: Mapeamento) => void;
  aoTrocar: () => void;
}) => {
  const { cabecalho } = lido.leitura;
  const [rascunho, definirRascunho] = useState<RascunhoDoMapeamento>(() => mapeamentoSugerido(cabecalho));
  const [tentou, definirTentou] = useState(false);
  const campos = useRef<HTMLDivElement>(null);

  const pendencias = pendenciasDoRascunho(cabecalho, rascunho);
  const pendenciaDe = (campo: CampoDoContrato): PendenciaDoMapeamento | undefined =>
    pendencias.find((pendencia) => pendencia.campo === campo);

  const opcoes = [
    { valor: NENHUMA_COLUNA, rotulo: 'Nenhuma coluna' },
    ...cabecalho.map((coluna) => ({ valor: coluna, rotulo: coluna })),
  ];

  const associar = (campo: CampoDoContrato, valor: string): void => {
    definirRascunho((atual) => {
      const proximo: Partial<Record<CampoDoContrato, string>> = { ...atual };

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

    aoEnviar(mapeamentoCompleto(rascunho));
  };

  return (
    <div className="flex flex-col gap-lg">
      <div className="flex flex-col gap-sm rounded-md bg-secondary px-md py-sm tablet:flex-row tablet:items-center tablet:justify-between">
        <p className="flex min-w-0 flex-wrap items-center gap-xs text-body-sm text-muted-foreground">
          <FileText className="size-icon-sm shrink-0 text-foreground" aria-hidden="true" />
          <span className="font-mono text-code-sm text-foreground [overflow-wrap:anywhere]">{lido.arquivo.name}</span>
          <span aria-hidden="true">·</span>
          <span className="tabular-nums">{tamanhoEmTexto(lido.arquivo.size)}</span>
          <span aria-hidden="true">·</span>
          <span>
            {cabecalho.length} colunas separadas por {NOME_DO_DELIMITADOR[lido.leitura.delimitador] ?? 'delimitador'}
          </span>
        </p>
        <Button variante="fantasma" tamanho="compacto" disabled={enviando} onClick={aoTrocar}>
          <RefreshCw aria-hidden="true" />
          Trocar arquivo
        </Button>
      </div>

      <fieldset className="flex flex-col gap-md">
        <legend className="mb-sm flex flex-col gap-xs">
          <span className="text-title-md text-foreground">Associe as colunas do arquivo</span>
          <span className="text-body-sm text-muted-foreground">
            Os cinco campos são obrigatórios, e cada coluna alimenta um campo só. Colunas com o nome do modelo
            do ContaIA já vêm escolhidas; confira antes de validar.
          </span>
        </legend>

        <div ref={campos} className="grid gap-md tablet:grid-cols-2">
          {CAMPOS_DO_CONTRATO.map((campo) => (
            <div key={campo} data-campo={campo}>
              <Select
                rotulo={ROTULO_DO_CAMPO[campo]}
                obrigatorio
                opcoes={opcoes}
                valor={rascunho[campo]}
                placeholder="Escolha a coluna"
                onValorChange={(valor) => associar(campo, valor)}
                erro={erroDoCampo(pendenciaDe(campo), rascunho[campo], tentou)}
                ajuda={AJUDA_DO_CAMPO[campo]}
                disabled={enviando}
              />
            </div>
          ))}
        </div>
      </fieldset>

      <AmostraDoArquivo lido={lido} rascunho={rascunho} />

      {tentou && pendencias.length > 0 ? (
        <p role="alert" className="rounded-md bg-danger px-md py-sm text-body-sm text-danger-foreground">
          O mapeamento ainda não pode ser validado. Revise:{' '}
          {pendencias.map((pendencia) => ROTULO_DO_CAMPO[pendencia.campo]).join(', ')}.
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
