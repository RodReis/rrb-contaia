import type { CuratedTaxPackage } from './package.js';

export type EntryTaxFacts = Readonly<{
  factDate: string | null;
  regime: string | null;
  originUf: string | null;
  destinationUf: string | null;
  documentModel: string;
  authorized: boolean;
  operationType: 'COMPRA_INTERNA_REVENDA' | 'COMPRA_INTERESTADUAL_REVENDA' | null;
  purpose: string | null;
  cfop: string | null;
  ncm: string | null;
  cest?: string | null | undefined;
  cst: string | null;
  hasSubstitutionTax: boolean | null;
  isImport: boolean | null;
  isMonophase: boolean | null;
  hasUnmodeledBenefit: boolean | null;
  isReturnOrTransfer: boolean | null;
  declaredCents: number | null;
}>;

export type EntryTaxDecision = Readonly<{
  status: 'APPLICABLE' | 'NOT_APPLICABLE' | 'INDETERMINATE';
  creditEligibility: 'ALLOWED' | 'BLOCKED' | 'INDETERMINATE' | 'NOT_RELEVANT';
  reasonCodes: readonly string[];
  packageId: string | null;
  packageHash: string | null;
  ruleId: string | null;
  sourceIds: readonly string[];
  declaredCents: number | null;
  rationale: string;
}>;

export const statusSubstituicaoTributariaComEvidencia = (
  tributos: readonly Readonly<{ codigo: string }>[],
): boolean | null => tributos.some((tributo) => tributo.codigo === 'ICMS_ST') ? true : null;

const blockedReasons = (facts: EntryTaxFacts, taxType: 'ICMS' | 'PIS' | 'COFINS' | 'IBS_UF' | 'IBS_MUN' | 'CBS', pkg: CuratedTaxPackage | null): string[] => [
  ...(facts.factDate === null ? ['FACT_DATE_MISSING'] : []),
  ...(facts.regime === null ? ['REGIME_HISTORY_UNAVAILABLE'] : []),
  ...(facts.originUf === null ? ['ORIGIN_UF_MISSING'] : []),
  ...(facts.destinationUf === null ? ['DESTINATION_UF_MISSING'] : []),
  ...(facts.documentModel !== '55' ? ['DOCUMENT_MODEL_UNSUPPORTED'] : []),
  ...(!facts.authorized ? ['DOCUMENT_NOT_AUTHORIZED'] : []),
  ...(facts.destinationUf !== 'GO' ? ['DESTINATION_OUTSIDE_GO'] : []),
  ...(facts.regime !== null && !['SIMPLES_NACIONAL', 'LUCRO_PRESUMIDO'].includes(facts.regime) ? ['TAX_REGIME_UNSUPPORTED'] : []),
  ...(facts.purpose === null ? ['PURPOSE_MISSING'] : []),
  ...(facts.purpose !== 'RESALE' ? ['PURPOSE_OUTSIDE_COVERAGE'] : []),
  ...(facts.operationType === null ? ['OPERATION_TYPE_UNAVAILABLE'] : []),
  ...(facts.hasSubstitutionTax === null ? ['SUBSTITUTION_TAX_STATUS_UNAVAILABLE'] : []),
  ...(facts.hasSubstitutionTax && (taxType !== 'ICMS' || !pkg?.rules.some((rule) => rule.taxType === 'ICMS' && (rule.cest?.length ?? 0) > 0)) ? ['SUBSTITUTION_TAX_OUTSIDE_COVERAGE'] : []),
  ...(facts.hasSubstitutionTax && taxType === 'ICMS' && facts.cest === null ? ['TAX_ST_CEST_MISSING'] : []),
  ...(facts.isImport === null ? ['IMPORT_STATUS_UNAVAILABLE'] : []),
  ...(facts.isImport ? ['IMPORT_OUTSIDE_COVERAGE'] : []),
  ...(facts.isMonophase === null ? ['MONOPHASE_STATUS_UNAVAILABLE'] : []),
  ...(facts.isMonophase ? ['MONOPHASE_OUTSIDE_COVERAGE'] : []),
  ...(facts.hasUnmodeledBenefit === null ? ['BENEFIT_STATUS_UNAVAILABLE'] : []),
  ...(facts.hasUnmodeledBenefit ? ['UNMODELED_BENEFIT'] : []),
  ...(facts.isReturnOrTransfer === null ? ['RETURN_TRANSFER_STATUS_UNAVAILABLE'] : []),
  ...(facts.isReturnOrTransfer ? ['RETURN_OR_TRANSFER_OUTSIDE_COVERAGE'] : []),
  ...(facts.cfop === null ? ['CFOP_MISSING'] : []),
  ...(facts.ncm === null ? ['NCM_MISSING'] : []),
  ...(facts.cst === null ? ['CST_OR_CSOSN_MISSING'] : []),
];

