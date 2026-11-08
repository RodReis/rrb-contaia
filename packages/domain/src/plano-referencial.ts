import { createHash } from 'node:crypto';

export type RegimeReferencial = 'LUCRO_PRESUMIDO' | 'SIMPLES_NACIONAL';
export type AplicabilidadeReferencial = 'APPLICABLE' | 'OPTIONAL' | 'INDETERMINATE';
export type EstadoPacoteReferencial = 'AVAILABLE' | 'SUPERSEDED' | 'REVOKED' | 'UNAVAILABLE';
export type NaturezaReferencial = 'DEBIT' | 'CREDIT';

export interface PacoteReferencial {
  readonly id: string;
  readonly status: EstadoPacoteReferencial;
  readonly calendarYears: readonly number[];
  readonly specialSituations: readonly { readonly year: number; readonly code: string }[];
}

export interface ContaReferencialDaEmpresa {
  readonly id: string;
  readonly active: boolean;
  readonly analytical: boolean;
  readonly complete: boolean;
  readonly normalBalance: NaturezaReferencial;
}

export interface CentroReferencialDaEmpresa {
  readonly id: string;
  readonly active: boolean;
  readonly analytical: boolean;
}

export interface DecisaoReferencial {
  readonly accountId: string;
  readonly centerId: string | null;
  readonly kind: 'MAPPED' | 'NOT_APPLICABLE';
  readonly referenceCode: string | null;
  readonly reason: string | null;
  readonly authorId: string | null;
  readonly reviewedBy: string | null;
}

export interface ReferenciaContabil {
  readonly code: string;
  readonly packageId: string;
  readonly active: boolean;
  readonly normalBalance: NaturezaReferencial;
}

export interface ErroValidacaoPublicacaoReferencial {
  readonly code: string;
  readonly accountId: string;
  readonly centerId: string | null;
}

export const avaliarAplicabilidadeReferencial = (input: {
  readonly regime: RegimeReferencial;
  readonly year: number;
  readonly situation: string | null;
  readonly packages: readonly PacoteReferencial[];
}): { readonly status: AplicabilidadeReferencial; readonly packageId: string | null } => {
  const matched = input.packages.filter((item) => item.status === 'AVAILABLE'
    && (input.situation === null
      ? item.calendarYears.includes(input.year)
      : item.specialSituations.some((covered) => covered.year === input.year && covered.code === input.situation)));
  if (matched.length !== 1) return { status: 'INDETERMINATE', packageId: null };
  return {
    status: input.regime === 'SIMPLES_NACIONAL' ? 'OPTIONAL' : 'APPLICABLE',
    packageId: matched[0]!.id,
  };
};

/** A exceção do centro substitui a decisão-base sem alterar a conta da F39. */
export const resolverDecisaoReferencial = (
  decisions: readonly DecisaoReferencial[], accountId: string, centerId: string | null,
): DecisaoReferencial | null => {
  if (centerId !== null) {
    const override = decisions.find((item) => item.accountId === accountId && item.centerId === centerId);
    if (override !== undefined) return override;
  }
  return decisions.find((item) => item.accountId === accountId && item.centerId === null) ?? null;
};

/** Snapshot canônico não depende da ordem física recebida. */
export const hashMapeamentoReferencial = (input: {
  readonly packageId: string;
  readonly packageCanonicalSha256: string;
  readonly calendarYear: number;
  readonly decisions: readonly DecisaoReferencial[];
  readonly centerCodes: readonly { readonly id: string; readonly code: string }[];
}): string => {
  const order = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;
  const decisions = [...input.decisions].sort((a, b) => order(a.accountId, b.accountId)
    || order(a.centerId ?? '', b.centerId ?? ''));
  const centers = [...input.centerCodes].sort((a, b) => order(a.id, b.id));
  const canonical = JSON.stringify({ packageId: input.packageId, packageCanonicalSha256: input.packageCanonicalSha256, calendarYear: input.calendarYear, decisions, centers });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
};

export const validarPublicacaoReferencial = (input: {
  readonly packageId: string;
  readonly accounts: readonly ContaReferencialDaEmpresa[];
  readonly costCenters: readonly CentroReferencialDaEmpresa[];
  readonly decisions: readonly DecisaoReferencial[];
  readonly references: readonly ReferenciaContabil[];
}): readonly ErroValidacaoPublicacaoReferencial[] => {
  const errors: ErroValidacaoPublicacaoReferencial[] = [];
  const eligibleAccounts = new Map(input.accounts
    .filter((account) => account.active && account.analytical)
    .map((account) => [account.id, account]));
  const eligibleCenters = new Map(input.costCenters
    .filter((center) => center.active && center.analytical)
    .map((center) => [center.id, center]));
  const decisionByPair = new Map<string, DecisaoReferencial>();
  const referenceByCode = new Map(input.references
    .filter((reference) => reference.packageId === input.packageId && reference.active)
    .map((reference) => [reference.code, reference]));
  const pairKey = (accountId: string, centerId: string | null) => `${accountId}\u0000${centerId ?? ''}`;
  const addError = (code: string, accountId: string, centerId: string | null): void => {
    errors.push({ code, accountId, centerId });
  };

  for (const account of input.accounts) {
    if (account.active && account.analytical && !account.complete) {
      addError('REFERENCE_MAPPING_ACCOUNT_INCOMPLETE', account.id, null);
    }
  }

  for (const decision of input.decisions) {
    const key = pairKey(decision.accountId, decision.centerId);
    if (decisionByPair.has(key)) {
      addError('REFERENCE_MAPPING_DUPLICATE_PAIR', decision.accountId, decision.centerId);
      continue;
    }
    decisionByPair.set(key, decision);

    const account = eligibleAccounts.get(decision.accountId);
    if (account === undefined || !account.complete) {
      addError('REFERENCE_MAPPING_ACCOUNT_INELIGIBLE', decision.accountId, decision.centerId);
    }
    if (decision.centerId !== null) {
      const center = eligibleCenters.get(decision.centerId);
      if (center === undefined) addError('REFERENCE_MAPPING_COST_CENTER_INELIGIBLE', decision.accountId, decision.centerId);
    }

    if (decision.kind === 'NOT_APPLICABLE') {
      if (decision.referenceCode !== null) addError('REFERENCE_MAPPING_NOT_APPLICABLE_HAS_REFERENCE', decision.accountId, decision.centerId);
      if (decision.reason === null || decision.reason.trim().length === 0 || decision.authorId === null || decision.reviewedBy === null) {
        addError('REFERENCE_MAPPING_NOT_APPLICABLE_REVIEW_REQUIRED', decision.accountId, decision.centerId);
      }
      continue;
    }

    if (decision.reason !== null || decision.referenceCode === null) {
      addError('REFERENCE_MAPPING_INVALID_DECISION', decision.accountId, decision.centerId);
    }
    const reference = decision.referenceCode === null ? undefined : referenceByCode.get(decision.referenceCode);
    if (reference === undefined) {
      addError('REFERENCE_ACCOUNT_NOT_FOUND', decision.accountId, decision.centerId);
    } else if (account !== undefined && account.normalBalance !== reference.normalBalance) {
      addError('REFERENCE_ACCOUNT_NATURE_MISMATCH', decision.accountId, decision.centerId);
    }
  }

  for (const account of eligibleAccounts.values()) {
    if (!decisionByPair.has(pairKey(account.id, null))) addError('REFERENCE_MAPPING_INCOMPLETE', account.id, null);
  }

  return errors;
};

