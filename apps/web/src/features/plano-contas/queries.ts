'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { useTentativa as useTentativaDe } from '../importacao/queries';
import { listarContas } from './api';
import { DOMINIO_DO_PLANO } from './dominio';

export {
  INTERVALO_DO_ACOMPANHAMENTO_MS,
  TETO_DO_ACOMPANHAMENTO_MS,
  intervaloDoAcompanhamento,
} from '../importacao/queries';

/** A tentativa do plano aberta na URL; o acompanhamento é o comum às importações. */
export const useTentativa = (empresaId: string, tentativaId: string | null) =>
  useTentativaDe(DOMINIO_DO_PLANO, empresaId, tentativaId);

export const useContasDoPlano = (empresaId: string, pagina: number, busca: string) =>
  useQuery({
    queryKey: [DOMINIO_DO_PLANO.recurso, empresaId, 'contas', pagina, busca] as const,
    queryFn: () => listarContas(empresaId, { pagina, busca }),
    placeholderData: keepPreviousData,
  });
