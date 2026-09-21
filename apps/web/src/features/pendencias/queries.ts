'use client';

import { useQuery } from '@tanstack/react-query';

import { buscarPendencias } from './api';

/**
 * Só o total de pendências abertas da empresa — `limite: 1` evita transferir
 * a lista completa para uma tela que só precisa da contagem (Task 8).
 */
export const usePendenciasDaEmpresa = (empresaId: string) =>
  useQuery({
    queryKey: ['pendencias', 'empresa', empresaId],
    queryFn: () => buscarPendencias({ empresaId, limite: 1, deslocamento: 0 }),
  });
