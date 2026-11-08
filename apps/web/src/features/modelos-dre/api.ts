import { novoCorrelationId } from "../importacao/api";
import type { LinhaDre } from "../dre-gerencial/api";
import { requisitar } from "@/lib/http";

export type LinhaModelo = Omit<LinhaDre, "accountIds">;
export type ModeloDre = Readonly<{
  id: string; name: string; description: string | null; status: "ACTIVE" | "ARCHIVED";
  createdBy: string; updatedBy: string; updatedByName?: string | null; createdAt: string; updatedAt: string;
  activeVersion: number | null; activeOrigin: "MANUAL" | "COMPANY_VERSION" | null;
}>;
export type VersaoModelo = Readonly<{
  id: string; version: number; status: "DRAFT" | "ACTIVE" | "SUPERSEDED" | "DISCARDED"; revision: number;
  origin: "MANUAL" | "COMPANY_VERSION"; structuralHash: string | null;
  createdBy: string; createdAt: string; publishedBy: string | null; publishedAt: string | null;
}>;
export type ModeloDetalhe = Readonly<{ model: ModeloDre; version: VersaoModelo; lines: readonly LinhaModelo[] }>;
export type ProvenienciaModelo = Readonly<{
  origin: Readonly<{ type?: string; companyId?: string; sourceStatementVersionId?: string; actorId?: string; createdAt?: string }>;
  applications: readonly Readonly<{ companyId: string; statementDraftId: string; actorId: string; createdAt: string }>[];
}>;

const base = "/contabil/modelos-dre";
const opcoes = () => ({ headers: { "content-type": "application/json", "x-correlation-id": novoCorrelationId() } });
export const listarModelos = (busca: string, estado: "ACTIVE" | "ARCHIVED" | "") => {
  const params = new URLSearchParams();
  if (busca) params.set("busca", busca);
  if (estado) params.set("estado", estado);
  return requisitar<{ items: readonly ModeloDre[] }>(`${base}?${params}`);
};
export const criarModelo = (input: { name: string; description: string }) => requisitar<{ templateId: string; version: number; versionId: string }>(base, { method: "POST", ...opcoes(), body: JSON.stringify(input) });
export const criarModeloDaEmpresa = (input: { name: string; description: string; companyId: string; sourceVersionId: string }) => requisitar<{ templateId: string; version: number; versionId: string }>(`${base}/origem-empresa`, { method: "POST", ...opcoes(), body: JSON.stringify(input) });
export const renomearModelo = (id: string, input: { name: string; description: string }) => requisitar<ModeloDre>(`${base}/${id}`, { method: "PATCH", ...opcoes(), body: JSON.stringify(input) });
export const arquivarModelo = (id: string) => requisitar<ModeloDre>(`${base}/${id}/arquivar`, { method: "POST", ...opcoes() });
export const reativarModelo = (id: string) => requisitar<ModeloDre>(`${base}/${id}/reativar`, { method: "POST", ...opcoes() });
export const listarVersoesModelo = (id: string) => requisitar<{ items: readonly VersaoModelo[] }>(`${base}/${id}/versoes`);
export const obterVersaoModelo = (id: string, version: number) => requisitar<ModeloDetalhe>(`${base}/${id}/versoes/${version}`);
export const criarVersaoModelo = (id: string) => requisitar<{ version: number; versionId: string; status: "DRAFT"; revision: number }>(`${base}/${id}/versoes`, { method: "POST", ...opcoes() });
export const descartarRascunhoModelo = (id: string, version: number) => requisitar<{ version: number; status: "DISCARDED" }>(`${base}/${id}/versoes/${version}/descartar`, { method: "POST", ...opcoes() });
export const salvarLinhasModelo = (id: string, version: number, expectedRevision: number, lines: readonly LinhaModelo[]) => requisitar<ModeloDetalhe>(`${base}/${id}/versoes/${version}/linhas`, { method: "PUT", ...opcoes(), body: JSON.stringify({ expectedRevision, lines }) });
export const publicarModelo = (id: string, version: number, expectedRevision: number) => requisitar<VersaoModelo>(`${base}/${id}/versoes/${version}/publicar`, { method: "POST", ...opcoes(), body: JSON.stringify({ expectedRevision }) });
export const aplicarModelo = (id: string, templateVersion: number, companyId: string, expectedCompanyRevision: number) => requisitar<{ companyStatementDraftId: string; templateId: string; templateVersion: number; created: boolean }>(`${base}/${id}/aplicar`, { method: "POST", ...opcoes(), body: JSON.stringify({ templateVersion, companyId, expectedCompanyRevision, idempotencyKey: crypto.randomUUID() }) });
export const consultarProvenienciaModelo = (id: string, version: number) => requisitar<ProvenienciaModelo>(`${base}/${id}/versoes/${version}/proveniencia`);
