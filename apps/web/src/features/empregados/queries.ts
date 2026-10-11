'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { listarEmpregados } from './api';

/** Sob a mesma raiz da importação (`empregados`, empresa): o fim de uma tentativa relê a base. */
export const useEmpregados = (empresaId: string, pagina: number, busca: string) =>
  useQuery({
    queryKey: ['empregados', empresaId, 'base', pagina, busca] as const,
    queryFn: () => listarEmpregados(empresaId, { pagina, busca }),
    placeholderData: keepPreviousData,
  });
