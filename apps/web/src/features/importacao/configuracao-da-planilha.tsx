/**
 * Planilha escolhida até o mapeamento (SPEC-015 §3.3–3.5, §5.2 itens 3 a 6, §5.3): leitura no
 * servidor, aba (sozinha quando é a única com dados; escolha explícita quando há várias), linha do
 * cabeçalho sobre a amostra, resumo das linhas ignoradas e ocultas e, só com cabeçalho válido e sem
 * mescla, o mapeamento por letra.
 *
 * Três leituras, cada uma uma consulta (a inspeção é sem estado no servidor): a geral (abas e,
 * quando há uma aba só, a amostra), a da aba escolhida e a da linha de cabeçalho escolhida. A
 * amostra é a mesma para qualquer cabeçalho; a troca de linha só relê colunas e contagens.
 * Trocar a aba ou a linha remonta o mapeamento (rascunho descartado) e limpa a recusa do envio.
 */
'use client';

import { EyeOff, Rows3, Undo2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import type { Problema } from '@/lib/http';
import { mensagemDoCodigo } from '@/lib/mensagens';
import type { ConfiguracaoDoEnvio } from './api';
import { resumoDasLinhas, sugestaoPorLetra } from './apresentacao-da-planilha';
import type { DominioDaImportacao } from './dominio';
import type { PlanilhaEscolhida } from './envio-do-arquivo';
import { FalhaDaLeitura, LendoPlanilha, problemaDa } from './estados-da-planilha';
import { FaixaDoArquivo, MapeamentoDeColunas } from './mapeamento-de-colunas';
import { useInspecaoDaPlanilha } from './queries';
import { Bloco, LEITURA_DEMORADA, SecaoDaAba } from './secao-da-aba';
import { SeletorDeCabecalho } from './seletor-de-cabecalho';

export const ConfiguracaoDaPlanilha = ({
  dominio,
  empresaId,
  escolhida,
  enviando,
  falhaDoEnvio,
  aoEnviar,
  aoTrocar,
  aoMudarConfiguracao,
}: {
  dominio: DominioDaImportacao;
  empresaId: string;
  escolhida: PlanilhaEscolhida;
  enviando: boolean;
  falhaDoEnvio: Problema | null;
  aoEnviar: (mapeamento: Readonly<Record<string, string>>, configuracao: ConfiguracaoDoEnvio) => void;
  aoTrocar: () => void;
  /** Aba ou cabeçalho mudou: a recusa do envio anterior não vale mais. */
  aoMudarConfiguracao: () => void;
}) => {
  const [abaEscolhida, definirAbaEscolhida] = useState<number | null>(null);
  const [linhaEscolhida, definirLinhaEscolhida] = useState<number | null>(null);
  const base = { arquivo: escolhida.arquivo, selecao: escolhida.selecao };

  const geral = useInspecaoDaPlanilha(dominio, empresaId, { ...base, aba: null, linhaCabecalho: null });
  const daAbaEscolhida = useInspecaoDaPlanilha(
    dominio,
    empresaId,
    { ...base, aba: abaEscolhida, linhaCabecalho: null },
    abaEscolhida !== null,
  );
  const daAba = abaEscolhida === null ? geral : daAbaEscolhida;
  const aba = daAba.data?.abaSelecionada ?? null;
  const sugerida = daAba.data?.linhaCabecalhoSugerida ?? null;
  const doCabecalhoEscolhido = useInspecaoDaPlanilha(
    dominio,
    empresaId,
    { ...base, aba: aba?.posicao ?? null, linhaCabecalho: linhaEscolhida },
    aba !== null && linhaEscolhida !== null,
  );
  const doCabecalho = linhaEscolhida === null ? daAba : doCabecalhoEscolhido;
  const linhaAtual = linhaEscolhida ?? sugerida;

  const escolherAba = (valor: string): void => {
    definirAbaEscolhida(Number(valor));
    definirLinhaEscolhida(null);
    aoMudarConfiguracao();
  };

  const escolherLinha = (linha: number): void => {
    definirLinhaEscolhida(linha === sugerida ? null : linha);
    aoMudarConfiguracao();
  };

  const anuncio = ((): string => {
    if (geral.isPending) {
      return 'Lendo a planilha.';
    }
    if (geral.data?.abaSelecionada === null && abaEscolhida === null) {
      return 'Planilha lida. Escolha a aba.';
    }
    if (daAba.isFetching) {
      return 'Lendo a aba escolhida.';
    }
    if (doCabecalho.isFetching && linhaAtual !== null) {
      return `Conferindo a linha ${linhaAtual} como cabeçalho.`;
    }

    return doCabecalho.data !== undefined && linhaAtual !== null ? `Planilha lida. Cabeçalho na linha ${linhaAtual}.` : '';
  })();

  const secaoDoCabecalho = (): ReactNode => {
    const inspecao = daAba.data;

    if (inspecao === undefined || aba === null || sugerida === null || linhaAtual === null) {
      return null;
    }

    const leitura = doCabecalho.data;
    const problema = doCabecalho.isError ? problemaDa(doCabecalho.error) : null;

    return (
      <Bloco titulo="Linha do cabeçalho">
        <div className="flex flex-col gap-xs tablet:flex-row tablet:items-center tablet:justify-between">
          <p className="text-body-sm text-muted-foreground">
            {linhaEscolhida === null
              ? `Cabeçalho sugerido: linha ${sugerida}, a primeira preenchida. Se os nomes das colunas estão mais abaixo, escolha a linha na tabela.`
              : `Cabeçalho alterado: linha ${linhaAtual} (sugerida: linha ${sugerida}).`}
          </p>
          {linhaEscolhida === null ? null : (
            <Button variante="fantasma" tamanho="compacto" disabled={enviando} onClick={() => escolherLinha(sugerida)}>
              <Undo2 aria-hidden="true" />
              Voltar à linha sugerida
            </Button>
          )}
        </div>

        {leitura === undefined ? null : (
          <p className="flex flex-wrap items-center gap-xs rounded-md bg-secondary px-md py-sm text-body-sm text-foreground">
            {leitura.linhasOcultas > 0 ? (
              <EyeOff className="size-icon-sm shrink-0 text-warning-foreground" aria-hidden="true" />
            ) : (
              <Rows3 className="size-icon-sm shrink-0 text-muted-foreground" aria-hidden="true" />
            )}
            <span>{resumoDasLinhas(leitura.linhasIgnoradasAntesDoCabecalho, leitura.linhasOcultas)}</span>
          </p>
        )}

        <SeletorDeCabecalho
          nomeDaAba={aba.nome}
          amostra={inspecao.amostra}
          linhaCabecalho={linhaAtual}
          bloqueado={enviando}
          aoEscolher={escolherLinha}
        />

        {doCabecalho.isFetching ? (
          <LendoPlanilha titulo={`Conferindo a linha ${linhaAtual}`} descricao="Colunas e contagens desta linha de cabeçalho." />
        ) : null}
        {problema?.code === 'CABECALHO_INVALIDO' ? (
          <p role="alert" className="rounded-md border border-danger-indicator/40 bg-danger px-md py-sm text-body-sm text-danger-foreground">
            {`A linha ${linhaAtual} não tem nomes de coluna utilizáveis. Escolha outra linha de cabeçalho na tabela.`}
          </p>
        ) : problema !== null ? (
          <FalhaDaLeitura erro={doCabecalho.error} aoTentar={() => void doCabecalho.refetch()} aoTrocar={aoTrocar} />
        ) : null}
        {leitura?.cabecalhoMesclado === true ? (
          <div role="alert" className="flex flex-col gap-xs rounded-md border border-danger-indicator/40 bg-danger px-md py-sm">
            <p className="text-title-sm text-danger-foreground">O mapeamento está bloqueado</p>
            <p className="text-body-sm text-danger-foreground">{mensagemDoCodigo('CABECALHO_MESCLADO')}</p>
          </div>
        ) : null}
      </Bloco>
    );
  };

  const leitura = doCabecalho.data;
  const podeMapear =
    leitura !== undefined && aba !== null && linhaAtual !== null && !leitura.cabecalhoMesclado && leitura.colunas.length > 0;

  return (
    <div className="flex flex-col gap-lg">
      <FaixaDoArquivo
        arquivo={escolhida.arquivo}
        bloqueada={enviando}
        aoTrocar={aoTrocar}
        detalhes={
          <>
            <span aria-hidden="true">·</span>
            <span className="rounded-sm bg-muted px-xs font-mono text-code-xs text-foreground">{escolhida.formato}</span>
          </>
        }
      />

      <p role="status" aria-live="polite" className="sr-only">
        {anuncio}
      </p>

      {geral.isPending ? <LendoPlanilha titulo="Lendo a planilha" descricao={LEITURA_DEMORADA} /> : null}
      {geral.isError ? (
        <FalhaDaLeitura erro={geral.error} aoTentar={() => void geral.refetch()} aoTrocar={aoTrocar} />
      ) : null}

      {geral.data === undefined ? null : (
        <SecaoDaAba
          inspecao={geral.data}
          abaEscolhida={abaEscolhida}
          daAbaEscolhida={daAbaEscolhida}
          enviando={enviando}
          aoEscolher={escolherAba}
          aoTrocar={aoTrocar}
        />
      )}
      {secaoDoCabecalho()}

      {podeMapear ? (
        <MapeamentoDeColunas
          key={`${aba.posicao}-${linhaAtual}`}
          dominio={dominio}
          colunas={leitura.colunas.map((coluna) => ({ valor: coluna.letra, rotulo: coluna.rotulo }))}
          sugestao={sugestaoPorLetra(dominio.mapeamentoSugerido, leitura.colunas)}
          enviando={enviando}
          falhaDoEnvio={falhaDoEnvio}
          aoEnviar={(mapeamento) => aoEnviar(mapeamento, { aba: aba.posicao, linhaCabecalho: linhaAtual })}
        />
      ) : null}
    </div>
  );
};
