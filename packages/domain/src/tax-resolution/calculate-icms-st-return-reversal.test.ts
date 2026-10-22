import { describe, expect, it } from 'vitest';
import { calculateIcmsStReturnReversal } from './calculate-icms-st-return-reversal.js';

const input = (overrides: Partial<Parameters<typeof calculateIcmsStReturnReversal>[0]> = {}) => ({
  differenceKind: 'RESTITUTION' as const,
  originalQuantityScaled: 3n,
  previouslyReturnedQuantityScaled: 0n,
  returnedQuantityScaled: 1n,
  originalRestitutionCents: 10,
  originalComplementCents: null,
  ...overrides,
});

describe('calculateIcmsStReturnReversal', () => {
  it('distributes rounding residue on final partial return without exceeding original cents', () => {
    const first = calculateIcmsStReturnReversal(input());
    const second = calculateIcmsStReturnReversal(input({ previouslyReturnedQuantityScaled: 1n }));
    const last = calculateIcmsStReturnReversal(input({ previouslyReturnedQuantityScaled: 2n }));
    expect([first, second, last].map((item) => item.ok && item.reversedRestitutionCents)).toEqual([3, 4, 3]);
    expect([first, second, last].reduce((sum, item) => sum + (item.ok ? item.reversedRestitutionCents : 0), 0)).toBe(10);
  });

  it('rejects cumulative returned quantity above original quantity', () => {
    expect(calculateIcmsStReturnReversal(input({ previouslyReturnedQuantityScaled: 2n, returnedQuantityScaled: 2n })))
      .toEqual({ ok: false, reasonCode: 'ICMS_ST_RETURN_QUANTITY_EXCEEDED' });
  });

  it('keeps NONE lines traceable with zero tax reversal', () => {
    expect(calculateIcmsStReturnReversal(input({ differenceKind: 'NONE', originalRestitutionCents: null })))
      .toMatchObject({ ok: true, reversedRestitutionCents: 0, reversedComplementCents: 0 });
  });

  it('does not infer tax amounts for indeterminate originals', () => {
    expect(calculateIcmsStReturnReversal(input({ differenceKind: 'INDETERMINATE' })))
      .toEqual({ ok: false, reasonCode: 'ICMS_ST_ORIGINAL_CALCULATION_UNAVAILABLE' });
  });
});
