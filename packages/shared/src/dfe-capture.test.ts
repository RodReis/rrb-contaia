import { describe, expect, it } from 'vitest';
import { DfeDistributionResponseSchema } from './dfe-capture.js';

describe('contrato de distribuição DF-e', () => {
  it('impõe o mesmo teto agregado de 8 MiB do transporte mTLS', () => {
    const response = {
      status: 'SUCCESS', lastNsu: '5', maxNsu: '5', averageTimeMs: 60_000,
      retryAt: null, providerCode: 'ok',
      items: Array.from({ length: 5 }, (_, index) => ({
        nsu: String(index + 1), accessKey: null, kind: 'NFE_55',
        rawContent: 'x'.repeat(1_750_000),
      })),
    };
    expect(DfeDistributionResponseSchema.safeParse(response).success).toBe(false);
  });
});
