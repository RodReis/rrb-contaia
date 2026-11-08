import { createHash } from "node:crypto";
import type { LinhaDre } from "./dre-gerencial.js";
import { validateStatementStructure } from "./dre-gerencial.js";

export type LinhaModeloDre = Omit<LinhaDre, "accountIds">;
export type OrigemModeloDre = "MANUAL" | "COMPANY_VERSION";
export type EstadoModeloDre = "ACTIVE" | "ARCHIVED";
export type EstadoVersaoModeloDre = "DRAFT" | "ACTIVE" | "SUPERSEDED";

/** Valida invariantes da F45 sem permitir que contas da empresa entrem no modelo. */
export const validarEstruturaModeloDre = (
  linhas: readonly LinhaModeloDre[],
): readonly string[] => {
  const linhasComContasVazias: LinhaDre[] = linhas.map((linha) => ({
    ...linha,
    accountIds: [],
  }));
  return validateStatementStructure(linhasComContasVazias, []);
};

/** Hash inclui somente estrutura publicada; origem e dados operacionais ficam fora. */
export const hashEstruturaModeloDre = (
  linhas: readonly LinhaModeloDre[],
): string => {
  const canonical = [...linhas]
    .sort((a, b) => a.order - b.order)
    .map((line) => ({
      code: line.code,
      title: line.title,
      type: line.type,
      order: line.order,
      level: line.level,
      parentCode: line.parentCode,
      presentationSign: line.presentationSign,
      components: line.components.map(({ code, operator }) => ({
        code,
        operator,
      })),
      verticalBasis: line.verticalBasis,
    }));
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
};

/** Extrai somente estrutura F45; nenhum identificador ou vínculo de conta é mantido. */
export const sanitizarEstruturaDre = (
  linhas: readonly LinhaDre[],
): readonly LinhaModeloDre[] =>
  linhas.map((linha) => {
    const { accountIds, ...estrutura } = linha;
    void accountIds;
    return {
      ...estrutura,
      components: linha.components.map((component) => ({ ...component })),
    };
  });
