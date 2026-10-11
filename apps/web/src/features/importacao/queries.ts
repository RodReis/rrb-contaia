'use client';

import type { EstadoDaImportacao } from '@contaia/shared';
import { keepPreviousData, skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';

import { ErroDaApi } from '@/lib/http';
import { avisarFalha } from '../escritorio/queries';
import {
  cancelarImportacao,
  confirmarImportacao,
  enviarImportacao,
  inspecionarPlanilha,
  listarHistorico,
  listarRejeicoes,
  obterTentativa,
} from './api';
import { emAndamento, plural } from './apresentacao';
import type { DominioDaImportacao, PreviaBase } from './dominio';

/**
 * Chaves com o escopo da empresa, por domínio (`plano-contas`, `empregados`). O tenant não entra
 * como segmento porque a web não o conhece: a sessão é resolvida pelo servidor a partir do cookie,
 * e o `QueryClient` nasce por montagem do shell autenticado (`components/layout/provedores.tsx`),
 * sem troca de escritório sem recarregar.
 */
export const chavesDaImportacao = (dominio: Pick<DominioDaImportacao, 'recurso'>) => ({
  empresa: (empresaId: string) => [dominio.recurso, empresaId] as const,
  tentativa: (empresaId: string, tentativaId: string) => [dominio.recurso, empresaId, 'tentativa', tentativaId] as const,
  rejeicoes: (empresaId: string, tentativaId: string, pagina: number) =>
    [dominio.recurso, empresaId, 'tentativa', tentativaId, 'rejeicoes', pagina] as const,
  historico: (empresaId: string, pagina: number) => [dominio.recurso, empresaId, 'historico', pagina] as const,
  /** Uma inspeção por arquivo escolhido (`selecao`), aba e linha de cabeçalho pedidas. */
  inspecao: (empresaId: string, selecao: string, aba: number | null, linhaCabecalho: number | null) =>
    [dominio.recurso, empresaId, 'inspecao', selecao, aba, linhaCabecalho] as const,
});

/** Frequência do acompanhamento enquanto o worker valida ou a aplicação roda. */
export const INTERVALO_DO_ACOMPANHAMENTO_MS = 2_000;
/** Espera máxima entre leituras quando elas falham em sequência. */
export const TETO_DO_ACOMPANHAMENTO_MS = 30_000;

/**
 * Próxima leitura da tentativa: só enquanto há trabalho em curso; cada falha seguida dobra a
 * espera, até o teto. Uma oscilação de rede não congela o acompanhamento.
 */
export const intervaloDoAcompanhamento = (
  estado: EstadoDaImportacao | undefined,
  falhasSeguidas: number,
): number | false =>
  emAndamento(estado)
    ? Math.min(INTERVALO_DO_ACOMPANHAMENTO_MS * 2 ** falhasSeguidas, TETO_DO_ACOMPANHAMENTO_MS)
    : false;

type ContagemDaConsulta = Readonly<{ dataUpdateCount: number; errorUpdateCount: number }>;

/** Por consulta: quantas falhas houve desde a última leitura bem-sucedida. */
const marcosDasConsultas = new WeakMap<object, ContagemDaConsulta>();

const falhasDesdeOUltimoSucesso = (consulta: object, estado: ContagemDaConsulta): number => {
  const marco = marcosDasConsultas.get(consulta);

  if (marco === undefined || marco.dataUpdateCount !== estado.dataUpdateCount) {
    marcosDasConsultas.set(consulta, estado);

    return 0;
  }

  return estado.errorUpdateCount - marco.errorUpdateCount;
};

/**
 * Quando o worker termina (a tentativa sai de RECEBIDA/VALIDANDO/APLICANDO), o histórico, a base
 * vigente, a pendência da Central e o sino mudaram no servidor sem nenhum comando desta tela: são
 * relidos aqui, uma vez por transição. A própria tentativa fica de fora (acabou de ser lida).
 */
const useSuperficiesAoTerminar = (
  dominio: DominioDaImportacao,
  empresaId: string,
  tentativaId: string | null,
  estado: EstadoDaImportacao | undefined,
): void => {
  const cliente = useQueryClient();
  const anterior = useRef<Readonly<{ tentativaId: string | null; estado: EstadoDaImportacao | undefined }>>({
    tentativaId,
    estado,
  });
  const { recurso } = dominio;

  useEffect(() => {
    const visto = anterior.current;
    anterior.current = { tentativaId, estado };

    if (visto.tentativaId !== tentativaId || !emAndamento(visto.estado) || estado === undefined || emAndamento(estado)) {
      return;
    }

    const chaves = chavesDaImportacao({ recurso });
    const chaveDaTentativa = chaves.tentativa(empresaId, tentativaId ?? '');
    void cliente.invalidateQueries({
      queryKey: chaves.empresa(empresaId),
      predicate: (consulta) => JSON.stringify(consulta.queryKey) !== JSON.stringify(chaveDaTentativa),
    });
    void cliente.invalidateQueries({ queryKey: ['pendencias'] });
    void cliente.invalidateQueries({ queryKey: ['notificacoes'] });
  }, [cliente, recurso, empresaId, tentativaId, estado]);
};

/** `tentativaId` nulo = nenhuma tentativa aberta: a consulta existe, mas não dispara. */
export const useTentativa = (dominio: DominioDaImportacao, empresaId: string, tentativaId: string | null) => {
  const consulta = useQuery({
    queryKey: chavesDaImportacao(dominio).tentativa(empresaId, tentativaId ?? ''),
    queryFn: tentativaId === null ? skipToken : () => obterTentativa(dominio, empresaId, tentativaId),
    // Estado de processamento não convive com cache velho (FRONTEND.md §6.2).
    staleTime: 0,
    // Leitura que falha não para o acompanhamento: ele segue com espera crescente, e a tela avisa
    // a falha (com código de suporte e "Tentar de novo") por cima do último estado lido.
    refetchInterval: (atual) =>
      intervaloDoAcompanhamento(
        atual.state.data?.estado,
        falhasDesdeOUltimoSucesso(atual, {
          dataUpdateCount: atual.state.dataUpdateCount,
          errorUpdateCount: atual.state.errorUpdateCount,
        }),
      ),
  });

  useSuperficiesAoTerminar(dominio, empresaId, tentativaId, consulta.data?.estado);

  return consulta;
};

export const useRejeicoes = (
  dominio: DominioDaImportacao,
  empresaId: string,
  tentativaId: string,
  pagina: number,
  habilitado: boolean,
) =>
  useQuery({
    queryKey: chavesDaImportacao(dominio).rejeicoes(empresaId, tentativaId, pagina),
    queryFn: () => listarRejeicoes(dominio, empresaId, tentativaId, pagina),
    enabled: habilitado,
    placeholderData: keepPreviousData,
  });

export const useHistorico = (dominio: DominioDaImportacao, empresaId: string, pagina: number) =>
  useQuery({
    queryKey: chavesDaImportacao(dominio).historico(empresaId, pagina),
    queryFn: () => listarHistorico(dominio, empresaId, pagina),
    placeholderData: keepPreviousData,
  });

/**
 * A tentativa alimenta o histórico, a base vigente, a pendência da Central e o sino. Depois de
 * cada comando, as quatro são relidas.
 */
const atualizarSuperficies = (
  cliente: QueryClient,
  dominio: DominioDaImportacao,
  empresaId: string,
  previa: PreviaBase,
): void => {
  const chaves = chavesDaImportacao(dominio);
  cliente.setQueryData(chaves.tentativa(empresaId, previa.tentativaId), previa);
  void cliente.invalidateQueries({ queryKey: chaves.empresa(empresaId) });
  void cliente.invalidateQueries({ queryKey: ['pendencias'] });
  void cliente.invalidateQueries({ queryKey: ['notificacoes'] });
};

/**
 * Inspeção da planilha escolhida (SPEC-015 §6.2). É leitura sem efeito no servidor, então mora no
 * cache do Query, mas com regras próprias:
 * - nunca repete sozinha: a recusa do arquivo é determinística e o "serviço ocupado" tem a própria
 *   espera (`Retry-After`), oferecida pela tela;
 * - nunca fica velha nem relê por foco: o arquivo não muda depois de escolhido;
 * - some do cache assim que a tela deixa de usá-la (`gcTime: 0`): a amostra tem dado do arquivo de
 *   quem enviou e não precisa sobreviver à troca de arquivo (fica só em memória, nunca na URL).
 */
export const useInspecaoDaPlanilha = (
  dominio: DominioDaImportacao,
  empresaId: string,
  entrada: Readonly<{ arquivo: File; selecao: string; aba: number | null; linhaCabecalho: number | null }>,
  habilitada = true,
) =>
  useQuery({
    queryKey: chavesDaImportacao(dominio).inspecao(empresaId, entrada.selecao, entrada.aba, entrada.linhaCabecalho),
    queryFn: habilitada
      ? () => inspecionarPlanilha(dominio, empresaId, { arquivo: entrada.arquivo, aba: entrada.aba, linhaCabecalho: entrada.linhaCabecalho })
      : skipToken,
    retry: false,
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });

export const useEnviarImportacao = (dominio: DominioDaImportacao, empresaId: string) => {
  const cliente = useQueryClient();

  return useMutation({
    mutationFn: (entrada: Parameters<typeof enviarImportacao>[2]) => enviarImportacao(dominio, empresaId, entrada),
    onSuccess: (previa) => {
      atualizarSuperficies(cliente, dominio, empresaId, previa);
      toast.info(
        previa.reutilizadaPorIdempotencia
          ? 'Este arquivo, com a mesma configuração, já tinha sido processado: o resultado anterior foi reaproveitado.'
          : 'Arquivo recebido. A validação continua em segundo plano e o resultado aparece aqui.',
      );
    },
    onError: avisarFalha,
  });
};

/** Recusas que a tela explica no próprio diálogo e no estado da prévia: o toast seria repetição. */
const CODIGOS_EXPLICADOS_NA_TELA: readonly string[] = ['CONFLITO_DE_VERSAO', 'ESTADO_INVALIDO_PARA_ACAO'];

/** Falha da aplicação: o toast diz, nas palavras do domínio, que nada foi alterado. */
const avisarFalhaDoComando = (dominio: DominioDaImportacao, erro: unknown): void => {
  if (erro instanceof ErroDaApi && erro.problema.code === 'FALHA_TECNICA') {
    toast.error(dominio.textos.falhaTecnica, {
      duration: Infinity,
      description: `Código de suporte: ${erro.problema.correlationId}`,
    });
    return;
  }

  avisarFalha(erro);
};

export const useConfirmarImportacao = (
  dominio: DominioDaImportacao,
  empresaId: string,
  tentativaId: string,
  aoBaixarRelatorio: (() => void) | null,
) => {
  const cliente = useQueryClient();

  return useMutation({
    mutationFn: (versaoDaPrevia: number) => confirmarImportacao(dominio, empresaId, tentativaId, versaoDaPrevia),
    onSuccess: (previa) => {
      atualizarSuperficies(cliente, dominio, empresaId, previa);
      const totais = previa.totais;
      const aplicadas = dominio.textos.aplicadasNoAviso(totais);

      if (previa.estado === 'CONCLUIDA_COM_REJEICOES') {
        toast.warning(
          `Importação concluída com ressalvas: ${aplicadas}; ${plural(
            totais?.rejeitadas ?? 0,
            'linha rejeitada',
            'linhas rejeitadas',
          )}.`,
          {
            duration: 8_000,
            ...(aoBaixarRelatorio === null ? {} : { action: { label: 'Baixar relatório', onClick: aoBaixarRelatorio } }),
          },
        );
        return;
      }

      toast.success(`Importação concluída: ${aplicadas}.`);
    },
    onError: (erro) => {
      // FALHA_TECNICA leva a tentativa a FALHA no servidor: a tela relê para mostrar o desfecho.
      void cliente.invalidateQueries({ queryKey: chavesDaImportacao(dominio).tentativa(empresaId, tentativaId) });

      if (erro instanceof ErroDaApi && CODIGOS_EXPLICADOS_NA_TELA.includes(erro.problema.code)) {
        return;
      }

      avisarFalhaDoComando(dominio, erro);
    },
  });
};

export const useCancelarImportacao = (dominio: DominioDaImportacao, empresaId: string, tentativaId: string) => {
  const cliente = useQueryClient();

  return useMutation({
    mutationFn: () => cancelarImportacao(dominio, empresaId, tentativaId),
    onSuccess: (previa) => {
      atualizarSuperficies(cliente, dominio, empresaId, previa);
      toast.success(dominio.textos.avisoDeCancelamento);
    },
    onError: (erro) => {
      void cliente.invalidateQueries({ queryKey: chavesDaImportacao(dominio).tentativa(empresaId, tentativaId) });
      avisarFalha(erro);
    },
  });
};
