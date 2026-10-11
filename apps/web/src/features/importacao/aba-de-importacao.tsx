/**
 * Aba de importação por CSV, XLSX ou ODS de uma empresa (SPEC-013/014 §3.1, §5.2; SPEC-015 §3.1): importação, regras do
 * arquivo, histórico e a base vigente do domínio num lugar só. É a composição comum às abas "Plano
 * de contas" e "Empregados" e às etapas do cadastro que as reaproveitam.
 *
 * Direção do protótipo `contaia_onboarding_de_clientes_importa_o_de_legados_rf_01` preservada —
 * cartão com ladrilho de ícone, faixa de metadados do arquivo, totais e tabela de inconsistências,
 * pipeline em etapas — com as correções de escopo da SPEC §5.1: sem correção inline nem
 * solução/sugestão de IA, vetorização, percentuais de garantia ou acoplamento com etapas seguintes.
 * Estado vive em React e na URL, não em manipulação de DOM (DEBITO.md §D-16).
 */
'use client';

import type { EstadoDaImportacao } from '@contaia/shared';
import { FileUp, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { ErroDeTela, Skeleton } from '@/components/ui/estados';
import { ErroDaApi } from '@/lib/http';
import { mensagemDoCodigo } from '@/lib/mensagens';
import { useSessao } from '../usuarios/queries';
import { Acompanhamento } from './acompanhamento';
import { emAndamento } from './apresentacao';
import type { DominioDaImportacao } from './dominio';
import { HistoricoDeImportacoes } from './historico';
import { NovaImportacao } from './nova-importacao';
import { Secao } from './pecas';
import { useTentativa } from './queries';
import { RegrasDoArquivo } from './regras-do-arquivo';
import { useEstadoNaUrl, type EstadoNaUrl } from './use-estado-na-url';

type CabecalhoDaSecao = Readonly<{ titulo: string; descricao: string }>;

/** O cartão diz em que ponto a tentativa aberta está: em curso, em revisão ou encerrada. */
const cabecalhoDaSecao = (
  dominio: DominioDaImportacao,
  tentativaAberta: boolean,
  estado: EstadoDaImportacao | undefined,
): CabecalhoDaSecao => {
  if (!tentativaAberta) {
    return {
      titulo: 'Importação por CSV ou planilha',
      descricao:
        'Escolha o arquivo (CSV, XLSX ou ODS), associe as colunas e valide. A prévia mostra o que entra, o que muda e o que foi rejeitado.',
    };
  }

  if (estado === undefined) {
    return { titulo: 'Importação', descricao: 'Carregando a situação desta tentativa.' };
  }

  if (emAndamento(estado)) {
    return { titulo: 'Importação em andamento', descricao: dominio.textos.emAndamento };
  }

  if (estado === 'AGUARDANDO_CONFIRMACAO') {
    return { titulo: 'Importação em revisão', descricao: 'Resumo, rejeições e decisão desta tentativa.' };
  }

  return { titulo: 'Importação encerrada', descricao: 'Desfecho, totais e relatório desta tentativa.' };
};

export const AbaDeImportacao = ({
  dominio,
  empresaId,
  somenteLeitura,
  parametroDaBase,
  cabecalho,
  avisoDeSomenteLeitura,
  base,
}: {
  dominio: DominioDaImportacao;
  empresaId: string;
  somenteLeitura: boolean;
  /** Parâmetro da URL com a página da base vigente (`contas`, `empregados`). */
  parametroDaBase: string;
  /** Título e introdução da aba; nulo quando quem hospeda (a etapa do cadastro) já os tem. */
  cabecalho: Readonly<{ titulo: string; introducao: string }> | null;
  avisoDeSomenteLeitura: string;
  /** Base vigente do domínio, em consulta, abaixo do histórico. */
  base: (url: EstadoNaUrl) => ReactNode;
}) => {
  const consultaDaSessao = useSessao();
  const sessao = consultaDaSessao.data;
  const permissoes = dominio.permissoes(sessao, somenteLeitura);
  const problemaDaSessao = consultaDaSessao.error instanceof ErroDaApi ? consultaDaSessao.error.problema : null;
  const estadoNaUrl = useEstadoNaUrl(empresaId, dominio.aba, parametroDaBase);
  const { data: tentativa } = useTentativa(dominio, empresaId, estadoNaUrl.tentativaId);
  const tituloDaSecao = useRef<HTMLHeadingElement>(null);
  const cabecalhoDoCartao = cabecalhoDaSecao(dominio, estadoNaUrl.tentativaId !== null, tentativa?.estado);

  // O título do cartão continua montado quando o conteúdo troca: é para lá que o foco vai quando o
  // controle acionado some (fechar a tentativa, nova importação, aviso que se resolve). O pedido é
  // estado; o foco acontece no efeito, depois de a troca ser pintada.
  const [pedidosDeFoco, definirPedidosDeFoco] = useState(0);
  const focarTitulo = (): void => {
    definirPedidosDeFoco((pedidos) => pedidos + 1);
  };

  useEffect(() => {
    if (pedidosDeFoco > 0) {
      tituloDaSecao.current?.focus();
    }
  }, [pedidosDeFoco]);
  const url = {
    ...estadoNaUrl,
    fecharTentativa: (): void => {
      estadoNaUrl.fecharTentativa();
      focarTitulo();
    },
  };

  return (
    <div className="flex flex-col gap-xl">
      {cabecalho === null ? null : (
        <header className="flex flex-col gap-xs">
          <h2 className="font-display text-headline-md text-foreground">{cabecalho.titulo}</h2>
          <p className="max-w-3xl text-body-md text-muted-foreground">{cabecalho.introducao}</p>
        </header>
      )}

      {somenteLeitura ? (
        <p role="status" className="rounded-md border border-border bg-muted/40 px-md py-sm text-body-sm text-muted-foreground">
          {avisoDeSomenteLeitura}
        </p>
      ) : null}

      <div className="grid items-start gap-lg desktop:grid-cols-12">
        <Secao
          id={`importacao-por-csv-${dominio.aba}`}
          className="desktop:col-span-8"
          icone={<FileUp />}
          titulo={cabecalhoDoCartao.titulo}
          descricao={cabecalhoDoCartao.descricao}
          tituloRef={tituloDaSecao}
          acoes={
            url.tentativaId === null ? undefined : (
              <Button variante="fantasma" tamanho="compacto" onClick={url.fecharTentativa}>
                <X aria-hidden="true" />
                Fechar tentativa
              </Button>
            )
          }
        >
          {url.tentativaId === null && sessao === undefined && consultaDaSessao.isPending ? (
            <div className="flex flex-col gap-md px-lg py-lg" aria-busy="true">
              <span className="sr-only">Carregando as suas permissões</span>
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          ) : url.tentativaId === null && sessao === undefined ? (
            // Sem a sessão a tela não sabe o que o papel pode: erro, nunca "sem permissão".
            <div className="px-lg py-lg">
              <ErroDeTela
                titulo="Não foi possível conferir as suas permissões"
                descricao={problemaDaSessao === null ? mensagemDoCodigo('FALHA_DE_REDE') : mensagemDoCodigo(problemaDaSessao.code)}
                correlationId={problemaDaSessao?.correlationId}
                acao={
                  <Button variante="contorno" tamanho="compacto" onClick={() => void consultaDaSessao.refetch()}>
                    Tentar de novo
                  </Button>
                }
              />
            </div>
          ) : url.tentativaId === null ? (
            <NovaImportacao
              dominio={dominio}
              empresaId={empresaId}
              podeImportar={permissoes.importar}
              podeBaixar={permissoes.baixar}
              aoAbrirTentativa={url.abrirTentativa}
            />
          ) : (
            <Acompanhamento
              key={url.tentativaId}
              dominio={dominio}
              empresaId={empresaId}
              tentativaId={url.tentativaId}
              permissoes={permissoes}
              url={url}
              aoPerderOFoco={focarTitulo}
            />
          )}
        </Secao>

        <div className="desktop:col-span-4">
          <RegrasDoArquivo dominio={dominio} empresaId={empresaId} podeBaixar={permissoes.baixar} />
        </div>
      </div>

      <HistoricoDeImportacoes dominio={dominio} empresaId={empresaId} url={url} />
      {base(url)}
    </div>
  );
};
