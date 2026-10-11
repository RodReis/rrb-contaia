/**
 * Rejeições da tentativa, paginadas (SPEC-013/014 §3.4, §3.5): linha, o que identifica a linha no
 * domínio (código da conta; CPF e matrícula do empregado), campo, código de erro estável e a
 * mensagem acionável. Só leitura — a correção é no arquivo de origem (§3.5: nada de
 * correção inline nem sugestão automática, que o protótipo oferecia).
 *
 * A primeira página vem na própria prévia (`amostraRejeicoes`); as seguintes, da rota paginada.
 */
'use client';

import { clsx } from 'clsx';
import type { ReactNode } from 'react';

import { ErroDeTela, Skeleton } from '@/components/ui/estados';
import { Button } from '@/components/ui/button';
import { ErroDaApi } from '@/lib/http';
import { mensagemDoCodigo } from '@/lib/mensagens';
import { cn } from '@/lib/cn';
import { formatarNumero } from './apresentacao';
import type { DominioDaImportacao, PreviaBase, RejeicaoBase } from './dominio';
import { CodigoQuebravel, Paginacao, RegiaoRolavel } from './pecas';
import { useRejeicoes } from './queries';

export const REJEICOES_POR_PAGINA = 20;

/**
 * Com duas colunas de identificação (CPF e matrícula), a tabela não cabe no cartão de 8 colunas com o
 * espaçamento folgado: "O que fazer" ficava quase toda fora da borda. Nesse caso as células apertam o
 * respiro lateral, o nome do campo pode quebrar e "O que fazer" aceita coluna mais estreita — a tabela
 * cabe inteira em 768, 1024 e 1440 px. Com uma coluna só (plano de contas), nada muda.
 */
const ehDensa = (dominio: DominioDaImportacao): boolean => dominio.colunasDaRejeicao.length > 1;

const Linha = ({ dominio, rejeicao }: { dominio: DominioDaImportacao; rejeicao: RejeicaoBase }) => {
  const respiro = ehDensa(dominio) ? 'px-sm py-sm' : 'px-md py-sm';

  return (
    <tr className="border-t border-border bg-danger/30 align-top">
      <th
        scope="row"
        className={clsx(respiro, 'whitespace-nowrap text-left font-mono text-code-sm font-normal tabular-nums text-foreground')}
      >
        {formatarNumero(rejeicao.numeroDaLinha)}
      </th>
      {dominio.colunasDaRejeicao.map((coluna) => (
        <td
          key={coluna.titulo}
          className={clsx(respiro, 'max-w-[12rem] font-mono text-code-sm tabular-nums text-foreground [overflow-wrap:anywhere]')}
        >
          {coluna.celula(rejeicao)}
        </td>
      ))}
      <td className={clsx(respiro, 'text-body-sm text-foreground', !ehDensa(dominio) && 'whitespace-nowrap')}>
        {dominio.rotuloDoCampo(rejeicao.campo)}
      </td>
      <td className={respiro}>
        <span className="flex flex-col gap-xs">
          <span className="text-body-sm text-danger-foreground">{dominio.rotuloDoErro(rejeicao.codigoDeErro)}</span>
          <CodigoQuebravel codigo={rejeicao.codigoDeErro} className="text-code-xs text-muted-foreground" />
        </span>
      </td>
      <td className={clsx(respiro, 'text-body-sm text-foreground', ehDensa(dominio) ? 'min-w-[10rem]' : 'min-w-[16rem]')}>
        {rejeicao.mensagem ?? dominio.mensagemPadraoDoErro(rejeicao.codigoDeErro)}
      </td>
    </tr>
  );
};

export const TabelaDeRejeicoes = ({
  dominio,
  empresaId,
  previa,
  pagina,
  aoIr,
}: {
  dominio: DominioDaImportacao;
  empresaId: string;
  previa: PreviaBase;
  pagina: number;
  aoIr: (pagina: number) => void;
}) => {
  const total = previa.totais?.rejeitadas ?? 0;
  const paginaSeguinte = pagina > 1;
  const consulta = useRejeicoes(dominio, empresaId, previa.tentativaId, pagina, paginaSeguinte);
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
      <RegiaoRolavel
        rotulo="Tabela das rejeições, rolável na horizontal"
        className={cn(consulta.isPlaceholderData && 'opacity-60 transition-opacity duration-fast')}
      >
        <table className="w-full text-left">
          <caption className="sr-only">
            Linhas rejeitadas de {previa.arquivo.nome}, página {pagina}
          </caption>
          <thead className="bg-muted">
            <tr>
              {['Linha', ...dominio.colunasDaRejeicao.map((coluna) => coluna.titulo), 'Campo', 'Erro', 'O que fazer'].map((titulo) => (
                <th
                  key={titulo}
                  scope="col"
                  className={clsx(ehDensa(dominio) ? 'px-sm' : 'px-md', 'py-sm text-label-sm uppercase text-muted-foreground')}
                >
                  {titulo}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {itens.map((rejeicao) => (
              <Linha
                key={`${rejeicao.numeroDaLinha}-${rejeicao.campo ?? ''}-${rejeicao.codigoDeErro}`}
                dominio={dominio}
                rejeicao={rejeicao}
              />
            ))}
          </tbody>
        </table>
      </RegiaoRolavel>
    );
  };

  return (
    <section aria-labelledby={`rejeicoes-${previa.tentativaId}`} className="overflow-hidden rounded-lg border border-border">
      <header className="flex flex-col gap-xs bg-card px-md py-sm tablet:flex-row tablet:items-baseline tablet:justify-between">
        <h4 id={`rejeicoes-${previa.tentativaId}`} className="text-title-md text-foreground">
          Linhas rejeitadas
        </h4>
        <p className="text-body-sm text-muted-foreground">
          {dominio.textos.rejeicoesNaoEntram}
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
