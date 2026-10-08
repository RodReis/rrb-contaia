/**
 * Rejeições da tentativa, paginadas (SPEC-013 §3.4, §3.5): linha, código, campo, código de erro
 * estável e a mensagem acionável. Só leitura — a correção é no CSV de origem (§3.5: nada de
 * correção inline nem sugestão automática, que o protótipo oferecia).
 *
 * A primeira página vem na própria prévia (`amostraRejeicoes`); as seguintes, da rota paginada.
 */
'use client';

import type { PreviaDaImportacao, RejeicaoDaImportacao } from '@contaia/shared';
import type { ReactNode } from 'react';

import { ErroDeTela, Skeleton } from '@/components/ui/estados';
import { Button } from '@/components/ui/button';
import { ErroDaApi } from '@/lib/http';
import { mensagemDoCodigo } from '@/lib/mensagens';
import { cn } from '@/lib/cn';
import { MENSAGEM_PADRAO_DO_ERRO, ROTULO_DO_ERRO_DA_LINHA, formatarNumero, rotuloDoCampo } from './apresentacao';
import { Paginacao } from './pecas';
import { useRejeicoes } from './queries';

export const REJEICOES_POR_PAGINA = 20;

const Linha = ({ rejeicao }: { rejeicao: RejeicaoDaImportacao }) => (
  <tr className="border-t border-border bg-danger/30 align-top">
    <th scope="row" className="whitespace-nowrap px-md py-sm text-left font-mono text-code-sm font-normal tabular-nums text-foreground">
      {formatarNumero(rejeicao.numeroDaLinha)}
    </th>
    <td className="max-w-[12rem] px-md py-sm font-mono text-code-sm text-foreground [overflow-wrap:anywhere]">
      {rejeicao.codigo ?? <span className="font-sans text-body-sm text-muted-foreground">sem código</span>}
    </td>
    <td className="whitespace-nowrap px-md py-sm text-body-sm text-foreground">{rotuloDoCampo(rejeicao.campo)}</td>
    <td className="px-md py-sm">
      <span className="flex flex-col gap-xs">
        <span className="text-body-sm text-danger-foreground">{ROTULO_DO_ERRO_DA_LINHA[rejeicao.codigoDeErro]}</span>
        <code className="font-mono text-code-xs text-muted-foreground">{rejeicao.codigoDeErro}</code>
      </span>
    </td>
    <td className="min-w-[16rem] px-md py-sm text-body-sm text-foreground">
      {rejeicao.mensagem ?? MENSAGEM_PADRAO_DO_ERRO[rejeicao.codigoDeErro]}
    </td>
  </tr>
);

export const TabelaDeRejeicoes = ({
  empresaId,
  previa,
  pagina,
  aoIr,
}: {
  empresaId: string;
  previa: PreviaDaImportacao;
  pagina: number;
  aoIr: (pagina: number) => void;
}) => {
  const total = previa.totais?.rejeitadas ?? 0;
  const paginaSeguinte = pagina > 1;
  const consulta = useRejeicoes(empresaId, previa.tentativaId, pagina, paginaSeguinte);
  const itens = paginaSeguinte ? consulta.data?.itens : previa.amostraRejeicoes;

  if (total === 0) {
    return null;
  }

  const corpo = (): ReactNode => {
    if (itens === undefined && consulta.isPending) {
      return (
        <div className="flex flex-col gap-xs px-md py-md" aria-busy="true">
          <span className="sr-only">Carregando as rejeições</span>
          {Array.from({ length: 4 }, (_, indice) => (
            <Skeleton key={indice} className="h-9 w-full" />
          ))}
        </div>
      );
    }

    if (itens === undefined) {
      const problema = consulta.error instanceof ErroDaApi ? consulta.error.problema : null;

      return (
        <div className="p-md">
          <ErroDeTela
            titulo="Não foi possível carregar esta página de rejeições"
            descricao={problema === null ? mensagemDoCodigo('FALHA_DE_REDE') : mensagemDoCodigo(problema.code)}
            correlationId={problema?.correlationId}
            acao={
              <Button variante="contorno" tamanho="compacto" onClick={() => void consulta.refetch()}>
                Tentar de novo
              </Button>
            }
          />
        </div>
      );
    }

    return (
      <div className={cn('overflow-x-auto', consulta.isPlaceholderData && 'opacity-60 transition-opacity duration-fast')}>
        <table className="w-full text-left">
          <caption className="sr-only">
            Linhas rejeitadas de {previa.arquivo.nome}, página {pagina}
          </caption>
          <thead className="bg-muted">
            <tr>
              {['Linha', 'Código', 'Campo', 'Erro', 'O que fazer'].map((titulo) => (
                <th key={titulo} scope="col" className="px-md py-sm text-label-sm uppercase text-muted-foreground">
                  {titulo}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {itens.map((rejeicao) => (
              <Linha key={`${rejeicao.numeroDaLinha}-${rejeicao.campo ?? ''}-${rejeicao.codigoDeErro}`} rejeicao={rejeicao} />
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <section aria-labelledby={`rejeicoes-${previa.tentativaId}`} className="overflow-hidden rounded-lg border border-border">
      <header className="flex flex-col gap-xs bg-card px-md py-sm tablet:flex-row tablet:items-baseline tablet:justify-between">
        <h4 id={`rejeicoes-${previa.tentativaId}`} className="text-title-md text-foreground">
          Linhas rejeitadas
        </h4>
        <p className="text-body-sm text-muted-foreground">
          Corrija no CSV de origem e envie uma nova tentativa; estas linhas não entram no plano.
        </p>
      </header>
      {corpo()}
      <Paginacao
        rotulo="Paginação das rejeições"
        pagina={pagina}
        total={total}
        porPagina={REJEICOES_POR_PAGINA}
        aoIr={aoIr}
        unidade={total === 1 ? 'rejeição' : 'rejeições'}
      />
    </section>
  );
};
