import { lerDataCivil } from '../datas/data-civil.js';

export type IcmsStRecoveryOrigin = 'DIRECT_DOCUMENT' | 'EFD_RECORDED' | 'MONTHLY_WEIGHTED_AVERAGE';
export type IcmsStDifferenceKind = 'RESTITUTION' | 'COMPLEMENT' | 'NONE' | 'INDETERMINATE';
export type IcmsStSettlementStatus = 'PROCESSING' | 'BLOCKED' | 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED';

export type IcmsStSettlementRule = Readonly<{
  id: string;
  taxSegment: 'AUTO_PARTS';
  legalDescription: string;
  destinationUf: 'GO';
  finalConsumer: true;
  regime: 'SIMPLES_NACIONAL' | 'LUCRO_PRESUMIDO';
  ncm: readonly string[];
  cest: readonly string[];
  cfop: readonly string[];
  cstCsosn: readonly string[];
  validFrom: string;
  validUntil: string;
  effectiveBaseFactorBasisPoints: number | null;
  internalRateBasisPoints: number | null;
  effectiveBaseFormula: 'NET_PRODUCT_TIMES_BASE_FACTOR';
  effectiveIcmsFormula: 'EFFECTIVE_BASE_TIMES_INTERNAL_RATE';
  rounding: 'HALF_UP';
  formulaVersion: string;
  sourceIds: readonly string[];
}>;

export type IcmsStSettlementFixture = Readonly<{
  id: string;
  ruleId: string;
  factDate: string;
  regime: 'SIMPLES_NACIONAL' | 'LUCRO_PRESUMIDO';
  ncm: string;
  cest: string;
  cfop: string;
  cstCsosn: string;
  outputBaseCents: number;
  expectedEffectiveBaseCents: number;
  expectedEffectiveIcmsCents: number;
  sourceIds: readonly string[];
}>;

export type IcmsStOutputLine = Readonly<{
  id: string;
  documentId: string;
  accessKey?: string;
  itemNumber: number;
  documentModel: string;
  documentAuthorized: boolean;
  documentCanceled: boolean;
  canceledAfterSale: boolean | null;
  factDate: string;
  sellerUf: string | null;
  destinationUf: string | null;
  finalConsumer: boolean | null;
  destinationIndicator?: string | null;
  finalConsumerIndicator?: string | null;
  destinationIdentifier?: string | null;
  regime: 'SIMPLES_NACIONAL' | 'LUCRO_PRESUMIDO' | null;
  productId: string | null;
  ncm: string | null;
  cest: string | null;
  cfop: string | null;
  cstCsosn: string | null;
  unit: string | null;
  quantityScaled: bigint | null;
  quantityScale: number | null;
  outputBaseCents: number | null;
  ruleId: string | null;
}>;

export type IcmsStInputEntry = Readonly<{
  id: string;
  documentId: string | null;
  efdRecordId: string | null;
  companyId: string;
  productId: string | null;
  unit: string | null;
  factDate: string;
  competence: string;
  quantityScaled: bigint | null;
  inputIcmsCents: number | null;
  inputIcmsStCents: number | null;
  presumedBaseCents: number | null;
  corroborated: boolean;
  linkedOutputLineIds: readonly string[];
}>;

export type IcmsStSettlementLine = Readonly<{
  outputDocumentId: string;
  outputItemId: string;
  productId: string | null;
  normalizedUnit: string | null;
  quantityScaled: bigint | null;
  recoveryOrigin: IcmsStRecoveryOrigin | null;
  presumedBaseCents: number | null;
  effectiveBaseCents: number | null;
  inputIcmsCents: number | null;
  inputIcmsStCents: number | null;
  effectiveIcmsCents: number | null;
  differenceKind: IcmsStDifferenceKind;
  restitutionCents: number | null;
  complementCents: number | null;
  ruleId: string | null;
  formulaVersion: string | null;
  sourceIds: readonly string[];
  recoveryDocumentIds: readonly string[];
  blockingReasonCodes: readonly string[];
}>;

export type IcmsStMonthlySettlement = Readonly<{
  competence: string;
  regime: 'SIMPLES_NACIONAL' | 'LUCRO_PRESUMIDO' | null;
  status: IcmsStSettlementStatus;
  grossRestitutionCents: number | null;
  grossComplementCents: number | null;
  netAmountCents: number | null;
  lines: readonly IcmsStSettlementLine[];
  blockingReasonCodes: readonly string[];
}>;

