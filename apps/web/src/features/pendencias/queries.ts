'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { avisarFalha } from '../escritorio/queries';
import { buscarPendencias, dispensarPendencia, type FiltroDePendencias } from './api';

const FILTRO_BASE_DA_EMPRESA = {
  origem: null,
  tipo: null,
  estado: 'ABERTA',
  vencimento: null,
} as const;

/**
 * Só o total de pendências abertas da empresa — `limite: 1` evita transferir
 * a lista completa para uma tela que só precisa da contagem (Task 8).
 */
export const usePendenciasDaEmpresa = (empresaId: string) =>
  useQuery({
    queryKey: ['pendencias', 'empresa', empresaId],
    queryFn: () =>
      buscarPendencias({ ...FILTRO_BASE_DA_EMPRESA, empresaId, limite: 1, deslocamento: 0 }),
  });

export const chaveDasPendencias = (filtro: FiltroDePendencias): readonly unknown[] => [
  'pendencias',
  'lista',
  filtro.empresaId,
  filtro.origem,
  filtro.tipo,
  filtro.estado,
  filtro.vencimento,
  filtro.limite,
  filtro.deslocamento,
];

export const usePendencias = (filtro: FiltroDePendencias) =>
  useQuery({
    queryKey: chaveDasPendencias(filtro),
    queryFn: () => buscarPendencias(filtro),
    // Mesmo padrão de `useListaDeEmpresas`: manter a página anterior visível
    // enquanto a nova carrega evita a tabela sumir a cada troca de filtro.
    placeholderData: keepPreviousData,
  });

export const useDispensarPendencia = () => {
  const clienteDeQuery = useQueryClient();

  return useMutation({
    mutationFn: ({
      empresaId,
      pendenciaId,
      justificativa,
    }: {
      empresaId: string;
      pendenciaId: string;
      justificativa: string;
    }) => dispensarPendencia(empresaId, pendenciaId, justificativa),
    onSuccess: () => {
      // Pendências e a contagem da lista de empresas mudam juntas — invalidar
      // os dois ramos, mesmo padrão de `useMutacaoDaEmpresa` do lado empresa.
      void clienteDeQuery.invalidateQueries({ queryKey: ['pendencias'] });
      void clienteDeQuery.invalidateQueries({ queryKey: ['empresas'] });
    },
    onError: avisarFalha,
  });
};
