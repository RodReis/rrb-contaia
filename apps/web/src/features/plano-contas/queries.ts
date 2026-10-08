'use client';

import type { Mapeamento } from '@contaia/domain';
import type { PreviaDaImportacao } from '@contaia/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { ErroDaApi } from '@/lib/http';
import { avisarFalha } from '../escritorio/queries';
import {
  cancelarImportacao,
  confirmarImportacao,
  enviarImportacao,
  listarContas,
  listarHistorico,
  listarRejeicoes,
  obterTentativa,
} from './api';
import { emAndamento, plural } from './apresentacao';

/**
 * Chaves com o escopo da empresa. O tenant não entra como segmento porque a web não o conhece: a
 * sessão é resolvida pelo servidor a partir do cookie, e o `QueryClient` nasce por montagem do
 * shell autenticado (`components/layout/provedores.tsx`), sem troca de escritório sem recarregar.
 */
export const CHAVE_DO_PLANO = ['plano-contas'] as const;

export const chavesDoPlano = {
  empresa: (empresaId: string) => [...CHAVE_DO_PLANO, empresaId] as const,
  tentativa: (empresaId: string, tentativaId: string) =>
    [...CHAVE_DO_PLANO, empresaId, 'tentativa', tentativaId] as const,
  rejeicoes: (empresaId: string, tentativaId: string, pagina: number) =>
    [...CHAVE_DO_PLANO, empresaId, 'tentativa', tentativaId, 'rejeicoes', pagina] as const,
  historico: (empresaId: string, pagina: number) => [...CHAVE_DO_PLANO, empresaId, 'historico', pagina] as const,
  contas: (empresaId: string, pagina: number, busca: string) =>
    [...CHAVE_DO_PLANO, empresaId, 'contas', pagina, busca] as const,
};

/** Frequência do acompanhamento enquanto o worker valida ou a aplicação roda. */
export const INTERVALO_DO_ACOMPANHAMENTO_MS = 2_000;

export const useTentativa = (empresaId: string, tentativaId: string) =>
  useQuery({
    queryKey: chavesDoPlano.tentativa(empresaId, tentativaId),
    queryFn: () => obterTentativa(empresaId, tentativaId),
    // Estado de processamento não convive com cache velho (FRONTEND.md §6.2).
    staleTime: 0,
    // Consulta só enquanto há trabalho em curso; falha de leitura para o acompanhamento e a tela
    // oferece "Tentar de novo", em vez de insistir em silêncio.
    refetchInterval: (consulta) =>
      consulta.state.status !== 'error' && emAndamento(consulta.state.data?.estado)
        ? INTERVALO_DO_ACOMPANHAMENTO_MS
        : false,
  });

export const useRejeicoes = (empresaId: string, tentativaId: string, pagina: number, habilitado: boolean) =>
  useQuery({
    queryKey: chavesDoPlano.rejeicoes(empresaId, tentativaId, pagina),
    queryFn: () => listarRejeicoes(empresaId, tentativaId, pagina),
    enabled: habilitado,
    placeholderData: keepPreviousData,
  });

export const useHistoricoDoPlano = (empresaId: string, pagina: number) =>
  useQuery({
    queryKey: chavesDoPlano.historico(empresaId, pagina),
    queryFn: () => listarHistorico(empresaId, pagina),
    placeholderData: keepPreviousData,
  });

export const useContasDoPlano = (empresaId: string, pagina: number, busca: string) =>
  useQuery({
    queryKey: chavesDoPlano.contas(empresaId, pagina, busca),
    queryFn: () => listarContas(empresaId, { pagina, busca }),
    placeholderData: keepPreviousData,
  });

/**
 * A tentativa alimenta o histórico, o plano vigente, a pendência da Central (plano sem conta
 * válida) e o sino (notificação ao iniciador). Depois de cada comando, as quatro são relidas.
 */
const atualizarSuperficies = (cliente: QueryClient, empresaId: string, previa: PreviaDaImportacao): void => {
  cliente.setQueryData(chavesDoPlano.tentativa(empresaId, previa.tentativaId), previa);
  void cliente.invalidateQueries({ queryKey: chavesDoPlano.empresa(empresaId) });
  void cliente.invalidateQueries({ queryKey: ['pendencias'] });
  void cliente.invalidateQueries({ queryKey: ['notificacoes'] });
};

export const useEnviarImportacao = (empresaId: string) => {
  const cliente = useQueryClient();

  return useMutation({
    mutationFn: (entrada: Readonly<{ arquivo: File; mapeamento: Mapeamento }>) =>
      enviarImportacao(empresaId, entrada),
    onSuccess: (previa) => {
      atualizarSuperficies(cliente, empresaId, previa);
      toast.info(
        previa.reutilizadaPorIdempotencia
          ? 'Este arquivo, com o mesmo mapeamento, já tinha sido processado: o resultado anterior foi reaproveitado.'
          : 'Arquivo recebido. A validação continua em segundo plano e o resultado aparece aqui.',
      );
    },
    onError: avisarFalha,
  });
};

/** Recusas que a tela explica no próprio diálogo e no estado da prévia: o toast seria repetição. */
const CODIGOS_EXPLICADOS_NA_TELA: readonly string[] = ['CONFLITO_DE_VERSAO', 'ESTADO_INVALIDO_PARA_ACAO'];

export const useConfirmarImportacao = (
  empresaId: string,
  tentativaId: string,
  aoBaixarRelatorio: (() => void) | null,
) => {
  const cliente = useQueryClient();

  return useMutation({
    mutationFn: (versaoDaPrevia: number) => confirmarImportacao(empresaId, tentativaId, versaoDaPrevia),
    onSuccess: (previa) => {
      atualizarSuperficies(cliente, empresaId, previa);
      const totais = previa.totais;
      const aplicadas = `${plural(totais?.novas ?? 0, 'conta nova', 'contas novas')} e ${plural(
        totais?.atualizadas ?? 0,
        'atualizada',
        'atualizadas',
      )}`;

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
      void cliente.invalidateQueries({ queryKey: chavesDoPlano.tentativa(empresaId, tentativaId) });

      if (erro instanceof ErroDaApi && CODIGOS_EXPLICADOS_NA_TELA.includes(erro.problema.code)) {
        return;
      }

      avisarFalha(erro);
    },
  });
};

export const useCancelarImportacao = (empresaId: string, tentativaId: string) => {
  const cliente = useQueryClient();

  return useMutation({
    mutationFn: () => cancelarImportacao(empresaId, tentativaId),
    onSuccess: (previa) => {
      atualizarSuperficies(cliente, empresaId, previa);
      toast.success('Importação cancelada. O plano de contas não foi alterado.');
    },
    onError: (erro) => {
      void cliente.invalidateQueries({ queryKey: chavesDoPlano.tentativa(empresaId, tentativaId) });
      avisarFalha(erro);
    },
  });
};
