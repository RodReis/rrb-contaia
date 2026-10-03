/**
 * Estado de validade do certificado de uma empresa (SPEC-011 §3.6).
 *
 * Tudo em data civil `YYYY-MM-DD` de `America/Sao_Paulo` (I-11): o último dia de
 * validade ainda vale inteiro, e o "hoje" entra por parâmetro — nada aqui lê o
 * relógio.
 */

export const MARCOS_DE_VENCIMENTO = ['D30', 'D15', 'D7', 'VENCIDO'] as const;
export type MarcoDeVencimento = (typeof MARCOS_DE_VENCIMENTO)[number];

/** Dias corridos antes do fim da vigência em que cada marco passa a valer. */
const LIMIAR_DO_MARCO: Readonly<Record<Exclude<MarcoDeVencimento, 'VENCIDO'>, number>> = {
  D30: 30,
  D15: 15,
  D7: 7,
};

export type EstadoNoCofre =
  | 'SEM_CERTIFICADO'
  | 'VALIDO'
  | 'VENCE_D30'
  | 'VENCE_D15'
  | 'VENCE_D7'
  | 'VENCIDO'
  | 'DESATIVADO';

const UM_DIA_EM_MS = 24 * 60 * 60 * 1000;

/** Dias entre duas datas civis (negativo quando `validoAte` já passou). */
export const diasParaVencer = (validoAte: string, hoje: string): number =>
  Math.round((Date.parse(`${validoAte}T00:00:00Z`) - Date.parse(`${hoje}T00:00:00Z`)) / UM_DIA_EM_MS);

/**
 * O marco atual é o menor limiar já atingido; antes de D-30 não há marco.
 * `validoAte == hoje` ainda é D7 (vence hoje, mas vale hoje); só `validoAte < hoje` é vencido.
 */
export const marcoDeVencimentoAtual = (validoAte: string, hoje: string): MarcoDeVencimento | null => {
  const dias = diasParaVencer(validoAte, hoje);

  if (dias < 0) {
    return 'VENCIDO';
  }
  if (dias <= LIMIAR_DO_MARCO.D7) {
    return 'D7';
  }
  if (dias <= LIMIAR_DO_MARCO.D15) {
    return 'D15';
  }
  if (dias <= LIMIAR_DO_MARCO.D30) {
    return 'D30';
  }

  return null;
};

const ESTADO_DO_MARCO: Readonly<Record<MarcoDeVencimento, EstadoNoCofre>> = {
  D30: 'VENCE_D30',
  D15: 'VENCE_D15',
  D7: 'VENCE_D7',
  VENCIDO: 'VENCIDO',
};

/** Estado de validade do vigente: `VALIDO` ou o marco em que está. */
export const estadoDeValidade = (validoAte: string, hoje: string): EstadoNoCofre => {
  const marco = marcoDeVencimentoAtual(validoAte, hoje);

  return marco === null ? 'VALIDO' : ESTADO_DO_MARCO[marco];
};

/**
 * Estado apresentado da empresa. Sem vigente, o histórico decide: empresa que já
 * teve certificado e ficou sem vigente só pode ter sido desativada (a substituição
 * sempre deixa um vigente), então é `DESATIVADO`; sem histórico, `SEM_CERTIFICADO`.
 */
export const estadoNoCofre = (
  situacao: Readonly<{ vigente: Readonly<{ validoAte: string }> | null; temHistorico: boolean }>,
  hoje: string,
): EstadoNoCofre => {
  if (situacao.vigente !== null) {
    return estadoDeValidade(situacao.vigente.validoAte, hoje);
  }

  return situacao.temHistorico ? 'DESATIVADO' : 'SEM_CERTIFICADO';
};
