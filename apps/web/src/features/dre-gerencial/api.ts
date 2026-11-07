import { novoCorrelationId } from "../importacao/api";
import { requisitar } from "@/lib/http";

export type LinhaDre = Readonly<{
  code: string;
  title: string;
  type: "DETAIL" | "SUBTOTAL";
  order: number;
  level: number;
  parentCode: string | null;
  presentationSign: 1 | -1;
  accountIds: readonly string[];
  components: readonly { code: string; operator: "ADD" | "SUBTRACT" }[];
  verticalBasis: boolean;
}>;
export type ContaDre = Readonly<{
  accountId: string;
  code: string;
  name: string;
  status?: string;
  type?: string;
  costCenterPolicy?: string | null;
}>;
export type ReportLine = Readonly<{
  code: string;
  title: string;
  type: "DETAIL" | "SUBTOTAL";
  level: number;
  presentationSign: 1 | -1;
  currentCents: number;
  previousCents: number | null;
  verticalBasisPoints: number | "NOT_APPLICABLE" | "NOT_AVAILABLE";
  horizontalCents: number | null;
  horizontalBasisPoints: number | "NOT_APPLICABLE" | "NOT_AVAILABLE";
  accounts: readonly {
    code: string;
    name: string;
    currentCents: number;
    previousCents: number | null;
  }[];
}>;
export type Report = Readonly<{
  status: "COMPLETE" | "INCOMPLETE";
  reportStatus: "COMPLETE" | "INCOMPLETE";
  lines: readonly ReportLine[];
  unmappedAccounts: readonly {
    accountId: string;
    code: string;
    name: string;
    currentCents: number;
  }[];
  hash: string;
  companyId: string;
  basePeriod: string;
  periodMode: "MONTH" | "YEAR_TO_DATE";
  viewMode: "SYNTHETIC" | "ANALYTIC";
  statementVersion: number;
  statementEffectiveFrom: string;
  accountingPeriodStatus: "OPEN" | "CLOSED";
  companyName: string;
  cnpj: string | null;
  sourceHash: string;
}>;
export type Version = Readonly<{
  version: {
    id: string;
    version: number;
    status: "DRAFT" | "ACTIVE" | "SUPERSEDED";
    revision: number;
    effectiveFrom: string | null;
    effectiveTo: string | null;
  };
  lines: readonly LinhaDre[];
  validation?: {
    errors: readonly string[];
    publishable: boolean;
    eligibleAccounts: number;
    mappedAccounts: number;
  };
}>;

const root = (companyId: string) => `/empresas/${companyId}/dre-gerencial`;
const headers = () => ({
  "content-type": "application/json",
  "x-correlation-id": novoCorrelationId(),
});
export const consultarDre = (
  companyId: string,
  competence: string,
  periodMode: "MONTH" | "YEAR_TO_DATE",
  viewMode: "SYNTHETIC" | "ANALYTIC",
) =>
  requisitar<Report>(
    `${root(companyId)}?${new URLSearchParams({ competence, periodMode, viewMode })}`,
  );
export const listarVersoesDre = (companyId: string) =>
  requisitar<Version[]>(`${root(companyId)}/versoes`);
export const obterVersaoDre = (companyId: string, id: string) =>
  requisitar<Version>(`${root(companyId)}/versoes/${id}`);
export const criarRascunhoDre = (companyId: string, fromVersion?: number) =>
  requisitar<Version>(`${root(companyId)}/versoes`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(fromVersion === undefined ? {} : { fromVersion }),
  });
export const salvarEstruturaDre = (
  companyId: string,
  id: string,
  expectedRevision: number,
  lines: readonly LinhaDre[],
) =>
  requisitar<Version>(`${root(companyId)}/versoes/${id}/linhas`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ expectedRevision, lines }),
  });
export const publicarEstruturaDre = (
  companyId: string,
  id: string,
  expectedRevision: number,
  effectiveFrom: string,
) =>
  requisitar<Version>(`${root(companyId)}/versoes/${id}/publicar`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ expectedRevision, effectiveFrom }),
  });
export const listarContasDre = (companyId: string) =>
  requisitar<{ items: readonly ContaDre[] }>(
    `/empresas/${companyId}/estrutura-contabil/contas?busca=`,
  );
export const exportarDre = async (
  companyId: string,
  competence: string,
  periodMode: "MONTH" | "YEAR_TO_DATE",
  format: "PDF" | "CSV",
) => {
  const response = await fetch(
    `/api/proxy${root(companyId)}/exportacoes/${format}?${new URLSearchParams({ competence, periodMode })}`,
    {
      credentials: "include",
      headers: {
        "x-correlation-id": novoCorrelationId(),
        "idempotency-key": crypto.randomUUID(),
      },
    },
  );
  if (!response.ok) throw new Error("Não foi possível exportar a DRE.");
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `dre-${competence}-${periodMode.toLowerCase()}.${format.toLowerCase()}`;
  anchor.click();
  URL.revokeObjectURL(url);
};
