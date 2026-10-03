'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { ErroDaApi } from '@/lib/http';
import { avisarFalha } from '../escritorio/queries';
import { CHAVE_DA_SESSAO } from '../usuarios/queries';
import {
  alterarCarteira,
  consultarHistoricoDeCarteiras,
  listarColaboradores,
  listarColaboradoresDaEmpresa,
  listarEmpresasParaAtribuicao,
  obterColaborador,
  obterMinhaCarteira,
  type AlteracaoDeCarteira,
  type FiltroDeColaboradores,
  type FiltroDeEmpresas,
  type FiltroDeEventosDeCarteira,
} from './api';

/** Tudo que a carteira altera ou lê passa por esta raiz: uma invalidação alcança todas as visões. */
export const CHAVE_DA_CARTEIRA = ['carteira'] as const;

export const useColaboradores = (filtro: FiltroDeColaboradores) =>
  useQuery({
    queryKey: [...CHAVE_DA_CARTEIRA, 'colaboradores', filtro],
    queryFn: () => listarColaboradores(filtro),
    // A lista é conferida: manter a página anterior evita a tabela sumir a cada tecla da busca.
    placeholderData: keepPreviousData,
  });

export const useColaborador = (usuarioId: string) =>
  useQuery({
    queryKey: [...CHAVE_DA_CARTEIRA, 'colaborador', usuarioId],
    queryFn: () => obterColaborador(usuarioId),
  });

export const useEmpresasParaAtribuicao = (usuarioId: string, filtro: FiltroDeEmpresas) =>
  useQuery({
    queryKey: [...CHAVE_DA_CARTEIRA, 'empresas', usuarioId, filtro],
    queryFn: () => listarEmpresasParaAtribuicao(usuarioId, filtro),
    placeholderData: keepPreviousData,
  });

export const useColaboradoresDaEmpresa = (empresaId: string) =>
  useQuery({
    queryKey: [...CHAVE_DA_CARTEIRA, 'da-empresa', empresaId],
    queryFn: () => listarColaboradoresDaEmpresa(empresaId),
  });

export const useMinhaCarteira = () =>
  useQuery({
    queryKey: [...CHAVE_DA_CARTEIRA, 'minha'],
    queryFn: obterMinhaCarteira,
  });

export const useHistoricoDeCarteiras = (filtro: FiltroDeEventosDeCarteira, habilitado = true) =>
  useQuery({
    queryKey: ['historico-de-carteiras', filtro],
    queryFn: () => consultarHistoricoDeCarteiras(filtro),
    enabled: habilitado,
    placeholderData: keepPreviousData,
  });

/**
 * Salva a operação inteira ou nada. Depois de salvar, a carteira, a sessão (que
 * diz se a carteira está vazia) e o sino (que recebe o aviso consolidado) são
 * invalidados: a próxima leitura já mostra o estado novo.
 *
 * O 409 de carteira desatualizada não vira toast de falha genérica: o diálogo
 * explica e a tela recarrega os dados antes de a pessoa revisar de novo.
 */
export const useAlterarCarteira = () => {
  const cliente = useQueryClient();

  return useMutation({
    mutationFn: (alteracao: AlteracaoDeCarteira) => alterarCarteira(alteracao),
    onSuccess: (resultado) => {
      if (resultado.aplicado) {
        toast.success(
          resultado.afetados.length === 1
            ? 'Carteira atualizada.'
            : `Carteira atualizada para ${resultado.afetados.length} colaboradores.`,
        );
      } else {
        toast.message('Nada mudou: a carteira já estava assim.');
      }
    },
    onError: (erro) => {
      if (erro instanceof ErroDaApi && erro.problema.code === 'CARTEIRA_DESATUALIZADA') {
        toast.warning('A carteira mudou desde que você a abriu. Os dados foram recarregados.');
        return;
      }

      avisarFalha(erro);
    },
    onSettled: async () => {
      await Promise.all([
        cliente.invalidateQueries({ queryKey: CHAVE_DA_CARTEIRA }),
        cliente.invalidateQueries({ queryKey: CHAVE_DA_SESSAO }),
        cliente.invalidateQueries({ queryKey: ['historico-de-carteiras'] }),
        cliente.invalidateQueries({ queryKey: ['notificacoes'] }),
      ]);
    },
  });
};
