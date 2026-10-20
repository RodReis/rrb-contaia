export type IcmsStEvidence = Readonly<{
  cest: string | null;
  ncm: string | null;
  taxableBaseCents: number | null;
  rateBasisPoints: number | null;
  retainedAmountCents: number | null;
}>;

/** Presence/absence evidence only; this helper does not decide tax liability. */
export const statusRetencaoIcmsDeclarada = (
  tributos: readonly Readonly<{ codigo: string; situacao?: string | null; valor?: string | null }>[],
): boolean | null => {
  if (tributos.some((item) => item.codigo === 'ICMS_ST' && item.valor !== null && item.valor !== undefined)) return true;
  if (tributos.some((item) => item.codigo === 'ICMS' && item.situacao !== null && item.situacao !== undefined)) return false;
  return null;
};

export type IcmsStDeclaredCheck = Readonly<{
  code: string;
  status: 'VALID' | 'INVALID' | 'NOT_CHECKED';
  fields: readonly string[];
  reasons: readonly string[];
}>;

export const validateIcmsStDeclaredEvidence = (
  evidence: IcmsStEvidence,
  itemRetainedCents: number,
  documentRetainedCents: number | null,
): readonly IcmsStDeclaredCheck[] => {
  const itemTotalMatches = documentRetainedCents === null ? null : itemRetainedCents === documentRetainedCents;
  return [
    { code: 'TAX_ST_CEST_PRESENT', status: evidence.cest ? 'VALID' : 'INVALID', fields: ['CEST'], reasons: evidence.cest ? [] : ['TAX_ST_CEST_MISSING'] },
    { code: 'TAX_ST_NCM_PRESENT', status: evidence.ncm ? 'VALID' : 'INVALID', fields: ['NCM'], reasons: evidence.ncm ? [] : ['TAX_ST_NCM_MISSING'] },
    { code: 'TAX_ST_DECLARED_VALUE_PRESENT', status: evidence.retainedAmountCents !== null ? 'VALID' : 'INVALID', fields: ['vICMSST'], reasons: evidence.retainedAmountCents !== null ? [] : ['TAX_ST_DECLARED_FIELD_MISSING'] },
    { code: 'TAX_ST_DOCUMENT_TOTAL_MATCH', status: itemTotalMatches === null ? 'NOT_CHECKED' : itemTotalMatches ? 'VALID' : 'INVALID', fields: ['vICMSST', 'total.vST'], reasons: itemTotalMatches === null ? ['TAX_ST_DOCUMENT_TOTAL_UNAVAILABLE'] : itemTotalMatches ? [] : ['TAX_ST_DOCUMENT_TOTAL_MISMATCH'] },
  ];
};

export const decimalDeclaradoParaCentavos = (value: string | null): number | null => {
  if (value === null) return null;
  const match = /^(\d+)(?:\.(\d{1,2}))?$/u.exec(value);
  if (!match) return null;
  const cents = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : null;
};
