import { describe, expect, it } from 'vitest';

import { HISTORICAL_CUTOFF_SOURCE_ID, resolveHistoricalIcms, type HistoricalIcmsFacts, type HistoricalIcmsRule } from './resolve-historical-icms.js';

const facts: HistoricalIcmsFacts = {
  factDate: '2017-06-15', regime: 'SIMPLES_NACIONAL', documentModel: '55', authorized: true, purpose: 'RESALE',
  originUf: 'SP', destinationUf: 'GO', hasValidRetention: false,
  operationType: 'COMPRA_INTERESTADUAL_REVENDA', cfop: '2102', ncm: '12345678', cest: '0100100', cst: '10',
  operationAmountCents: 10_000, freightAmountCents: 0, insuranceAmountCents: 0,
  otherExpensesAmountCents: 0, discountAmountCents: 0, ownIcmsAmountCents: 1_000,
};

const rule = (overrides: Partial<HistoricalIcmsRule> = {}): HistoricalIcmsRule => ({
  id: 'sample-rule', liabilityKind: 'ICMS_ST_RECIPIENT_DUE', relation: 'COEXISTENT',
  regime: 'SIMPLES_NACIONAL', operationType: 'COMPRA_INTERESTADUAL_REVENDA',
  cfop: ['2102'], ncm: ['12345678'], cest: ['0100100'], cst: ['10'], originStates: ['SP'],
  validFrom: '2010-01-01', validUntil: '2018-02-28',
  method: 'MVA_ADJUSTED', mvaBasisPoints: 2_000, internalRateBasisPoints: 2_000,
  interstateRateBasisPoints: 1_000, rounding: 'HALF_UP', formulaVersion: 'TEST_ONLY',
  dueDate: '2017-07-10', revenueCode: '0000', sourceIds: ['official-source'],
  ...overrides,
});

describe('resolveHistoricalIcms', () => {
  it('calcula MVA ajustada com precisão exata e deduz ICMS próprio em centavos', () => {
    const result = resolveHistoricalIcms([rule()], facts);
    expect(result.obligations[0]).toMatchObject({
      liabilityKind: 'ICMS_ST_RECIPIENT_DUE', status: 'APPLICABLE', amountDueCents: 1_700,
      memory: { method: 'MVA_ADJUSTED', calculationBaseCents: 10_000, adjustedBaseCents: 13_500,
        internalRateBasisPoints: 2_000, interstateRateBasisPoints: 1_000, ownIcmsDeductionCents: 1_000,
        rounding: 'HALF_UP', dueDate: '2017-07-10', revenueCode: '0000' },
      sourceIds: ['official-source'],
    });
  });

  it('returns NOT_APPLICABLE from 01/03/2018 without selecting an older rule', () => {
    const result = resolveHistoricalIcms([rule()], { ...facts, factDate: '2018-03-01' });
    expect(result.obligations.every((item) => item.status === 'NOT_APPLICABLE')).toBe(true);
    expect(result.obligations[0]?.reasonCodes).toContain('TAX_HISTORICAL_PERIOD_OUT_OF_SCOPE');
    expect(result.obligations.every((item) => item.sourceIds.includes(HISTORICAL_CUTOFF_SOURCE_ID))).toBe(true);
  });

  it('keeps each liability independent and does not sum their amounts', () => {
    const rules = [rule(), rule({ id: 'advance', liabilityKind: 'ICMS_ENTRY_ADVANCE', method: 'MVA_ORIGINAL', interstateRateBasisPoints: null, revenueCode: '0001' })];
    const result = resolveHistoricalIcms(rules, facts);
    expect(result.obligations.map((item) => item.status)).toEqual(['APPLICABLE', 'APPLICABLE', 'INDETERMINATE']);
    expect(result).not.toHaveProperty('totalAmountCents');
  });

  it('returns INDETERMINATE with no amount when material parameters are missing', () => {
    const result = resolveHistoricalIcms([rule({ dueDate: null })], facts);
    expect(result.obligations[0]).toMatchObject({ status: 'INDETERMINATE', amountDueCents: null });
    expect(result.obligations[0]?.reasonCodes).toContain('TAX_DUE_DATE_NOT_FOUND');
  });

  it('requires a published CEST and NCM pair and never guesses a matching rule', () => {
    const result = resolveHistoricalIcms([rule()], { ...facts, cest: null });
    expect(result.obligations[0]).toMatchObject({ status: 'INDETERMINATE', amountDueCents: null });
    expect(result.obligations[0]?.reasonCodes).toContain('TAX_CEST_NCM_EVIDENCE_MISSING');
  });

  it('abstains when retention evidence is missing or shows valid withholding', () => {
    for (const hasValidRetention of [null, true]) {
      const result = resolveHistoricalIcms([rule()], { ...facts, hasValidRetention });
      expect(result.obligations.every((item) => item.status === 'INDETERMINATE')).toBe(true);
      expect(result.obligations[0]?.amountDueCents).toBeNull();
    }
  });

  it('keeps the 28/02/2018 boundary inclusive', () => {
    const result = resolveHistoricalIcms([rule()], { ...facts, factDate: '2018-02-28' });
    expect(result.obligations[0]?.status).toBe('APPLICABLE');
  });
});
