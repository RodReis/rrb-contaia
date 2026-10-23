export type HistoricalIcmsStRegime = 'SIMPLES_NACIONAL' | 'LUCRO_PRESUMIDO';
export type HistoricalIcmsStPackageStatus = 'READY_FOR_INTERNAL_REVIEW' | 'POSSIBLY_OUTDATED' | 'BLOQUEADO_POR_ACRESCIMOS_LEGAIS';

export type HistoricalIcmsStLineMemory = Readonly<{
  ruleId: string;
  formulaVersion: string;
  inputSha256: string;
}>;

export type HistoricalIcmsStSourceLine = Readonly<{
  id: string;
  documentId: string;
  itemId: string;
  documentSha256: string;
  documentDate: string;
  documentModel: '55' | '65';
  accessKey: string;
  productCode: string | null;
  competence: string;
  differenceKind: 'RESTITUTION' | 'COMPLEMENT' | 'NONE' | 'INDETERMINATE';
  restitutionCents: number | null;
  complementCents: number | null;
  sourceIds: readonly string[];
  memory: HistoricalIcmsStLineMemory | null;
  efdRecordCode: string | null;
}>;

export type HistoricalIcmsStSourceSnapshot = Readonly<{
  id: string;
  revision: number;
  competence: string;
  regime: HistoricalIcmsStRegime;
  status: 'APPROVED' | 'PENDING_REVIEW' | 'REJECTED' | 'BLOCKED';
  stale: boolean;
  superseded: boolean;
  possibleOutdated: boolean;
  grossRestitutionCents: number | null;
  grossComplementCents: number | null;
  lines: readonly HistoricalIcmsStSourceLine[];
}>;

export type HistoricalIcmsStUnresolvedEvidence = Readonly<{
  id: string;
  competence: string;
  sourceKind: 'UNREVIEWED_RETURN' | 'AUTHORIZED_CANCELLATION' | 'DOCUMENT_SET_CHANGED';
}>;

export type HistoricalIcmsStApprovedReversal = Readonly<{
  id: string;
  competence: string;
  originalSnapshotId: string;
  originalLineId: string;
  originalLineVerified: boolean;
  eventDate: string;
  reversedRestitutionCents: number;
  reversedComplementCents: number;
  evidenceSha256: string;
  c002SnapshotId: string;
  sourceIds: readonly string[];
  reviewApproved: boolean;
  c002SnapshotApproved: boolean;
  c002SnapshotStale: boolean;
  memory: HistoricalIcmsStLineMemory | null;
}>;

export type HistoricalIcmsStPackageInput = Readonly<{
  companyId: string;
  regime: HistoricalIcmsStRegime;
  periodStart: string;
  periodEnd: string;
  snapshots: readonly HistoricalIcmsStSourceSnapshot[];
  reversals: readonly HistoricalIcmsStApprovedReversal[];
  unresolvedEvidence?: readonly HistoricalIcmsStUnresolvedEvidence[];
}>;

export type HistoricalIcmsStPackageLine = Readonly<{
  sourceKind: 'APPROVED_SETTLEMENT' | 'APPROVED_RETURN_REVERSAL';
  sourceRevisionId: string;
  sourceLineId: string;
  competence: string;
  eventDate: string | null;
  regime: HistoricalIcmsStRegime;
  documentId: string | null;
  itemId: string | null;
  documentModel: '55' | '65' | null;
  accessKey: string | null;
  productCode: string | null;
  sourceIds: readonly string[];
  sourceMemory: HistoricalIcmsStLineMemory;
  documentSha256: string | null;
  restitutionPrincipalCents: number;
  complementPrincipalCents: number;
  efdRecordCode: string | null;
}>;

export type HistoricalIcmsStExcludedCompetence = Readonly<{
  competence: string;
  reasonCodes: readonly string[];
}>;

export type HistoricalIcmsStRegimeOutput =
  | Readonly<{
      kind: 'LUCRO_PRESUMIDO';
      efdAdjustmentDrafts: readonly Readonly<{ sourceLineId: string; recordCode: string }>[];
    }>
  | Readonly<{
      kind: 'SIMPLES_NACIONAL';
      carriedBalanceCents: null;
      possibleDestinations: readonly ['SALDO_TRANSPORTADO', 'RESSARCIMENTO_AO_SUBSTITUTO', 'COMPENSACAO_NO_DAS', 'PEDIDO_DE_RESTITUICAO'];
    }>;

