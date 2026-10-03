'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { ErroDaApi } from '@/lib/http';
import {
  consultarHistoricoDeCertificados,
  desativarCertificado,
  listarCofre,
  listarResponsaveisElegiveis,
  obterDetalheDoCofre,
  trocarResponsavelDoCertificado,
  type FiltroDoCofre,
  type FiltroDoHistoricoDeCertificados,
} from './api';
import { mensagemDoCofre } from './apresentacao';

/** Tudo que o cofre lê passa por esta raiz: uma invalidação alcança lista, detalhe e responsáveis. */
export const CHAVE_DO_COFRE = ['cofre'] as const;
export const CHAVE_DO_HISTORICO_DE_CERTIFICADOS = ['historico-de-certificados'] as const;

export const useCofre = (filtro: FiltroDoCofre, habilitado = true) =>
  useQuery({
    queryKey: [...CHAVE_DO_COFRE, 'lista', filtro],
    queryFn: () => listarCofre(filtro),
    enabled: habilitado,
    // A lista é conferida: manter a página anterior evita a tabela sumir a cada tecla da busca.
    placeholderData: keepPreviousData,
  });

export const useDetalheDoCofre = (empresaId: string | null) =>
  useQuery({
    queryKey: [...CHAVE_DO_COFRE, 'detalhe', empresaId],
    queryFn: () => obterDetalheDoCofre(empresaId ?? ''),
    enabled: empresaId !== null,
  });

export const useResponsaveisElegiveis = (empresaId: string | null) =>
  useQuery({
    queryKey: [...CHAVE_DO_COFRE, 'responsaveis', empresaId],
    queryFn: () => listarResponsaveisElegiveis(empresaId ?? ''),
    enabled: empresaId !== null,
    // Quem é elegível muda com a carteira: nunca reaproveitar uma lista velha entre aberturas.
    staleTime: 0,
  });

export const useHistoricoDeCertificados = (filtro: FiltroDoHistoricoDeCertificados) =>
  useQuery({
    queryKey: [...CHAVE_DO_HISTORICO_DE_CERTIFICADOS, filtro],
    queryFn: () => consultarHistoricoDeCertificados(filtro),
    placeholderData: keepPreviousData,
  });

/**
 * O cofre alimenta quatro superfícies: a própria lista, o histórico, o sino
 * (alertas por marco) e a Central de Pendências (ausente, vencido, sem
 * responsável). Depois de qualquer mutação as quatro são invalidadas.
 */
export const invalidarSuperficiesDoCofre = async (cliente: QueryClient): Promise<void> => {
  await Promise.all([
    cliente.invalidateQueries({ queryKey: CHAVE_DO_COFRE }),
    cliente.invalidateQueries({ queryKey: CHAVE_DO_HISTORICO_DE_CERTIFICADOS }),
    cliente.invalidateQueries({ queryKey: ['notificacoes'] }),
    cliente.invalidateQueries({ queryKey: ['pendencias'] }),
  ]);
};

/**
 * Falha de operação: toast persistente com o `correlationId` (FRONTEND.md §13).
 * Erro de campo não vem por aqui — fica no campo.
 */
export const avisarFalhaDoCofre = (erro: unknown): void => {
  if (erro instanceof ErroDaApi) {
    toast.error(mensagemDoCofre(erro.problema.code), {
      duration: Infinity,
      description: `Código de suporte: ${erro.problema.correlationId}`,
    });

    return;
  }

  toast.error('Não foi possível concluir a operação.', { duration: Infinity });
};

export const useTrocarResponsavel = (empresaId: string) => {
  const cliente = useQueryClient();

  return useMutation({
    mutationFn: (responsavelId: string) => trocarResponsavelDoCertificado(empresaId, responsavelId),
    onSuccess: (detalhe) => {
      const nome = detalhe.item.responsavel?.nome;

      toast.success(nome === undefined ? 'Responsável alterado.' : `Responsável alterado para ${nome}.`);
    },
    onError: avisarFalhaDoCofre,
    onSettled: () => invalidarSuperficiesDoCofre(cliente),
  });
};

export const useDesativarCertificado = (empresaId: string) => {
  const cliente = useQueryClient();

  return useMutation({
    mutationFn: (motivo: string) => desativarCertificado(empresaId, motivo),
    onSuccess: (detalhe) =>
      toast.success(
        `Certificado desativado. ${detalhe.item.empresaNome} está sem certificado vigente.`,
      ),
    onError: avisarFalhaDoCofre,
    onSettled: () => invalidarSuperficiesDoCofre(cliente),
  });
};
