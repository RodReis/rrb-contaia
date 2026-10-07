'use client';

import type { Finalidade } from '@contaia/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { ErroDaApi } from '@/lib/http';

import { CHAVE_DO_COFRE } from '../queries';
import {
  consultarEstadoDaEmpresaNoSigner,
  consultarEstadosDoSigner,
  consultarHistoricoDoSigner,
  consultarPainelDoSigner,
  testarMtls,
  type FiltroDoHistoricoDoSigner,
} from './api';
import { mensagemDoSigner } from './apresentacao';

/** Sob a raiz do cofre: invalidar o cofre (envio, troca, desativação) também recarrega o Signer. */
export const CHAVE_DO_SIGNER = [...CHAVE_DO_COFRE, 'signer'] as const;

/** O monitor verifica a cada minuto (SPEC-012 §3.10): ler mais rápido que isso não traz nada. */
const INTERVALO_DE_ATUALIZACAO_MS = 60_000;

export const usePainelDoSigner = (habilitado: boolean) =>
  useQuery({
    queryKey: [...CHAVE_DO_SIGNER, 'painel'],
    queryFn: consultarPainelDoSigner,
    enabled: habilitado,
    refetchInterval: INTERVALO_DE_ATUALIZACAO_MS,
    // Em falha de comunicação o último estado conhecido segue na tela (SPEC-012 §5.4).
    placeholderData: keepPreviousData,
  });

export const useEstadosDoSigner = (empresaIds: readonly string[], habilitado: boolean) =>
  useQuery({
    queryKey: [...CHAVE_DO_SIGNER, 'estados', [...empresaIds].sort()],
    queryFn: () => consultarEstadosDoSigner(empresaIds),
    enabled: habilitado && empresaIds.length > 0,
    refetchInterval: INTERVALO_DE_ATUALIZACAO_MS,
    placeholderData: keepPreviousData,
  });

export const useEstadoDaEmpresaNoSigner = (empresaId: string | null, habilitado: boolean) =>
  useQuery({
    queryKey: [...CHAVE_DO_SIGNER, 'empresa', empresaId],
    queryFn: () => consultarEstadoDaEmpresaNoSigner(empresaId ?? ''),
    enabled: habilitado && empresaId !== null,
    refetchInterval: INTERVALO_DE_ATUALIZACAO_MS,
  });

export const useHistoricoDoSigner = (
  empresaId: string | null,
  filtro: FiltroDoHistoricoDoSigner,
  habilitado: boolean,
) =>
  useQuery({
    queryKey: [...CHAVE_DO_SIGNER, 'historico', empresaId, filtro],
    queryFn: () => consultarHistoricoDoSigner(empresaId ?? '', filtro),
    enabled: habilitado && empresaId !== null,
    placeholderData: keepPreviousData,
  });

/**
 * Teste manual. O resultado de cada finalidade volta no corpo (falha de finalidade não é erro
 * da chamada) e a tela o mostra com o `correlationId`; só a falha da chamada vira toast.
 */
export const useTestarMtls = (empresaId: string) => {
  const cliente = useQueryClient();

  return useMutation({
    mutationFn: (finalidade?: Finalidade) => testarMtls(empresaId, finalidade),
    onError: (erro) => {
      if (erro instanceof ErroDaApi) {
        toast.error(mensagemDoSigner(erro.problema.code), {
          duration: Infinity,
          description: `Código de suporte: ${erro.problema.correlationId}`,
        });

        return;
      }

      toast.error('Não foi possível concluir o teste.', { duration: Infinity });
    },
    // Teste novo escreve histórico, estado e (na falha) pode abrir alerta no sino.
    onSettled: () =>
      Promise.all([
        cliente.invalidateQueries({ queryKey: CHAVE_DO_SIGNER }),
        cliente.invalidateQueries({ queryKey: ['notificacoes'] }),
      ]),
  });
};