export const resolveEntryTax = (
  pkg: CuratedTaxPackage | null,
  facts: EntryTaxFacts,
  taxType: 'ICMS' | 'PIS' | 'COFINS' | 'IBS_UF' | 'IBS_MUN' | 'CBS',
  packageHash: string | null,
): EntryTaxDecision => {
  const reasons = blockedReasons(facts, taxType, pkg);
  if (pkg === null) reasons.push('PACKAGE_UNAVAILABLE');
  else if (facts.regime !== null && !pkg.regimes.includes(facts.regime as 'SIMPLES_NACIONAL' | 'LUCRO_PRESUMIDO')) reasons.push('PACKAGE_REGIME_NOT_COVERED');
  else if (facts.factDate !== null && !(pkg.validFrom <= facts.factDate && (pkg.validUntil === null || facts.factDate <= pkg.validUntil))) reasons.push('PACKAGE_NOT_VALID_ON_FACT_DATE');

  if (reasons.length > 0 || pkg === null) {
    return {
      status: 'INDETERMINATE', creditEligibility: 'INDETERMINATE', reasonCodes: reasons,
      packageId: pkg?.packageId ?? null, packageHash, ruleId: null, sourceIds: [],
      declaredCents: facts.declaredCents, rationale: 'Cobertura, dados ou pacote insuficientes; nenhuma regra genérica foi aplicada.',
    };
  }

  const candidates = pkg.rules.filter((rule) => rule.taxType === taxType && rule.regime === facts.regime &&
    rule.operationType === facts.operationType && rule.cfop.includes(facts.cfop ?? '') &&
    rule.ncm.includes(facts.ncm ?? '') && rule.cst.includes(facts.cst ?? '') &&
    (taxType !== 'ICMS' || (rule.cest === undefined && !facts.hasSubstitutionTax) || rule.cest?.includes(facts.cest ?? '') === true) &&
    facts.factDate !== null && rule.validFrom <= facts.factDate && (rule.validUntil === null || facts.factDate <= rule.validUntil));

  if (candidates.length !== 1) {
    return {
      status: 'INDETERMINATE', creditEligibility: 'INDETERMINATE',
      reasonCodes: [candidates.length === 0 ? 'NO_APPLICABLE_RULE' : 'AMBIGUOUS_RULES'],
      packageId: pkg.packageId, packageHash, ruleId: null, sourceIds: [], declaredCents: facts.declaredCents,
      rationale: candidates.length === 0 ? 'Pacote sem regra para os fatos informados.' : 'Mais de uma regra coincide; resolução bloqueada.',
    };
  }

  const rule = candidates[0];
  if (rule === undefined) throw new Error('candidato tributário único ausente');
  return {
    status: rule.treatment, creditEligibility: rule.creditEligibility, reasonCodes: [],
    packageId: pkg.packageId, packageHash, ruleId: rule.id, sourceIds: rule.sourceIds,
    declaredCents: facts.declaredCents, rationale: rule.rationale,
  };
};
