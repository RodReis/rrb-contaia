import { describe, expect, it } from "vitest";
import {
  calculateStatementReport,
  validateStatementStructure,
  type ContaResultadoDre,
  type LinhaDre,
  type MovimentoDre,
} from "./dre-gerencial.js";

const accounts: ContaResultadoDre[] = [
  {
    accountId: "revenue",
    code: "3.1",
    name: "Receita",
    nature: "REVENUE",
    eligible: true,
  },
  {
    accountId: "expense",
    code: "4.1",
    name: "Despesa",
    nature: "EXPENSE",
    eligible: true,
  },
  {
    accountId: "unmapped",
    code: "4.2",
    name: "Despesa sem vínculo",
    nature: "EXPENSE",
    eligible: true,
  },
];
const lines: LinhaDre[] = [
  {
    code: "REV",
    title: "Receita bruta",
    type: "DETAIL",
    order: 1,
    level: 0,
    parentCode: null,
    presentationSign: 1,
    accountIds: ["revenue"],
    components: [],
    verticalBasis: true,
  },
  {
    code: "EXP",
    title: "Despesas",
    type: "DETAIL",
    order: 2,
    level: 0,
    parentCode: null,
    presentationSign: -1,
    accountIds: ["expense"],
    components: [],
    verticalBasis: false,
  },
  {
    code: "NET",
    title: "Resultado",
    type: "SUBTOTAL",
    order: 3,
    level: 0,
    parentCode: null,
    presentationSign: 1,
    accountIds: [],
    components: [
      { code: "REV", operator: "ADD" },
      { code: "EXP", operator: "ADD" },
    ],
    verticalBasis: false,
  },
];
const movements: MovimentoDre[] = [
  {
    accountId: "revenue",
    competence: "2025-01",
    debitCents: 0,
    creditCents: 100_000,
  },
  {
    accountId: "expense",
    competence: "2025-01",
    debitCents: 20_000,
    creditCents: 0,
  },
  {
    accountId: "unmapped",
    competence: "2025-01",
    debitCents: 5_000,
    creditCents: 0,
  },
  {
    accountId: "revenue",
    competence: "2024-01",
    debitCents: 0,
    creditCents: 80_000,
  },
  {
    accountId: "expense",
    competence: "2024-01",
    debitCents: 15_000,
    creditCents: 0,
  },
];

describe("SPEC-045 DRE gerencial", () => {
  it("valida mapeamento único, árvore, fórmulas e base vertical explícita", () => {
    expect(validateStatementStructure(lines, accounts)).toEqual([
      "STATEMENT_ACCOUNT_UNMAPPED",
    ]);
    expect(
      validateStatementStructure(
        lines,
        accounts.filter((account) => account.accountId !== "unmapped"),
      ),
    ).toEqual([]);
    expect(
      validateStatementStructure(
        [
          { ...lines[0]!, accountIds: ["revenue", "expense"] },
          lines[1]!,
          lines[2]!,
        ],
        accounts.filter((account) => account.accountId !== "unmapped"),
      ),
    ).toContain("STATEMENT_ACCOUNT_ALREADY_MAPPED");
    expect(
      validateStatementStructure(
        lines.map((line, index) => ({ ...line, verticalBasis: index < 2 })),
        accounts.filter((account) => account.accountId !== "unmapped"),
      ),
    ).toContain("STATEMENT_VERTICAL_BASIS_INVALID");
    expect(
      validateStatementStructure(
        [{ ...lines[1]!, level: 1, parentCode: "REV" }, lines[0]!, lines[2]!],
        accounts.filter((account) => account.accountId !== "unmapped"),
      ),
    ).toContain("STATEMENT_LINE_TREE_INVALID");
    expect(
      validateStatementStructure(
        [
          { ...lines[0]!, code: "REV" },
          { ...lines[1]!, code: "REV" },
        ],
        accounts.filter((account) => account.accountId !== "unmapped"),
      ),
    ).toContain("STATEMENT_LINE_CODE_INVALID");
  });

  it("calcula mês, valores comparativos, AV/AH e mostra conta movimentada sem vínculo", () => {
    const report = calculateStatementReport({
      lines,
      accounts,
      movements,
      companyId: "company-1",
      statementVersion: 1,
      viewMode: "SYNTHETIC",
      basePeriod: "2025-01",
      periodMode: "MONTH",
      comparisonAvailable: true,
      sourceHash: "close-1",
    });
    expect(report.status).toBe("INCOMPLETE");
    expect(
      report.lines.map(
        ({
          code,
          currentCents,
          previousCents,
          verticalBasisPoints,
          horizontalCents,
          horizontalBasisPoints,
        }) => ({
          code,
          currentCents,
          previousCents,
          verticalBasisPoints,
          horizontalCents,
          horizontalBasisPoints,
        }),
      ),
    ).toEqual([
      {
        code: "REV",
        currentCents: 100_000,
        previousCents: 80_000,
        verticalBasisPoints: 10_000,
        horizontalCents: 20_000,
        horizontalBasisPoints: 2_500,
      },
      {
        code: "EXP",
        currentCents: -20_000,
        previousCents: -15_000,
        verticalBasisPoints: -2_000,
        horizontalCents: -5_000,
        horizontalBasisPoints: 3_333,
      },
      {
        code: "NET",
        currentCents: 80_000,
        previousCents: 65_000,
        verticalBasisPoints: 8_000,
        horizontalCents: 15_000,
        horizontalBasisPoints: 2_308,
      },
    ]);
    expect(report.unmappedAccounts).toEqual([
      {
        accountId: "unmapped",
        code: "4.2",
        name: "Despesa sem vínculo",
        currentCents: 5_000,
      },
    ]);
    expect(report.hash).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("acumula desde janeiro e não inventa comparação sem base anterior", () => {
    const ytd = calculateStatementReport({
      lines: lines.slice(0, 2),
      accounts: accounts.slice(0, 2),
      movements: [
        ...movements,
        {
          accountId: "revenue",
          competence: "2025-02",
          debitCents: 0,
          creditCents: 40_000,
        },
      ],
      companyId: "company-1",
      statementVersion: 1,
      viewMode: "ANALYTIC",
      basePeriod: "2025-02",
      periodMode: "YEAR_TO_DATE",
      comparisonAvailable: false,
      sourceHash: "open",
    });
    expect(ytd.lines[0]).toMatchObject({
      currentCents: 140_000,
      previousCents: null,
      horizontalCents: null,
      horizontalBasisPoints: "NOT_AVAILABLE",
    });
  });

  it("produz o mesmo hash para fontes e ordenação canônica idênticas", () => {
    const a = calculateStatementReport({
      lines,
      accounts,
      movements,
      companyId: "company-1",
      statementVersion: 1,
      viewMode: "SYNTHETIC",
      basePeriod: "2025-01",
      periodMode: "MONTH",
      comparisonAvailable: true,
      sourceHash: "close-1",
    });
    const b = calculateStatementReport({
      lines,
      accounts,
      movements: [...movements].reverse(),
      companyId: "company-1",
      statementVersion: 1,
      viewMode: "SYNTHETIC",
      basePeriod: "2025-01",
      periodMode: "MONTH",
      comparisonAvailable: true,
      sourceHash: "close-1",
    });
    expect(b.hash).toBe(a.hash);
  });
});
