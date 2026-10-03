/** Convite por e-mail (SPEC-007 §3.2): individual, uso único, válido por 48 horas. */

export const VALIDADE_DO_CONVITE_HORAS = 48;

const MS_POR_HORA = 3_600_000;

export const expiraEm = (emitidoEm: Date): Date =>
  new Date(emitidoEm.getTime() + VALIDADE_DO_CONVITE_HORAS * MS_POR_HORA);

export const conviteVigente = (
  convite: Readonly<{ expiraEm: Date; usadoEm: Date | null; invalidadoEm: Date | null }>,
  agora: Date,
): boolean =>
  convite.usadoEm === null &&
  convite.invalidadoEm === null &&
  agora.getTime() < convite.expiraEm.getTime();