export type HistoricalIcmsStPackage = Readonly<{
  companyId: string;
  regime: HistoricalIcmsStRegime;
  periodStart: string;
  periodEnd: string;
  sourceRevisionIds: readonly string[];
  excludedCompetences: readonly HistoricalIcmsStExcludedCompetence[];
  periodComplete: boolean;
  status: HistoricalIcmsStPackageStatus;
  blockingReasonCodes: readonly string[];
  unresolvedEvidence: readonly HistoricalIcmsStUnresolvedEvidence[];
  lines: readonly HistoricalIcmsStPackageLine[];
  grossRestitutionCents: number;
  grossComplementCents: number;
  reversedRestitutionCents: number;
  reversedComplementCents: number;
  netRestitutionPrincipalCents: number;
  netComplementPrincipalCents: number;
  netPrincipalBalanceCents: number;
  regimeOutput: HistoricalIcmsStRegimeOutput;
  canonicalJson: string;
}>;

const HISTORICAL_PERIOD_START = '2016-10';
const HISTORICAL_PERIOD_END = '2018-02';
const LEGAL_ACCRUALS_REQUIRED = 'F34_LEGAL_ACCRUALS_REQUIRED';

const isMonth = (value: string): boolean => /^\d{4}-(0[1-9]|1[0-2])$/u.test(value);
const isCents = (value: number | null): value is number => value !== null && Number.isSafeInteger(value) && value >= 0;
const isSha256 = (value: string): boolean => /^[0-9a-f]{64}$/u.test(value);
const isHistoricalFactDate = (value: string): boolean => value >= '2016-10-27' && value <= '2018-02-28';
const isMemory = (value: HistoricalIcmsStLineMemory | null): value is HistoricalIcmsStLineMemory => value !== null &&
  value.ruleId.trim().length > 0 && value.formulaVersion.trim().length > 0 && isSha256(value.inputSha256);
const eligibleReversal = (reversal: HistoricalIcmsStApprovedReversal): boolean => reversal.reviewApproved && reversal.c002SnapshotApproved &&
  !reversal.c002SnapshotStale && reversal.originalLineVerified && reversal.originalSnapshotId.trim() !== '' && reversal.originalLineId.trim() !== '' &&
  isCents(reversal.reversedRestitutionCents) && isCents(reversal.reversedComplementCents) && isSha256(reversal.evidenceSha256) &&
  isMemory(reversal.memory) && reversal.c002SnapshotId.trim() !== '' && reversal.sourceIds.length > 0;

const competenceMonth = (value: string): string => {
  if (!/^\d{4}-\d{2}-01$/u.test(value)) throw new Error('competência histórica inválida');
  return value.slice(0, 7);
};

const listMonths = (start: string, end: string): readonly string[] => {
  if (!isMonth(start) || !isMonth(end) || start < HISTORICAL_PERIOD_START || end > HISTORICAL_PERIOD_END || start > end) {
    throw new Error('período fora da cobertura histórica F33');
  }
  const result: string[] = [];
  let year = Number(start.slice(0, 4));
  let month = Number(start.slice(5, 7));
  const finalYear = Number(end.slice(0, 4));
  const finalMonth = Number(end.slice(5, 7));
  while (year < finalYear || (year === finalYear && month <= finalMonth)) {
    result.push(`${year}-${String(month).padStart(2, '0')}`);
    month += 1;
    if (month === 13) { year += 1; month = 1; }
  }
  return result;
};

const isLineComplete = (line: HistoricalIcmsStSourceLine): boolean => line.id.trim().length > 0 && line.documentId.trim().length > 0 &&
  line.itemId.trim().length > 0 && (line.documentModel === '55' || line.documentModel === '65') && /^\d{44}$/u.test(line.accessKey) &&
  isMemory(line.memory) && isSha256(line.documentSha256) && isHistoricalFactDate(line.documentDate) && line.sourceIds.length > 0 && line.competence === `${competenceMonth(line.competence)}-01` &&
  (line.differenceKind === 'INDETERMINATE' || (isCents(line.restitutionCents) && isCents(line.complementCents)));

const eligibleSnapshot = (snapshot: HistoricalIcmsStSourceSnapshot): boolean => snapshot.status === 'APPROVED' && !snapshot.stale &&
  !snapshot.superseded && Number.isInteger(snapshot.revision) && snapshot.revision > 0 && competenceMonth(snapshot.competence) !== '' &&
  isCents(snapshot.grossRestitutionCents) && isCents(snapshot.grossComplementCents) && snapshot.lines.length > 0 &&
  snapshot.lines.every((line) => line.differenceKind !== 'INDETERMINATE' && isLineComplete(line)) &&
  sum(snapshot.lines.map((line) => line.restitutionCents!)) === snapshot.grossRestitutionCents &&
  sum(snapshot.lines.map((line) => line.complementCents!)) === snapshot.grossComplementCents;

const sum = (values: readonly number[]): number => {
  const total = values.reduce((result, value) => result + value, 0);
  if (!Number.isSafeInteger(total) || total < 0) throw new Error('total histórico excede o intervalo inteiro seguro');
  return total;
};

