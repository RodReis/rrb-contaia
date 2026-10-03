/** Rótulos de apresentação do cadastro da empresa, compartilhados entre as telas que a mostram. */

const ROTULO_DO_REGIME: Readonly<Record<string, string>> = {
  SIMPLES_NACIONAL: 'Simples Nacional',
  LUCRO_PRESUMIDO: 'Lucro Presumido',
  LUCRO_REAL: 'Lucro Real',
};

/** O código do regime vem da API (`SIMPLES_NACIONAL`); a tela mostra o nome. Código novo aparece como veio. */
export const rotuloDoRegime = (regime: string): string => ROTULO_DO_REGIME[regime] ?? regime;
