import { describe, expect, it } from "vitest";
import {
  hashEstruturaModeloDre,
  sanitizarEstruturaDre,
  validarEstruturaModeloDre,
  type LinhaModeloDre,
} from "./modelos-dre.js";

const linha: LinhaModeloDre = {
  code: "RECEITA",
  title: "Receita líquida",
  type: "DETAIL",
  order: 1,
  level: 0,
  parentCode: null,
  presentationSign: 1,
  components: [],
  verticalBasis: true,
};

describe("modelos de DRE", () => {
  it("valida estrutura sem exigir vínculos de contas", () => {
    expect(validarEstruturaModeloDre([linha])).toEqual([]);
  });

  it("preserva validação da F45 para base vertical", () => {
    expect(validarEstruturaModeloDre([{ ...linha, verticalBasis: false }])).toContain(
      "STATEMENT_VERTICAL_BASIS_INVALID",
    );
  });

  it("gera hash determinístico só da estrutura", () => {
    expect(hashEstruturaModeloDre([linha])).toBe(hashEstruturaModeloDre([linha]));
    expect(hashEstruturaModeloDre([linha])).not.toBe(
      hashEstruturaModeloDre([{ ...linha, title: "Receita operacional" }]),
    );
  });

  it("sanitiza ids de contas na origem empresarial", () => {
    const origin = [{ ...linha, accountIds: ["conta-sensivel"] }];
    const sanitized = sanitizarEstruturaDre(origin);
    expect(sanitized).toEqual([linha]);
    expect(JSON.stringify(sanitized)).not.toContain("conta-sensivel");
  });
});
