export const CORPORATE_TAX_RATE_SCALE = 100_000_000n;

export const roundHalfUp = (numerator: bigint, denominator: bigint): bigint =>
  (numerator * 2n + denominator) / (2n * denominator);

export const parseScaledRate = (rate: string): bigint | null => {
  if (!/^\d+(?:\.\d{1,8})?$/u.test(rate)) return null;
  const [whole, fraction = ''] = rate.split('.');
  if (whole === undefined) return null;
  return BigInt(whole) * CORPORATE_TAX_RATE_SCALE + BigInt(fraction.padEnd(8, '0'));
};
