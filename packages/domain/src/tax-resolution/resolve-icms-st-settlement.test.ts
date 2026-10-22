import { describe, expect, it } from 'vitest';
import { resolveIcmsStSettlement, type IcmsStInputEntry, type IcmsStOutputLine, type IcmsStSettlementRule } from './resolve-icms-st-settlement.js';

const rule: IcmsStSettlementRule = {
  id: 'test-rule', taxSegment: 'AUTO_PARTS', legalDescription: 'fixture isolada de teste', destinationUf: 'GO', finalConsumer: true,
  regime: 'SIMPLES_NACIONAL', ncm: ['12345678'], cest: ['0100100'], cfop: ['5102'], cstCsosn: ['102'],
  validFrom: '2016-10-27', validUntil: '2018-02-28', effectiveBaseFactorBasisPoints: 10_000, internalRateBasisPoints: 1_000,
  effectiveBaseFormula: 'NET_PRODUCT_TIMES_BASE_FACTOR', effectiveIcmsFormula: 'EFFECTIVE_BASE_TIMES_INTERNAL_RATE',
  rounding: 'HALF_UP', formulaVersion: 'TEST_ONLY', sourceIds: ['test-only'],
};

const output: IcmsStOutputLine = {
  id: 'output:1', documentId: 'output', itemNumber: 1, documentModel: '55', documentAuthorized: true, documentCanceled: false,
  canceledAfterSale: false, factDate: '2017-06-15', sellerUf: 'GO', destinationUf: 'GO', finalConsumer: true,
  regime: 'SIMPLES_NACIONAL', productId: '7891234567895', ncm: '12345678', cest: '0100100', cfop: '5102', cstCsosn: '102',
  unit: 'UN', quantityScaled: 10_000_000_000n, quantityScale: 10, outputBaseCents: 10_000, ruleId: null,
};

const entry = (overrides: Partial<IcmsStInputEntry> = {}): IcmsStInputEntry => ({
  id: 'entry:1', documentId: 'entry', efdRecordId: null, companyId: 'company', productId: output.productId, unit: output.unit,
  factDate: '2017-06-10', competence: '2017-06', quantityScaled: 10_000_000_000n, inputIcmsCents: 500,
  inputIcmsStCents: 0, presumedBaseCents: 10_000, corroborated: true, linkedOutputLineIds: ['output:1'], ...overrides,
});

const resolve = (entries: readonly IcmsStInputEntry[]) => resolveIcmsStSettlement({
  companyId: 'company', competence: '2017-06', regime: 'SIMPLES_NACIONAL', outputs: [output], entries, rules: [rule],
});

describe('resolveIcmsStSettlement', () => {
  it('usa vínculo direto documentado cuja entrada antecede a saída', () => {
    const result = resolve([entry()]);
    expect(result).toMatchObject({ status: 'PENDING_REVIEW', grossComplementCents: 500, grossRestitutionCents: 0 });
    expect(result.lines[0]).toMatchObject({ recoveryOrigin: 'DIRECT_DOCUMENT', differenceKind: 'COMPLEMENT', recoveryDocumentIds: ['entry'] });
  });

  it('mantém indeterminada a linha vinculada a uma entrada posterior à venda', () => {
    const result = resolve([entry({ factDate: '2017-06-16' })]);
    expect(result).toMatchObject({ status: 'BLOCKED', grossComplementCents: null, netAmountCents: null });
    expect(result.lines[0]?.blockingReasonCodes).toContain('INPUT_RECOVERY_INDETERMINATE');
  });

  it('não usa entrada com data inválida na média ponderada mensal', () => {
    const result = resolve([entry({ linkedOutputLineIds: [], factDate: '2017-02-30' })]);
    expect(result.status).toBe('BLOCKED');
    expect(result.lines[0]?.blockingReasonCodes).toContain('INPUT_RECOVERY_INDETERMINATE');
  });

  it('preserva soma mensal nula quando qualquer item não tem recuperação comprovada', () => {
    const result = resolve([entry({ corroborated: false })]);
    expect(result).toMatchObject({ status: 'BLOCKED', grossRestitutionCents: null, grossComplementCents: null, netAmountCents: null });
  });

  it('aceita NFC-e sem destinatário quando idDest e indFinal comprovam venda interna a consumidor final', () => {
    const nfce: IcmsStOutputLine = { ...output, documentId: 'nfce', id: 'nfce:1', documentModel: '65', destinationUf: null,
      destinationIndicator: '1', finalConsumerIndicator: '1' };
    const result = resolveIcmsStSettlement({ companyId: 'company', competence: '2017-06', regime: 'SIMPLES_NACIONAL',
      outputs: [nfce], entries: [entry({ linkedOutputLineIds: ['nfce:1'] })], rules: [rule] });
    expect(result.lines[0]).toMatchObject({ differenceKind: 'COMPLEMENT', outputDocumentId: 'nfce' });
  });

  it('não infere indicadores ausentes ou contraditórios em NFC-e', () => {
    const base: IcmsStOutputLine = { ...output, documentId: 'nfce', id: 'nfce:1', documentModel: '65', destinationUf: null,
      destinationIndicator: null, finalConsumerIndicator: '1' };
    const missing = resolveIcmsStSettlement({ companyId: 'company', competence: '2017-06', regime: 'SIMPLES_NACIONAL',
      outputs: [base], entries: [entry({ linkedOutputLineIds: ['nfce:1'] })], rules: [rule] });
    expect(missing.lines[0]?.blockingReasonCodes).toContain('OUTPUT_INDICATOR_MISSING');
    const contradictory = resolveIcmsStSettlement({ companyId: 'company', competence: '2017-06', regime: 'SIMPLES_NACIONAL',
      outputs: [{ ...base, destinationIndicator: '2', finalConsumerIndicator: '0' }], entries: [entry({ linkedOutputLineIds: ['nfce:1'] })], rules: [rule] });
    expect(contradictory.lines[0]?.blockingReasonCodes).toContain('OUTPUT_INDICATOR_CONTRADICTORY');
  });
});
