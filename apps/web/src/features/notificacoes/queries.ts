'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { avisarFalha } from '../escritorio/queries';
import {
  buscarHistoricoDeNotificacoes,
  buscarPainelDeNotificacoes,
  marcarNotificacaoComoLida,
  marcarNotificacoesComoLidas,
} from './api';

const CHAVE_DO_PAINEL = ['notificacoes', 'painel'] as const;

// Polling leve: o badge precisa refletir eventos criados por outra aba/sessão
// sem exigir F5 manual (mesma necessidade que `AlertaDePendencias` não tinha,
// pois é montado sob demanda; o sino fica sempre visível no header).
const INTERVALO_DE_ATUALIZACAO_MS = 30_000;

export const useContadorDeNotificacoes = () =>
  useQuery({
    queryKey: CHAVE_DO_PAINEL,
    queryFn: buscarPainelDeNotificacoes,
    refetchInterval: INTERVALO_DE_ATUALIZACAO_MS,
  });

export const usePainelDeNotificacoes = () =>
  useQuery({
    queryKey: CHAVE_DO_PAINEL,
    queryFn: buscarPainelDeNotificacoes,
  });

export const chaveDoHistorico = (pagina: number, porPagina: number): readonly unknown[] => [
  'notificacoes',
  'historico',
  pagina,
  porPagina,
];

export const useHistoricoDeNotificacoes = (pagina: number, porPagina: number) =>
  useQuery({
    queryKey: chaveDoHistorico(pagina, porPagina),
    queryFn: () => buscarHistoricoDeNotificacoes(porPagina, pagina * porPagina),
    placeholderData: keepPreviousData,
  });

export const useMarcarComoLida = () => {
  const clienteDeQuery = useQueryClient();

  return useMutation({
    mutationFn: (notificacaoId: string) => marcarNotificacaoComoLida(notificacaoId),
    onSuccess: () => {
      void clienteDeQuery.invalidateQueries({ queryKey: ['notificacoes'] });
    },
    onError: avisarFalha,
  });
};

export const useMarcarVariasComoLidas = () => {
  const clienteDeQuery = useQueryClient();

  return useMutation({
    mutationFn: (ids: readonly string[]) => marcarNotificacoesComoLidas(ids),
    onSuccess: () => {
      void clienteDeQuery.invalidateQueries({ queryKey: ['notificacoes'] });
    },
    onError: avisarFalha,
  });
};
