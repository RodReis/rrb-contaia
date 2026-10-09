/**
 * Aba "Plano de contas" da empresa (SPEC-013 §3.1, §5.2): importação por CSV, histórico e plano
 * vigente num lugar só.
 *
 * Direção do protótipo `contaia_onboarding_de_clientes_importa_o_de_legados_rf_01` preservada —
 * cartão com ladrilho de ícone, faixa de metadados do arquivo, totais e tabela de inconsistências,
 * pipeline em etapas — com as correções de escopo da SPEC §5.1: o título trata só do plano de
 * contas (sem centro de custo), não há correção inline nem solução/sugestão de IA, nem vetorização,
 * percentuais de garantia ou acoplamento com DF-e/Ciência e etapas seguintes. Estado vive em React
 * e na URL, não em manipulação de DOM (DEBITO.md §D-16).
 */
'use client';

import type { EstadoDaImportacao } from '@contaia/shared';
import { FileUp, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { ErroDeTela, Skeleton } from '@/components/ui/estados';
import { ErroDaApi } from '@/lib/http';
import { mensagemDoCodigo } from '@/lib/mensagens';
import { useSessao } from '../usuarios/queries';
import { Acompanhamento } from './acompanhamento';
import { emAndamento } from './apresentacao';
import { HistoricoDeImportacoes } from './historico';
import { NovaImportacao } from './nova-importacao';
import { Secao } from './pecas';
import { permissoesDoPlano } from './permissoes';
import { PlanoVigente } from './plano-vigente';
import { useTentativa } from './queries';
import { RegrasDoArquivo } from './regras-do-arquivo';
import { useEstadoNaUrl } from './use-estado-na-url';

type CabecalhoDaSecao = Readonly<{ titulo: string; descricao: string }>;

/** O cartão diz em que ponto a tentativa aberta está: em curso, em revisão ou encerrada. */
const cabecalhoDaSecao = (tentativaAberta: boolean, estado: EstadoDaImportacao | undefined): CabecalhoDaSecao => {
  if (!tentativaAberta) {
    return {
      titulo: 'Importação por CSV',
      descricao:
        'Escolha o arquivo, associe as colunas e valide. A prévia mostra o que entra, o que muda e o que foi rejeitado.',
    };
  }

  if (estado === undefined) {
    return { titulo: 'Importação', descricao: 'Carregando a situação desta tentativa.' };
  }

  if (emAndamento(estado)) {
    return {
      titulo: 'Importação em andamento',
      descricao: 'Acompanhe o processamento; nada muda no plano antes da sua confirmação.',
    };
  }

  if (estado === 'AGUARDANDO_CONFIRMACAO') {
    return { titulo: 'Importação em revisão', descricao: 'Resumo, rejeições e decisão desta tentativa.' };
  }

  return { titulo: 'Importação encerrada', descricao: 'Desfecho, totais e relatório desta tentativa.' };
};

export const AbaPlanoDeContas = ({
  empresaId,
  somenteLeitura,
  comCabecalho = true,
}: {
  empresaId: string;
  somenteLeitura: boolean;
  /** Falso quando quem hospeda a aba (a etapa do cadastro) já tem o próprio título e introdução. */
  comCabecalho?: boolean;
}) => {
  const consultaDaSessao = useSessao();
  const sessao = consultaDaSessao.data;
  const permissoes = permissoesDoPlano(sessao, somenteLeitura);
  const problemaDaSessao = consultaDaSessao.error instanceof ErroDaApi ? consultaDaSessao.error.problema : null;
  const estadoNaUrl = useEstadoNaUrl(empresaId);
  const { data: tentativa } = useTentativa(empresaId, estadoNaUrl.tentativaId);
  const tituloDaSecao = useRef<HTMLHeadingElement>(null);
  const cabecalho = cabecalhoDaSecao(estadoNaUrl.tentativaId !== null, tentativa?.estado);

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
      {comCabecalho ? (
        <header className="flex flex-col gap-xs">
          <h2 className="font-display text-headline-md text-foreground">Plano de contas</h2>
          <p className="max-w-3xl text-body-md text-muted-foreground">
            Importe e reimporte o plano de contas desta empresa por CSV, no modelo do ContaIA ou mapeando as colunas
            de um arquivo legado. Nenhuma conta muda antes da sua confirmação.
          </p>
        </header>
      ) : null}

      {somenteLeitura ? (
        <p role="status" className="rounded-md border border-border bg-muted/40 px-md py-sm text-body-sm text-muted-foreground">
          Empresa arquivada: o plano e o histórico ficam para consulta, sem novas importações.
        </p>
      ) : null}

      <div className="grid items-start gap-lg desktop:grid-cols-12">
        <Secao
          id="importacao-por-csv"
          className="desktop:col-span-8"
          icone={<FileUp />}
          titulo={cabecalho.titulo}
          descricao={cabecalho.descricao}
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
              empresaId={empresaId}
              podeImportar={permissoes.importar}
              aoAbrirTentativa={url.abrirTentativa}
            />
          ) : (
            <Acompanhamento
              key={url.tentativaId}
              empresaId={empresaId}
              tentativaId={url.tentativaId}
              permissoes={permissoes}
              url={url}
              aoPerderOFoco={focarTitulo}
            />
          )}
        </Secao>

        <div className="desktop:col-span-4">
          <RegrasDoArquivo empresaId={empresaId} podeBaixar={permissoes.baixar} />
        </div>
      </div>

      <HistoricoDeImportacoes empresaId={empresaId} url={url} />
      <PlanoVigente empresaId={empresaId} url={url} />
    </div>
  );
};