export const buildHistoricalIcmsStPackage = (input: HistoricalIcmsStPackageInput): HistoricalIcmsStPackage => {
  if (input.companyId.trim() === '') throw new Error('empresa obrigatória');
  for (const snapshot of input.snapshots) {
    for (const amount of [snapshot.grossRestitutionCents, snapshot.grossComplementCents,
      ...snapshot.lines.flatMap((line) => [line.restitutionCents, line.complementCents])]) {
      if (amount !== null && !isCents(amount)) throw new Error('valor de principal fora do intervalo inteiro seguro');
    }
  }
  for (const reversal of input.reversals) {
    if (!isCents(reversal.reversedRestitutionCents) || !isCents(reversal.reversedComplementCents)) {
      throw new Error('valor de estorno fora do intervalo inteiro seguro');
    }
  }
  const months = listMonths(input.periodStart, input.periodEnd);
  const inPeriod = new Set(months);
  const candidates = input.snapshots.filter((snapshot) => snapshot.regime === input.regime && inPeriod.has(competenceMonth(snapshot.competence)))
    .sort((left, right) => left.competence.localeCompare(right.competence) || right.revision - left.revision || left.id.localeCompare(right.id));
  const approvedReversalCompetences = new Set(input.reversals.filter(eligibleReversal).map((reversal) => competenceMonth(reversal.competence)));
  const latestByMonth = new Map<string, HistoricalIcmsStSourceSnapshot>();
  const latestSeenByMonth = new Map<string, HistoricalIcmsStSourceSnapshot>();
  for (const candidate of candidates) {
    const month = competenceMonth(candidate.competence);
    if (!latestSeenByMonth.has(month)) latestSeenByMonth.set(month, candidate);
    if (candidate.status === 'APPROVED' && !candidate.superseded && !latestByMonth.has(month)) latestByMonth.set(month, candidate);
  }

  const selected = new Map<string, HistoricalIcmsStSourceSnapshot>();
  const excluded: HistoricalIcmsStExcludedCompetence[] = [];
  for (const month of months) {
    const candidate = latestByMonth.get(month);
    const latestSeen = latestSeenByMonth.get(month);
    if (candidate === undefined && approvedReversalCompetences.has(month)) continue;
    if (candidate === undefined || !eligibleSnapshot(candidate)) {
      const reasonCodes = latestSeen === undefined ? ['NO_APPROVED_REVISION']
        : latestSeen.status !== 'APPROVED' ? ['SOURCE_REVISION_NOT_APPROVED']
          : candidate === undefined || candidate.stale || candidate.superseded ? ['SOURCE_REVISION_STALE'] : ['SOURCE_MEMORY_MISSING'];
      excluded.push({ competence: month, reasonCodes });
    } else {
      selected.set(month, candidate);
    }
  }

  const sourceLines: HistoricalIcmsStPackageLine[] = [...selected.values()].flatMap((snapshot) => snapshot.lines.map((line) => ({
    sourceKind: 'APPROVED_SETTLEMENT' as const, sourceRevisionId: snapshot.id, sourceLineId: line.id, competence: competenceMonth(line.competence),
    eventDate: null, regime: snapshot.regime, documentId: line.documentId, itemId: line.itemId, documentModel: line.documentModel,
    accessKey: line.accessKey, productCode: line.productCode, sourceIds: [...line.sourceIds].sort(), sourceMemory: line.memory!, documentSha256: line.documentSha256,
    restitutionPrincipalCents: line.restitutionCents!, complementPrincipalCents: line.complementCents!, efdRecordCode: line.efdRecordCode,
  })));
  let unresolvedApprovedData = [...selected.values()].some((snapshot) => snapshot.possibleOutdated);
  const unresolvedEvidence: HistoricalIcmsStUnresolvedEvidence[] = (input.unresolvedEvidence ?? []).filter((evidence) => inPeriod.has(competenceMonth(evidence.competence)))
    .sort((left, right) => left.competence.localeCompare(right.competence) || left.sourceKind.localeCompare(right.sourceKind) || left.id.localeCompare(right.id));
  unresolvedApprovedData ||= unresolvedEvidence.length > 0;
  const reversalLines: HistoricalIcmsStPackageLine[] = [];
  for (const reversal of input.reversals.filter((candidate) => inPeriod.has(competenceMonth(candidate.competence)))) {
    if (!reversal.reviewApproved || !reversal.c002SnapshotApproved || reversal.c002SnapshotStale) {
      unresolvedApprovedData = true;
      if (reversal.c002SnapshotStale &&
        !unresolvedEvidence.some((evidence) => evidence.id === reversal.id && evidence.sourceKind === 'UNREVIEWED_RETURN')) {
        unresolvedEvidence.push({ id: reversal.id, competence: reversal.competence, sourceKind: 'UNREVIEWED_RETURN' });
      }
      continue;
    }
    if (!eligibleReversal(reversal)) {
      excluded.push({ competence: competenceMonth(reversal.competence), reasonCodes: ['RETURN_SOURCE_MEMORY_MISSING'] });
      continue;
    }
    reversalLines.push({ sourceKind: 'APPROVED_RETURN_REVERSAL', sourceRevisionId: reversal.c002SnapshotId, sourceLineId: reversal.originalLineId,
      competence: competenceMonth(reversal.competence), eventDate: reversal.eventDate, regime: input.regime, documentId: null, itemId: null,
      documentModel: null, accessKey: null, productCode: null, sourceIds: [...new Set([...reversal.sourceIds, reversal.evidenceSha256])].sort(), sourceMemory: reversal.memory!, documentSha256: null,
      restitutionPrincipalCents: reversal.reversedRestitutionCents, complementPrincipalCents: reversal.reversedComplementCents, efdRecordCode: null });
  }

  const lines = [...sourceLines, ...reversalLines].sort((left, right) => left.competence.localeCompare(right.competence) ||
    left.sourceKind.localeCompare(right.sourceKind) || left.sourceRevisionId.localeCompare(right.sourceRevisionId) || left.sourceLineId.localeCompare(right.sourceLineId));
  excluded.push(...unresolvedEvidence.map((evidence) => ({ competence: competenceMonth(evidence.competence),
    reasonCodes: [evidence.sourceKind === 'UNREVIEWED_RETURN' ? 'UNREVIEWED_POST_SALE_EVENT' : 'POST_SALE_SOURCE_CHANGED'] })));
  const allExcluded = excluded.sort((left, right) => left.competence.localeCompare(right.competence) || left.reasonCodes.join().localeCompare(right.reasonCodes.join()));
  const grossRestitutionCents = sum(sourceLines.map((line) => line.restitutionPrincipalCents));
  const grossComplementCents = sum(sourceLines.map((line) => line.complementPrincipalCents));
  const reversedRestitutionCents = sum(reversalLines.map((line) => line.restitutionPrincipalCents));
  const reversedComplementCents = sum(reversalLines.map((line) => line.complementPrincipalCents));
  const netRestitutionPrincipalCents = grossRestitutionCents - reversedRestitutionCents;
  const netComplementPrincipalCents = grossComplementCents - reversedComplementCents;
  const reversalSources = input.reversals.filter((reversal) => reversalLines.some((line) =>
    line.sourceRevisionId === reversal.c002SnapshotId && line.sourceLineId === reversal.originalLineId));
  const sourceRevisionIds = [...new Set([...selected.values()].map((snapshot) => snapshot.id)
    .concat(reversalSources.flatMap((reversal) => [reversal.originalSnapshotId, reversal.c002SnapshotId])))].sort();
  const periodComplete = allExcluded.length === 0;
  const status: HistoricalIcmsStPackageStatus = unresolvedApprovedData ? 'POSSIBLY_OUTDATED' : 'BLOQUEADO_POR_ACRESCIMOS_LEGAIS';
  const regimeOutput: HistoricalIcmsStRegimeOutput = input.regime === 'LUCRO_PRESUMIDO'
    ? { kind: 'LUCRO_PRESUMIDO', efdAdjustmentDrafts: lines.filter((line) => line.efdRecordCode !== null)
      .map((line) => ({ sourceLineId: line.sourceLineId, recordCode: line.efdRecordCode! })).sort((left, right) => left.sourceLineId.localeCompare(right.sourceLineId)) }
    : { kind: 'SIMPLES_NACIONAL', carriedBalanceCents: null,
      possibleDestinations: ['SALDO_TRANSPORTADO', 'RESSARCIMENTO_AO_SUBSTITUTO', 'COMPENSACAO_NO_DAS', 'PEDIDO_DE_RESTITUICAO'] };

  const canonical = { companyId: input.companyId, regime: input.regime, periodStart: input.periodStart, periodEnd: input.periodEnd,
    sourceRevisionIds, excludedCompetences: allExcluded, periodComplete, status, blockingReasonCodes: [...new Set([LEGAL_ACCRUALS_REQUIRED,
      ...(unresolvedEvidence.length > 0 ? ['F32_REVIEW_REQUIRED'] : [])])].sort(), unresolvedEvidence, lines,
    grossRestitutionCents, grossComplementCents, reversedRestitutionCents, reversedComplementCents, netRestitutionPrincipalCents,
    netComplementPrincipalCents, netPrincipalBalanceCents: netRestitutionPrincipalCents - netComplementPrincipalCents, regimeOutput };
  return { ...canonical, canonicalJson: JSON.stringify(canonical) };
};
