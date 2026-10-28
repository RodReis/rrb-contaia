/** Regras puras de lançamento manual balanceado (SPEC-040 §§3–5). */

export const ESTADOS_DO_LANCAMENTO = ['DRAFT', 'POSTED', 'DISCARDED', 'CANCELLED', 'REVERSED'] as const;
export type EstadoDoLancamento = (typeof ESTADOS_DO_LANCAMENTO)[number];
export const LADOS_DA_PARTIDA = ['DEBIT', 'CREDIT'] as const;
export type LadoDaPartida = (typeof LADOS_DA_PARTIDA)[number];

export type PartidaContabil = Readonly<{
  lineId: string;
  accountId: string;
  side: LadoDaPartida;
  amountCents: number;
  costCenterId: string | null;
  memo: string | null;
  position: number;
}>;

export type CabecalhoContabil = Readonly<{
  accountingDate: string;
  competence: string;
  history: string;
  externalReference: string | null;
}>;

export type CodigoDeErroDeLancamento =
  | 'ACCOUNTING_ENTRY_LINE_INVALID'
  | 'ACCOUNTING_ENTRY_COMPETENCE_INVALID'
  | 'ACCOUNTING_ENTRY_UNBALANCED'
  | 'ACCOUNTING_ENTRY_IMMUTABLE'
  | 'ACCOUNTING_ENTRY_ACCOUNT_INVALID'
  | 'ACCOUNTING_ENTRY_COST_CENTER_REQUIRED'
  | 'ACCOUNTING_ENTRY_COST_CENTER_FORBIDDEN'
  | 'ACCOUNTING_ENTRY_COST_CENTER_INVALID'
  | 'ACCOUNTING_ENTRY_VERSION_CONFLICT'
  | 'ACCOUNTING_ENTRY_CANCELLATION_FORBIDDEN'
  | 'ACCOUNTING_ENTRY_FORBIDDEN'
  | 'ACCOUNTING_ENTRY_REVERSAL_FORBIDDEN';

export type ErroDeValidacaoDeLancamento = Readonly<{
  code: CodigoDeErroDeLancamento;
  field: string;
  message: string;
}>;

const dataCivilValida = (valor: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(valor)) return false;
  const [ano, mes, dia] = valor.split('-').map(Number);
  const data = new Date(Date.UTC(ano!, mes! - 1, dia!));
  return data.getUTCFullYear() === ano && data.getUTCMonth() === mes! - 1 && data.getUTCDate() === dia;
};

const competenciaValida = (valor: string): boolean => /^\d{4}-(0[1-9]|1[0-2])$/u.test(valor);

export const validarCabecalhoContabil = (cabecalho: CabecalhoContabil): readonly ErroDeValidacaoDeLancamento[] => {
  const erros: ErroDeValidacaoDeLancamento[] = [];
  if (!dataCivilValida(cabecalho.accountingDate) || !competenciaValida(cabecalho.competence) || cabecalho.accountingDate.slice(0, 7) !== cabecalho.competence) {
    erros.push({ code: 'ACCOUNTING_ENTRY_COMPETENCE_INVALID', field: 'accountingDate', message: 'A data contábil deve ser válida e pertencer à competência informada.' });
  }
  if (cabecalho.history.trim().length === 0 || cabecalho.history.trim().length > 500) {
    erros.push({ code: 'ACCOUNTING_ENTRY_LINE_INVALID', field: 'history', message: 'Informe um histórico com até 500 caracteres.' });
  }
  if ((cabecalho.externalReference?.trim().length ?? 0) > 240) {
    erros.push({ code: 'ACCOUNTING_ENTRY_LINE_INVALID', field: 'externalReference', message: 'A referência deve ter até 240 caracteres.' });
  }
  return erros;
};

export const validarPartidasContabeis = (
  partidas: readonly PartidaContabil[],
  exigirBalanceamento: boolean,
): readonly ErroDeValidacaoDeLancamento[] => {
  const erros: ErroDeValidacaoDeLancamento[] = [];
  const ids = new Set<string>();
  const posicoes = new Set<number>();
  for (const partida of partidas) {
    if (partida.lineId.length === 0 || ids.has(partida.lineId) || partida.accountId.length === 0 ||
      !LADOS_DA_PARTIDA.includes(partida.side) || !Number.isSafeInteger(partida.amountCents) || partida.amountCents <= 0 ||
      !Number.isSafeInteger(partida.position) || partida.position < 0 || posicoes.has(partida.position) ||
      (partida.memo?.length ?? 0) > 240) {
      erros.push({ code: 'ACCOUNTING_ENTRY_LINE_INVALID', field: 'lines', message: 'Cada partida exige conta, lado, centavos positivos e posição única válidos.' });
      break;
    }
    ids.add(partida.lineId);
    posicoes.add(partida.position);
  }
  if (exigirBalanceamento) {
    if (partidas.length < 2) {
      erros.push({ code: 'ACCOUNTING_ENTRY_LINE_INVALID', field: 'lines', message: 'O lançamento efetivado deve ter pelo menos duas partidas.' });
    } else {
      const debitos = partidas.filter((partida) => partida.side === 'DEBIT').reduce((total, partida) => total + BigInt(partida.amountCents), 0n);
      const creditos = partidas.filter((partida) => partida.side === 'CREDIT').reduce((total, partida) => total + BigInt(partida.amountCents), 0n);
      if (debitos === 0n || creditos === 0n || debitos !== creditos) {
        erros.push({ code: 'ACCOUNTING_ENTRY_UNBALANCED', field: 'lines', message: 'A soma dos débitos deve ser igual à soma dos créditos.' });
      }
    }
  }
  return erros;
};

export const ladosInvertidos = (partidas: readonly PartidaContabil[]): readonly PartidaContabil[] =>
  partidas.map((partida) => ({ ...partida, lineId: '', side: partida.side === 'DEBIT' ? 'CREDIT' : 'DEBIT' }));

export const podeEstornar = (estado: EstadoDoLancamento): boolean => estado === 'POSTED';
