/**
 * Tokens de injeção da importação do plano de contas (SPEC-013).
 */
import { InjectionToken } from '@nestjs/common';
import type { FilaQueEnfileira } from '@contaia/shared';

export const FILA_DE_VALIDACAO_PLANO_CONTAS_DA_API = new InjectionToken<FilaQueEnfileira>(
  'FILA_DE_VALIDACAO_PLANO_CONTAS_DA_API',
) as unknown as InjectionToken<FilaQueEnfileira>;