import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { permissions, params, report, listVersions, listAccounts, exportDre } =
  vi.hoisted(() => ({
    permissions: [
      "contabil.dre_gerencial.consultar",
      "contabil.dre_gerencial.baixar",
    ],
    params: new URLSearchParams(
      "competence=2025-01&periodMode=MONTH&viewMode=ANALYTIC",
    ),
    report: vi.fn(),
    listVersions: vi.fn(),
    listAccounts: vi.fn(),
    exportDre: vi.fn(),
  }));

vi.mock("next/navigation", () => ({ useSearchParams: () => params }));
vi.mock("../usuarios/queries", () => ({
  useSessao: () => ({ data: { permissoes: permissions } }),
}));
vi.mock("../cofre/permissoes", () => ({
  concede: (session: { permissoes: string[] }, key: string) =>
    session.permissoes.includes(key),
}));
vi.mock("../empresa/api", () => ({ listarEmpresas: vi.fn() }));
vi.mock("./api", () => ({
  consultarDre: report,
  criarRascunhoDre: vi.fn(),
  exportarDre: exportDre,
  listarContasDre: listAccounts,
  listarVersoesDre: listVersions,
  publicarEstruturaDre: vi.fn(),
  salvarEstruturaDre: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { DreGerencial } from "./dre-gerencial";

const renderizar = () =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
          },
        })
      }
    >
      <DreGerencial empresaId="empresa-1" nomeEmpresa="Empresa teste" />
    </QueryClientProvider>,
  );

describe("DRE gerencial", () => {
  beforeEach(() => {
    permissions.splice(
      0,
      permissions.length,
      "contabil.dre_gerencial.consultar",
      "contabil.dre_gerencial.baixar",
    );
    params.set("competence", "2025-01");
    params.set("periodMode", "MONTH");
    params.set("viewMode", "ANALYTIC");
    listVersions.mockResolvedValue([]);
    listAccounts.mockResolvedValue({ items: [] });
    exportDre.mockReset();
    report.mockResolvedValue({
      status: "INCOMPLETE",
      reportStatus: "INCOMPLETE",
      lines: [],
      unmappedAccounts: [
        {
          accountId: "a1",
          code: "4.1",
          name: "Despesa sem vínculo",
          currentCents: 1250,
        },
      ],
      hash: "a".repeat(64),
      companyId: "empresa-1",
      basePeriod: "2025-01",
      periodMode: "MONTH",
      viewMode: "ANALYTIC",
      statementVersion: 1,
      statementEffectiveFrom: "2025-01",
      accountingPeriodStatus: "OPEN",
      companyName: "Empresa teste",
      cnpj: null,
      sourceHash: "fonte",
    });
  });

  it("exibe a prévia incompleta e mantém exportações bloqueadas", async () => {
    renderizar();
    expect(
      await screen.findByText("COBERTURA INCOMPLETA — PRÉVIA"),
    ).toBeInTheDocument();
    expect(screen.getByText("4.1 · Despesa sem vínculo")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "CSV analítico" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "PDF executivo" }),
    ).toBeDisabled();
    expect(exportDre).not.toHaveBeenCalled();
  });

  it("oculta controles de edição e exportação sem as permissões próprias", async () => {
    permissions.splice(
      0,
      permissions.length,
      "contabil.dre_gerencial.consultar",
    );
    renderizar();
    await screen.findByText("COBERTURA INCOMPLETA — PRÉVIA");
    expect(
      screen.queryByRole("button", { name: "Configurar estrutura" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "CSV analítico" }),
    ).not.toBeInTheDocument();
  });

  it("atualiza a consulta ao trocar competência e mostra taxas indisponíveis com motivo", async () => {
    report.mockResolvedValueOnce({
      status: "COMPLETE",
      reportStatus: "COMPLETE",
      lines: [
        {
          code: "REV",
          title: "Receita",
          type: "DETAIL",
          level: 0,
          presentationSign: 1,
          currentCents: 1000,
          previousCents: null,
          verticalBasisPoints: 10000,
          horizontalCents: null,
          horizontalBasisPoints: "NOT_AVAILABLE",
          accounts: [],
        },
      ],
      unmappedAccounts: [],
      hash: "b".repeat(64),
      companyId: "empresa-1",
      basePeriod: "2025-01",
      periodMode: "MONTH",
      viewMode: "ANALYTIC",
      statementVersion: 1,
      statementEffectiveFrom: "2025-01",
      accountingPeriodStatus: "CLOSED",
      companyName: "Empresa teste",
      cnpj: null,
      sourceHash: "fechado",
    });
    renderizar();
    expect(
      (await screen.findAllByText(/N\/D — comparação indisponível/)).length,
    ).toBeGreaterThanOrEqual(1);
    fireEvent.change(screen.getByLabelText("Competência"), {
      target: { value: "2025-02" },
    });
    await waitFor(() =>
      expect(window.location.search).toContain("competence=2025-02"),
    );
  });
});
