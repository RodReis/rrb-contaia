import { requisitar } from '@/lib/http';
import { z } from 'zod';

const id = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu);
const competence = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/u);
const digest = z.string().regex(/^[0-9a-f]{64}$/u);
const assessment = z.object({
  assessmentId: id, competence, kind: z.enum(['SIMPLES_NACIONAL_DAS', 'LUCRO_PRESUMIDO_ICMS_DARE', 'LUCRO_PRESUMIDO_PIS_COFINS']),
  status: z.enum(['DRAFT', 'INCOMPLETE', 'INDETERMINATE', 'READY_FOR_REVIEW', 'APPROVED', 'REJECTED', 'POSSIBLY_OUTDATED', 'SUPERSEDED']),
  components: z.array(z.object({ code: z.string(), baseCents: z.number().int(), rateScaled: z.string().nullable(), amountCents: z.number().int().nullable(),
    grossAmountCents: z.number().int().nullable().optional(), transitionOffsetCents: z.number().int().nullable().optional(),
    netAmountCents: z.number().int().nullable().optional(), ruleId: z.string(), sourceIds: z.array(z.string()) })),
  totalCents: z.number().int().nullable(), pisPayableCents: z.number().int().nullable().optional(),
  cofinsPayableCents: z.number().int().nullable().optional(), revenueRecognition: z.enum(['ACCRUAL', 'CASH']).nullable().optional(),
  transitionPackageVersion: z.string().nullable().optional(), unallocatedTransitionOffsetCents: z.number().int().nullable().optional(),
  gapCodes: z.array(z.string()), canonicalJsonHash: digest,
}).passthrough();
export type MonthlyAssessment = z.infer<typeof assessment>;

export const listarApuracoesMensais = async (companyId: string, competenceValue: string, kind?: MonthlyAssessment['kind']) => {
  const query = new URLSearchParams({ page: '1', pageSize: '50' });
  if (competenceValue) query.set('competence', competenceValue);
  if (kind) query.set('kind', kind);
  const result = z.object({ items: z.array(assessment) }).parse(await requisitar<unknown>(`/companies/${companyId}/fiscal-documents/monthly-assessments/history?${query}`));
  return result.items;
};

export const prepararApuracaoMensal = async (companyId: string, input: Readonly<{ competence: string; kind: MonthlyAssessment['kind']; rulePackageId: string; transitionPackageId?: string | null }>) =>
  assessment.parse(await requisitar<unknown>(`/companies/${companyId}/fiscal-documents/monthly-assessments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) }));

export const obterApuracaoMensal = async (companyId: string, assessmentId: string) =>
  assessment.parse(await requisitar<unknown>(`/companies/${companyId}/fiscal-documents/monthly-assessments/${assessmentId}`));

export const revisarApuracaoMensal = async (companyId: string, current: MonthlyAssessment, action: 'APPROVED' | 'REJECTED' | 'RETURNED_FOR_EVIDENCE', reason: string) =>
  assessment.parse(await requisitar<unknown>(`/companies/${companyId}/fiscal-documents/monthly-assessments/${current.assessmentId}/review`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, reason, expectedHash: current.canonicalJsonHash }),
  }));

export const importarPacoteMensal = async (companyId: string, pack: Readonly<Record<string, unknown>>, source: File) => {
  const form = new FormData(); form.set('package', JSON.stringify(pack)); form.set('source', source, source.name);
  return requisitar<unknown>(`/companies/${companyId}/fiscal-documents/monthly-assessments/rule-packages`, { method: 'POST', body: form });
};

export const listarPacotesMensais = async (companyId: string, kind: MonthlyAssessment['kind'] | 'PIS_COFINS_TRANSITION_2026') => {
  const result = z.object({ items: z.array(z.object({ id, kind: z.string(), version: z.string(), valid_from: z.string(), valid_through: z.string().nullable(),
    official_basis: z.string(), source_url: z.string(), source_sha256: digest, content_sha256: digest, canonical_json: z.unknown(), status: z.string() })) })
    .parse(await requisitar<unknown>(`/companies/${companyId}/fiscal-documents/monthly-assessments/rule-packages?kind=${kind}`));
  return result.items;
};

export const decidirPacoteMensal = async (companyId: string, packageId: string, action: 'APPROVED' | 'REJECTED', reason: string) =>
  requisitar<unknown>(`/companies/${companyId}/fiscal-documents/monthly-assessments/rule-packages/${packageId}/review`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, reason }),
  });

export const declararApuracaoMensal = async (companyId: string, declaration: Readonly<Record<string, unknown>>, files: readonly File[]) => {
  const form = new FormData(); form.set('declaration', JSON.stringify(declaration)); files.forEach((file) => form.append('evidence', file, file.name));
  return requisitar<unknown>(`/companies/${companyId}/fiscal-documents/monthly-assessments/declarations`, { method: 'POST', body: form });
};

export const declararApuracaoSimples = async (companyId: string, value: Readonly<{ competence: string; justification: string; declaration: Record<string, unknown>; file: File }>) =>
  declararApuracaoMensal(companyId, { competence: value.competence, kind: 'SIMPLES_NACIONAL_DAS', justification: value.justification,
    declaration: value.declaration, evidence: [{ kind: 'DOCUMENTO_CONTABIL', description: value.justification }] }, [value.file]);

export const declararApuracaoIcms = async (companyId: string, value: Readonly<{ competence: string; justification: string; declaration: Record<string, unknown>; file: File }>) =>
  declararApuracaoMensal(companyId, { competence: value.competence, kind: 'LUCRO_PRESUMIDO_ICMS_DARE', justification: value.justification,
    declaration: value.declaration, evidence: [{ kind: 'DOCUMENTO_CONTABIL', description: value.justification }] }, [value.file]);

export const baixarRelatorioApuracao = async (companyId: string, assessmentId: string, expectedHash: string,
  format: 'PDF' | 'CSV' | 'JSON' | 'PIS_DARF_DRAFT' | 'COFINS_DARF_DRAFT') => {
  const response = await fetch(`/api/proxy/companies/${companyId}/fiscal-documents/monthly-assessments/${assessmentId}/export?format=${format}`, { credentials: 'include' });
  if (!response.ok) throw new Error('Não foi possível exportar a apuração.');
  if (response.headers.get('X-Canonical-JSON-SHA256') !== expectedHash) throw new Error('Hash canônico do arquivo diverge da revisão exibida.');
  const blob = await response.blob();
  const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url;
  const extension = format === 'JSON' ? 'json' : format === 'CSV' ? 'csv' : 'pdf';
  anchor.download = `apuracao-fiscal-${assessmentId}-${format.toLowerCase()}.${extension}`;
  anchor.click(); URL.revokeObjectURL(url);
};