export type IcmsStSettlementInput = Readonly<{
  companyId: string;
  competence: string;
  regime: 'SIMPLES_NACIONAL' | 'LUCRO_PRESUMIDO' | null;
  outputs: readonly IcmsStOutputLine[];
  entries: readonly IcmsStInputEntry[];
  rules: readonly IcmsStSettlementRule[];
}>;

const WINDOW_START = '2016-10-27';
const WINDOW_END = '2018-02-28';
const safeCents = (value: number | null): value is number => value !== null && Number.isSafeInteger(value) && value >= 0;
const isCivilDate = (value: string): boolean => {
  try { return lerDataCivil(value) === value; } catch { return false; }
};
const roundHalfUp = (numerator: bigint, denominator: bigint): bigint => {
  if (denominator <= 0n) throw new Error('denominador de arredondamento inválido');
  return (2n * numerator + denominator) / (2n * denominator);
};

export const calculateIcmsStOutputTax = (rule: IcmsStSettlementRule, outputBaseCents: number): Readonly<{effectiveBaseCents:number;effectiveIcmsCents:number}> | null => {
  if (!safeCents(outputBaseCents) || rule.rounding !== 'HALF_UP' || rule.effectiveBaseFormula.trim()==='' || rule.effectiveIcmsFormula.trim()==='' ||
      rule.effectiveBaseFactorBasisPoints === null || !Number.isSafeInteger(rule.effectiveBaseFactorBasisPoints) || rule.effectiveBaseFactorBasisPoints < 0 ||
      rule.internalRateBasisPoints === null || !Number.isSafeInteger(rule.internalRateBasisPoints) || rule.internalRateBasisPoints < 0) return null;
  const effectiveBase = roundHalfUp(BigInt(outputBaseCents) * BigInt(rule.effectiveBaseFactorBasisPoints), 10_000n);
  const effectiveIcms = roundHalfUp(effectiveBase * BigInt(rule.internalRateBasisPoints), 10_000n);
  if (effectiveBase > BigInt(Number.MAX_SAFE_INTEGER) || effectiveIcms > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return { effectiveBaseCents: Number(effectiveBase), effectiveIcmsCents: Number(effectiveIcms) };
};

const emptyLine = (output: IcmsStOutputLine, reasons: readonly string[]): IcmsStSettlementLine => ({
  outputDocumentId: output.documentId, outputItemId: output.id, productId: output.productId,
  normalizedUnit: output.unit, quantityScaled: output.quantityScaled, recoveryOrigin: null,
  presumedBaseCents: null, effectiveBaseCents: null, inputIcmsCents: null, inputIcmsStCents: null,
  effectiveIcmsCents: null, differenceKind: 'INDETERMINATE', restitutionCents: null, complementCents: null,
  ruleId: output.ruleId, formulaVersion: null, sourceIds: [], recoveryDocumentIds: [], blockingReasonCodes: reasons,
});

type AllocatedRecovery = Readonly<{
  origin: IcmsStRecoveryOrigin;
  inputIcmsCents: number;
  inputIcmsStCents: number;
  presumedBaseCents: number;
  documentIds: readonly string[];
}>;

const centsByQuantity = (amount: number, part: bigint, total: bigint): number | null => {
  if (total <= 0n || part < 0n || part > total) return null;
  const value = roundHalfUp(BigInt(amount) * part, total);
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
};

const centsForAllocatedQuantity = (amount: number, already: bigint, part: bigint, total: bigint): number | null => {
  if (total <= 0n || already < 0n || part <= 0n || already + part > total) return null;
  const before = roundHalfUp(BigInt(amount) * already, total);
  const after = roundHalfUp(BigInt(amount) * (already + part), total);
  const value = after - before;
  return value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
};

const recoverForOutput = (
  output: IcmsStOutputLine,
  entries: readonly IcmsStInputEntry[],
  allocated: Map<string, bigint>,
): AllocatedRecovery | null => {
  if (output.productId === null || output.unit === null || output.quantityScaled === null || output.quantityScaled <= 0n) return null;
  const direct = entries.filter((entry) => entry.linkedOutputLineIds.includes(output.id));
  if (direct.length > 0) {
    if (direct.length !== 1) return null;
    const entry = direct[0];
    if (entry === undefined || !entry.corroborated || entry.productId !== output.productId || entry.unit !== output.unit ||
        !isCivilDate(entry.factDate) || entry.factDate > output.factDate ||
        entry.quantityScaled === null || entry.quantityScaled <= 0n || !safeCents(entry.inputIcmsCents) || !safeCents(entry.inputIcmsStCents) ||
        !safeCents(entry.presumedBaseCents)) return null;
    const already = allocated.get(entry.id) ?? 0n;
    const left = entry.quantityScaled - already;
    if (left < output.quantityScaled) return null;
    const icms = centsForAllocatedQuantity(entry.inputIcmsCents, already, output.quantityScaled, entry.quantityScaled);
    const icmsSt = centsForAllocatedQuantity(entry.inputIcmsStCents, already, output.quantityScaled, entry.quantityScaled);
    const base = centsForAllocatedQuantity(entry.presumedBaseCents, already, output.quantityScaled, entry.quantityScaled);
    if (icms === null || icmsSt === null || base === null) return null;
    allocated.set(entry.id, already + output.quantityScaled);
    return { origin: entry.efdRecordId !== null ? 'EFD_RECORDED' : 'DIRECT_DOCUMENT', inputIcmsCents: icms,
      inputIcmsStCents: icmsSt, presumedBaseCents: base, documentIds: [entry.documentId ?? entry.efdRecordId ?? entry.id] };
  }

  const month = output.factDate.slice(0, 7);
  const candidates = entries.filter((entry) => entry.companyId.length > 0 && entry.competence === month && isCivilDate(entry.factDate) && entry.factDate.startsWith(month) &&
    entry.productId === output.productId && entry.unit === output.unit && entry.corroborated &&
    entry.quantityScaled !== null && entry.quantityScaled > 0n && safeCents(entry.inputIcmsCents) && safeCents(entry.inputIcmsStCents));
  if (candidates.length === 0) return null;
  let quantity = 0n;
  let icmsNumerator = 0n;
  let icmsStNumerator = 0n;
  let baseNumerator = 0n;
  for (const entry of candidates) {
    if (entry.quantityScaled === null || !safeCents(entry.inputIcmsCents) || !safeCents(entry.inputIcmsStCents) || !safeCents(entry.presumedBaseCents)) return null;
    const already = allocated.get(entry.id) ?? 0n;
    const remaining = entry.quantityScaled - already;
    if (remaining <= 0n) continue;
    quantity += remaining;
    const remainingIcms = centsByQuantity(entry.inputIcmsCents, remaining, entry.quantityScaled);
    const remainingIcmsSt = centsByQuantity(entry.inputIcmsStCents, remaining, entry.quantityScaled);
    const remainingBase = centsByQuantity(entry.presumedBaseCents, remaining, entry.quantityScaled);
    if (remainingIcms === null || remainingIcmsSt === null || remainingBase === null) return null;
    icmsNumerator += BigInt(remainingIcms);
    icmsStNumerator += BigInt(remainingIcmsSt);
    baseNumerator += BigInt(remainingBase);
  }
  if (quantity < output.quantityScaled || quantity === 0n) return null;
  const icms = roundHalfUp(icmsNumerator * output.quantityScaled, quantity);
  const icmsSt = roundHalfUp(icmsStNumerator * output.quantityScaled, quantity);
  const base = roundHalfUp(baseNumerator * output.quantityScaled, quantity);
  if (icms > BigInt(Number.MAX_SAFE_INTEGER) || icmsSt > BigInt(Number.MAX_SAFE_INTEGER) || base > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  let remainingToAllocate = output.quantityScaled;
  for (const entry of candidates) {
    if (remainingToAllocate === 0n) break;
    const available = (entry.quantityScaled ?? 0n) - (allocated.get(entry.id) ?? 0n);
    const take = available < remainingToAllocate ? available : remainingToAllocate;
    if (take > 0n) allocated.set(entry.id, (allocated.get(entry.id) ?? 0n) + take);
    remainingToAllocate -= take;
  }
  return { origin: 'MONTHLY_WEIGHTED_AVERAGE', inputIcmsCents: Number(icms), inputIcmsStCents: Number(icmsSt), presumedBaseCents: Number(base),
    documentIds: candidates.map((entry) => entry.documentId ?? entry.efdRecordId ?? entry.id).sort() };
};

const resolveLine = (
  output: IcmsStOutputLine,
  entries: readonly IcmsStInputEntry[],
  rules: readonly IcmsStSettlementRule[],
  allocated: Map<string, bigint>,
): IcmsStSettlementLine => {
  try {
    if (lerDataCivil(output.factDate) !== output.factDate) return emptyLine(output, ['OUTPUT_FACT_DATE_INVALID']);
  } catch { return emptyLine(output, ['OUTPUT_FACT_DATE_INVALID']); }
  if (output.factDate < WINDOW_START || output.factDate > WINDOW_END) return emptyLine(output, ['OUTPUT_DATE_OUT_OF_SCOPE']);
  if ((output.documentModel !== '55' && output.documentModel !== '65') || !output.documentAuthorized) return emptyLine(output, ['OUTPUT_DOCUMENT_NOT_ELIGIBLE']);
  if (output.documentCanceled) return emptyLine(output, ['OUTPUT_DOCUMENT_CANCELLED']);
  if (output.canceledAfterSale === null) return emptyLine(output, ['OUTPUT_POST_SALE_EVENTS_UNVERIFIED']);
  if (output.canceledAfterSale) return emptyLine(output, ['OUTPUT_CANCELED_AFTER_SALE']);
  if (output.sellerUf !== 'GO') return emptyLine(output, ['COMPANY_SELLER_NOT_IN_GO']);
  if (output.documentModel === '65') {
    if (output.destinationIndicator === null || output.destinationIndicator === undefined ||
        output.finalConsumerIndicator === null || output.finalConsumerIndicator === undefined) return emptyLine(output, ['OUTPUT_INDICATOR_MISSING']);
    if (output.destinationIndicator !== '1' || output.finalConsumerIndicator !== '1' ||
        output.destinationUf !== null && output.destinationUf !== 'GO' || output.finalConsumer !== true) {
      return emptyLine(output, ['OUTPUT_INDICATOR_CONTRADICTORY']);
    }
  } else if (output.destinationUf !== 'GO' || output.finalConsumer !== true) return emptyLine(output, ['OUTPUT_OPERATION_NOT_COVERED']);
  if (output.regime === null || output.regime === undefined) return emptyLine(output, ['COMPANY_REGIME_UNSUPPORTED']);
  if (output.productId === null || output.ncm === null || output.cest === null || output.cfop === null || output.cstCsosn === null || output.unit === null ||
      output.quantityScaled === null || output.quantityScale !== 10 || output.quantityScaled <= 0n || !safeCents(output.outputBaseCents)) {
    return emptyLine(output, ['OUTPUT_ITEM_FACTS_INCOMPLETE']);
  }
  const candidates = rules.filter((rule) => rule.regime === output.regime && rule.ncm.includes(output.ncm ?? '') &&
    rule.cest.includes(output.cest ?? '') && rule.cfop.includes(output.cfop ?? '') && rule.cstCsosn.includes(output.cstCsosn ?? '') &&
    rule.validFrom <= output.factDate && output.factDate <= rule.validUntil);
  if (candidates.length !== 1) return emptyLine(output, [candidates.length === 0 ? 'NO_APPLICABLE_SETTLEMENT_RULE' : 'SETTLEMENT_RULE_AMBIGUOUS']);
  const rule = candidates[0];
  if (rule === undefined || rule.taxSegment !== 'AUTO_PARTS' || rule.legalDescription.trim() === '' || rule.destinationUf !== 'GO' || !rule.finalConsumer ||
      rule.rounding !== 'HALF_UP' || rule.effectiveBaseFactorBasisPoints === null || rule.internalRateBasisPoints === null || rule.effectiveBaseFormula.trim()==='' ||
      rule.effectiveIcmsFormula.trim()==='' || rule.sourceIds.length === 0 || rule.formulaVersion.trim() === '') {
    return emptyLine(output, ['SETTLEMENT_RULE_INCOMPLETE']);
  }
  const recovery = recoverForOutput(output, entries, allocated);
  if (recovery === null) return emptyLine(output, ['INPUT_RECOVERY_INDETERMINATE']);
  const outputTax = calculateIcmsStOutputTax(rule, output.outputBaseCents);
  if (outputTax === null) return emptyLine(output, ['OUTPUT_TAX_FORMULA_UNIMPLEMENTED']);
  const effectiveTax = BigInt(outputTax.effectiveIcmsCents);
  const inputTax = BigInt(recovery.inputIcmsCents) + BigInt(recovery.inputIcmsStCents);
  const delta = BigInt(Number(effectiveTax)) - inputTax;
  if (delta > BigInt(Number.MAX_SAFE_INTEGER) || delta < BigInt(Number.MIN_SAFE_INTEGER)) return emptyLine(output, ['SETTLEMENT_AMOUNT_OVERFLOW']);
  const differenceKind: IcmsStDifferenceKind = delta > 0n ? 'COMPLEMENT' : delta < 0n ? 'RESTITUTION' : 'NONE';
  return {
    outputDocumentId: output.documentId, outputItemId: output.id, productId: output.productId, normalizedUnit: output.unit,
    quantityScaled: output.quantityScaled, recoveryOrigin: recovery.origin, presumedBaseCents: recovery.presumedBaseCents,
    effectiveBaseCents: outputTax.effectiveBaseCents, inputIcmsCents: recovery.inputIcmsCents, inputIcmsStCents: recovery.inputIcmsStCents,
    effectiveIcmsCents: outputTax.effectiveIcmsCents, differenceKind, restitutionCents: delta < 0n ? Number(-delta) : 0,
    complementCents: delta > 0n ? Number(delta) : 0, ruleId: rule.id, formulaVersion: rule.formulaVersion,
    sourceIds: [...new Set(rule.sourceIds)].sort(), recoveryDocumentIds: recovery.documentIds,
    blockingReasonCodes: [],
  };
};

export const resolveIcmsStSettlement = (input: IcmsStSettlementInput): IcmsStMonthlySettlement => {
  const [year, month] = input.competence.split('-').map(Number);
  if (year === undefined || month === undefined || month < 1 || month > 12 || !/^\d{4}-\d{2}$/u.test(input.competence)) {
    return { competence: input.competence, regime: input.regime, status: 'BLOCKED', grossRestitutionCents: null,
      grossComplementCents: null, netAmountCents: null, lines: [], blockingReasonCodes: ['COMPETENCE_INVALID'] };
  }
  const allocated = new Map<string, bigint>();
  const outputs = input.outputs.filter((item) => item.factDate.startsWith(input.competence) &&
      item.factDate >= WINDOW_START && item.factDate <= WINDOW_END && !item.documentCanceled)
    .slice().sort((a, b) => a.id.localeCompare(b.id));
  const lines = outputs.map((output) => resolveLine(output, input.entries.filter((entry) => entry.companyId === input.companyId), input.rules, allocated));
  if (lines.length === 0 || lines.some((line) => line.differenceKind === 'INDETERMINATE')) {
    return { competence: input.competence, regime: input.regime, status: 'BLOCKED', grossRestitutionCents: null,
      grossComplementCents: null, netAmountCents: null, lines,
      blockingReasonCodes: lines.length === 0 ? ['COMPETENCE_WITHOUT_OUTPUT_LINES'] :
        [...new Set(lines.flatMap((line) => line.blockingReasonCodes))].sort() };
  }
  const restitution = lines.reduce((sum, line) => sum + BigInt(line.restitutionCents ?? 0), 0n);
  const complement = lines.reduce((sum, line) => sum + BigInt(line.complementCents ?? 0), 0n);
  const net = complement - restitution;
  if ([restitution, complement, net].some((value) => value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER))) {
    return { competence: input.competence, regime: input.regime, status: 'BLOCKED', grossRestitutionCents: null,
      grossComplementCents: null, netAmountCents: null, lines: lines.map((line) => ({ ...line, differenceKind: 'INDETERMINATE',
        restitutionCents: null, complementCents: null, blockingReasonCodes: ['MONTH_TOTAL_OVERFLOW'] })), blockingReasonCodes: ['MONTH_TOTAL_OVERFLOW'] };
  }
  return { competence: input.competence, regime: input.regime, status: 'PENDING_REVIEW', grossRestitutionCents: Number(restitution),
    grossComplementCents: Number(complement), netAmountCents: Number(net), lines, blockingReasonCodes: [] };
};
