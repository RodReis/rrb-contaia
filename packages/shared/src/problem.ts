import type { CorrelationId } from '@contaia/domain';

/** Contrato de erro HTTP do projeto: `application/problem+json` (CLAUDE.md, convenções de código). */
export type ProblemDetails = {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly code: string;
  readonly correlationId: CorrelationId;
  readonly detail?: string;
};
