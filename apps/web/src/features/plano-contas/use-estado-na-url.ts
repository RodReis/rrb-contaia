/**
 * Estado da aba "Plano de contas" na URL: o comum às importações, com a aba `plano-contas` e a
 * página do plano vigente em `contas`. O link da notificação
 * (`/empresas/{id}?aba=plano-contas&tentativa={id}`) cai direto na tentativa.
 */
'use client';

import { useEstadoNaUrl as useEstadoDaImportacao } from '../importacao/use-estado-na-url';

export const ABA_DO_PLANO = 'plano-contas';

export const useEstadoNaUrl = (empresaId: string) => useEstadoDaImportacao(empresaId, ABA_DO_PLANO, 'contas');
