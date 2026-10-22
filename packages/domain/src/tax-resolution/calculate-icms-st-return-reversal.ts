import type { IcmsStDifferenceKind } from './resolve-icms-st-settlement.js';

export type IcmsStReturnReversalInput = Readonly<{
  differenceKind: IcmsStDifferenceKind;
  originalQuantityScaled: bigint;
  previouslyReturnedQuantityScaled: bigint;
  returnedQuantityScaled: bigint;
  originalRestitutionCents: number | null;
  originalComplementCents: number | null;
}>;

export type IcmsStReturnReversalResult = Readonly<{
  ok: true;
  returnedQuantityScaled: bigint;
  remainingQuantityScaled: bigint;
  reversedRestitutionCents: number;
  reversedComplementCents: number;
}> | Readonly<{
  ok: false;
  reasonCode: 'ICMS_ST_RETURN_QUANTITY_INVALID' | 'ICMS_ST_RETURN_QUANTITY_EXCEEDED' | 'ICMS_ST_ORIGINAL_CALCULATION_UNAVAILABLE';
}>;

const roundHalfUp = (numerator: bigint, denominator: bigint): bigint =>
  (2n * numerator + denominator) / (2n * denominator);

const proratedDelta = (amount: number, before: bigint, returned: bigint, total: bigint): number | null => {
  if (!Number.isSafeInteger(amount) || amount < 0) return null;
  const after = roundHalfUp(BigInt(amount) * (before + returned), total);
  const prior = roundHalfUp(BigInt(amount) * before, total);
  const delta = after - prior;
  return delta < 0n || delta > BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(delta);
};

/** Computes cumulative proportional reversals so the last partial return absorbs rounding residue. */
export const calculateIcmsStReturnReversal = (
  input: IcmsStReturnReversalInput,
): IcmsStReturnReversalResult => {
  const { originalQuantityScaled: total, previouslyReturnedQuantityScaled: before, returnedQuantityScaled: returned } = input;
  if (total <= 0n || before < 0n || returned <= 0n) {
    return { ok: false, reasonCode: 'ICMS_ST_RETURN_QUANTITY_INVALID' };
  }
  if (before + returned > total) {
    return { ok: false, reasonCode: 'ICMS_ST_RETURN_QUANTITY_EXCEEDED' };
  }
  if (input.differenceKind === 'INDETERMINATE') {
    return { ok: false, reasonCode: 'ICMS_ST_ORIGINAL_CALCULATION_UNAVAILABLE' };
  }
  if (input.differenceKind === 'NONE') {
    return { ok: true, returnedQuantityScaled: returned, remainingQuantityScaled: total - before - returned,
      reversedRestitutionCents: 0, reversedComplementCents: 0 };
  }
  const restitution = input.differenceKind === 'RESTITUTION'
    ? input.originalRestitutionCents === null ? null : proratedDelta(input.originalRestitutionCents, before, returned, total)
    : 0;
  const complement = input.differenceKind === 'COMPLEMENT'
    ? input.originalComplementCents === null ? null : proratedDelta(input.originalComplementCents, before, returned, total)
    : 0;
  if (restitution === null || complement === null) {
    return { ok: false, reasonCode: 'ICMS_ST_ORIGINAL_CALCULATION_UNAVAILABLE' };
  }
  return { ok: true, returnedQuantityScaled: returned, remainingQuantityScaled: total - before - returned,
    reversedRestitutionCents: restitution, reversedComplementCents: complement };
};
