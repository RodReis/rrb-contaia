import {
  DFE_DOCUMENT_KINDS,
  type DfeBatchItem,
  type DfeCaptureErrorCode,
  type DfeCaptureFailureKind,
  type DfeCaptureState,
} from './model.js';

type EligibilityInput = Readonly<{
  companyActive: boolean;
  cnpjActive: boolean;
  certificateAvailable: boolean;
  signerAvailable: boolean;
  state: DfeCaptureState;
  nextAllowedAt: Date;
  blockedUntil: Date | null;
  now: Date;
}>;

export type CaptureEligibility =
  | Readonly<{ eligible: true }>
  | Readonly<{ eligible: false; code: DfeCaptureErrorCode; availableAt: Date | null }>;

const denied = (code: DfeCaptureErrorCode, availableAt: Date | null = null): CaptureEligibility => ({
  eligible: false,
  code,
  availableAt,
});

export const decideCaptureEligibility = (input: EligibilityInput): CaptureEligibility => {
  if (!input.companyActive || !input.cnpjActive || input.state === 'DISABLED' || input.state === 'FAILED') {
    return denied('DFE_CAPTURE_NOT_READY');
  }
  if (!input.certificateAvailable) {
    return denied('DFE_CERTIFICATE_UNAVAILABLE');
  }
  if (!input.signerAvailable) {
    return denied('DFE_SIGNER_UNAVAILABLE');
  }
  if (input.state === 'CAPTURING') {
    return denied('DFE_CAPTURE_ALREADY_QUEUED');
  }
  if (input.state === 'BLOCKED_656' && input.blockedUntil !== null && input.blockedUntil > input.now) {
    return denied('DFE_CONSUMO_INDEVIDO', input.blockedUntil);
  }
  if (input.nextAllowedAt > input.now) {
    return denied('DFE_QUERY_TOO_EARLY', input.nextAllowedAt);
  }

  return { eligible: true };
};

export const nextAllowedAt = (finishedAt: Date, averageTimeMs: number): Date => {
  if (!Number.isSafeInteger(averageTimeMs) || averageTimeMs < 0) {
    throw new Error('DFE_RESPONSE_INVALID');
  }

  return new Date(finishedAt.getTime() + averageTimeMs);
};

type BatchInput = Readonly<{
  previousLastNsu: string;
  returnedLastNsu: string;
  maxNsu: string;
  items: readonly DfeBatchItem[];
}>;

const numericNsu = (value: string): bigint | null => {
  if (!/^\d{1,15}$/u.test(value)) {
    return null;
  }

  return BigInt(value);
};

export const evaluateBatch = (input: BatchInput): Readonly<{ ok: true }> | Readonly<{ ok: false; code: DfeCaptureErrorCode }> => {
  if (input.items.length > 50) {
    return { ok: false, code: 'DFE_BATCH_INVALID' };
  }

  const previous = numericNsu(input.previousLastNsu);
  const returned = numericNsu(input.returnedLastNsu);
  const maximum = numericNsu(input.maxNsu);
  if (previous === null || returned === null || maximum === null || returned < previous || returned > maximum) {
    return { ok: false, code: 'DFE_RESPONSE_INVALID' };
  }

  let prior = previous;
  for (const item of input.items) {
    const nsu = numericNsu(item.nsu);
    const accessKeyIsValid = item.accessKey === null || /^\d{44}$/u.test(item.accessKey);
    if (nsu === null || nsu <= prior || !DFE_DOCUMENT_KINDS.includes(item.kind) || !accessKeyIsValid || item.rawContent.length === 0) {
      return { ok: false, code: 'DFE_BATCH_INVALID' };
    }
    prior = nsu;
  }

  if (input.items.length > 0 && prior !== returned) {
    return { ok: false, code: 'DFE_RESPONSE_INVALID' };
  }

  return { ok: true };
};

type FailureInput = Readonly<{ kind: DfeCaptureFailureKind; providerRetryAt: Date | null; now: Date }>;
type FailureClassification = Readonly<{ retry: boolean; code: DfeCaptureErrorCode; blockedUntil: Date | null }>;

export const classifyCaptureFailure = (input: FailureInput): FailureClassification => {
  if (input.kind === 'CONSUMO_INDEVIDO') {
    const minimum = new Date(input.now.getTime() + 60 * 60 * 1_000);
    return {
      retry: false,
      code: 'DFE_CONSUMO_INDEVIDO',
      blockedUntil: input.providerRetryAt !== null && input.providerRetryAt > minimum ? input.providerRetryAt : minimum,
    };
  }

  const retry = input.kind === 'TIMEOUT' || input.kind === 'SIGNER_UNAVAILABLE' || input.kind === 'PROVIDER_UNAVAILABLE';
  const code: DfeCaptureErrorCode =
    input.kind === 'CERTIFICATE_UNAVAILABLE'
      ? 'DFE_CERTIFICATE_UNAVAILABLE'
      : input.kind === 'INVALID_RESPONSE'
        ? 'DFE_RESPONSE_INVALID'
        : input.kind === 'INVALID_BATCH'
          ? 'DFE_BATCH_INVALID'
        : input.kind === 'BATCH_CONFLICT'
          ? 'DFE_CAPTURE_CONFLICT'
          : input.kind === 'SIGNER_UNAVAILABLE'
            ? 'DFE_SIGNER_UNAVAILABLE'
            : 'DFE_PROVIDER_UNAVAILABLE';

  return { retry, code, blockedUntil: null };
};
