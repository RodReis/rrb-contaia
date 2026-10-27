import { z } from 'zod';
import { CorporateTaxAssessmentSchema } from '@contaia/shared';
import { requisitar } from '@/lib/http';

const id = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu);
const digest = z.string().regex(/^[0-9a-f]{64}$/u);
const root = (companyId: string) => `/companies/${companyId}/fiscal-documents/corporate-tax-assessments`;
export type CorporateTaxAssessment = z.infer<typeof CorporateTaxAssessmentSchema>;

export const listarPacotesCorporativos = async (companyId: string) => z.array(z.object({
  id, version: z.string(), valid_from: z.string(), valid_through: z.string().nullable(), consulted_at: z.string(), official_basis: z.string(),
  source_url: z.string().url(), source_sha256: digest, content_sha256: digest, canonical_json: z.unknown(), status: z.string(),
})).parse(await requisitar<unknown>(`${root(companyId)}/rule-packages`));

export const importarPacoteCorporativo = async (companyId: string, content: unknown, file: File) => {
  const form = new FormData(); form.set('package', JSON.stringify(content)); form.set('source', file, file.name);
  return requisitar<unknown>(`${root(companyId)}/rule-packages`, { method: 'POST', body: form });
};

export const revisarPacoteCorporativo = async (companyId: string, packageId: string, action: 'APPROVED' | 'REJECTED', reason: string) =>
  requisitar<unknown>(`${root(companyId)}/rule-packages/${packageId}/review`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, reason }),
  });

export const declararApuracaoCorporativa = async (companyId: string, declaration: unknown, files: readonly File[]) => {
  const form = new FormData(); form.set('declaration', JSON.stringify(declaration)); files.forEach((file) => form.append('evidence', file, file.name));
  return requisitar<unknown>(`${root(companyId)}/declarations`, { method: 'POST', body: form });
};

export const prepararApuracaoCorporativa = async (companyId: string, input: Readonly<{
  quarter: string; recognition: 'ACCRUAL' | 'CASH'; packageId: string; revenueDeclarationId: string;
  deductionEvidenceIds: readonly string[]; installmentCount: number; idempotencyKey: string;
}>) => CorporateTaxAssessmentSchema.parse(await requisitar<unknown>(root(companyId), {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
}));

export const obterApuracaoCorporativa = async (companyId: string, assessmentId: string) =>
  CorporateTaxAssessmentSchema.parse(await requisitar<unknown>(`${root(companyId)}/${assessmentId}`));

export const historicoApuracaoCorporativa = async (companyId: string, quarter: string) => z.object({ items: z.array(z.object({
  id, quarter: z.string(), revision: z.number().int().positive(), status: z.string(), canonicalJsonHash: digest, createdAtUtc: z.string(),
})) }).parse(await requisitar<unknown>(`${root(companyId)}/history?quarter=${encodeURIComponent(quarter)}`)).items;

export const decidirApuracaoCorporativa = async (companyId: string, assessment: CorporateTaxAssessment,
  action: 'APPROVED' | 'REJECTED' | 'RETURNED', justification: string,
  declarationsConfirmed: boolean, localDraftsAcknowledged: boolean) =>
  requisitar<unknown>(`${root(companyId)}/${assessment.assessmentId}/review`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, justification,
      declarationsConfirmed, localDraftsAcknowledged, installmentCount: assessment.installmentCount,
      expectedHash: assessment.canonicalJsonHash }),
  });

export const baixarArtefatoCorporativo = async (companyId: string, assessment: CorporateTaxAssessment,
  format: 'PDF' | 'CSV' | 'JSON' | 'IRPJ_DARF_DRAFT' | 'CSLL_DARF_DRAFT') => {
  const response = await fetch(`/api/proxy${root(companyId)}/${assessment.assessmentId}/export?format=${format}`, { credentials: 'include' });
  if (!response.ok) throw new Error('Não foi possível exportar a apuração.');
  if (response.headers.get('X-Canonical-JSON-SHA256') !== assessment.canonicalJsonHash)
    throw new Error('Hash canônico do artefato diverge da revisão exibida.');
  const blob = await response.blob(), url = URL.createObjectURL(blob), anchor = document.createElement('a');
  anchor.href = url; anchor.download = `apuracao-corporativa-${assessment.quarter}-${format.toLowerCase()}.${format === 'JSON' ? 'json' : format === 'CSV' ? 'csv' : 'pdf'}`;
  anchor.click(); URL.revokeObjectURL(url);
};

export const baixarArtefatoCorporativoPersistido = async (companyId: string, assessmentId: string, artifactId: string, canonicalHash: string) => {
  const response = await fetch(`/api/proxy${root(companyId)}/${assessmentId}/artifacts/${artifactId}`, { credentials: 'include' });
  if (!response.ok) throw new Error('Não foi possível baixar o artefato fiscal salvo.');
  if (response.headers.get('X-Canonical-JSON-SHA256') !== canonicalHash) throw new Error('Hash canônico do artefato salvo diverge.');
  const blob = await response.blob(), url = URL.createObjectURL(blob), anchor = document.createElement('a');
  anchor.href = url; anchor.download = `artefato-fiscal-${artifactId}`; anchor.click(); URL.revokeObjectURL(url);
};
