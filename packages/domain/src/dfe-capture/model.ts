export const DFE_CAPTURE_STATES = ['READY', 'WAITING', 'CAPTURING', 'BLOCKED_656', 'FAILED', 'DISABLED'] as const;
export type DfeCaptureState = (typeof DFE_CAPTURE_STATES)[number];

export const DFE_DOCUMENT_KINDS = ['NFE_55', 'CTE'] as const;
export type DfeDocumentKind = (typeof DFE_DOCUMENT_KINDS)[number];

export type DfeBatchItem = Readonly<{
  nsu: string;
  accessKey: string | null;
  kind: DfeDocumentKind;
  rawContent: string;
}>;

export type DfeCaptureErrorCode =
  | 'DFE_CAPTURE_NOT_READY'
  | 'DFE_QUERY_TOO_EARLY'
  | 'DFE_CAPTURE_ALREADY_QUEUED'
  | 'DFE_CONSUMO_INDEVIDO'
  | 'DFE_CERTIFICATE_UNAVAILABLE'
  | 'DFE_SIGNER_UNAVAILABLE'
  | 'DFE_PROVIDER_UNAVAILABLE'
  | 'DFE_RESPONSE_INVALID'
  | 'DFE_BATCH_INVALID'
  | 'DFE_CAPTURE_CONFLICT'
  | 'DFE_CAPTURE_ACCESS_DENIED';

export type DfeCaptureFailureKind =
  | 'TIMEOUT'
  | 'SIGNER_UNAVAILABLE'
  | 'PROVIDER_UNAVAILABLE'
  | 'CERTIFICATE_UNAVAILABLE'
  | 'INVALID_RESPONSE'
  | 'BATCH_CONFLICT'
  | 'CONSUMO_INDEVIDO';
