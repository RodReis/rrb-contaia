import { describe, expect, it } from 'vitest';

import { VALIDADE_DO_CONVITE_HORAS, conviteVigente, expiraEm } from './convite.js';

describe('validade do convite (SPEC-007 §3.2)', () => {
  it('é de 48 horas', () => {
    expect(VALIDADE_DO_CONVITE_HORAS).toBe(48);
  });

  it('expira exatamente 172800 segundos depois da emissão', () => {
    const emitidoEm = new Date('2026-10-02T12:00:00Z');

    expect(expiraEm(emitidoEm).getTime() - emitidoEm.getTime()).toBe(172_800_000);
  });
});

describe('conviteVigente', () => {
  const emitidoEm = new Date('2026-10-02T12:00:00Z');
  const base = { expiraEm: expiraEm(emitidoEm), usadoEm: null, invalidadoEm: null };

  it('vale 1 ms antes de expirar', () => {
    expect(conviteVigente(base, new Date(base.expiraEm.getTime() - 1))).toBe(true);
  });

  it('não vale no instante da expiração nem depois', () => {
    expect(conviteVigente(base, base.expiraEm)).toBe(false);
    expect(conviteVigente(base, new Date(base.expiraEm.getTime() + 1))).toBe(false);
  });

  it('não vale depois de usado (uso único)', () => {
    expect(conviteVigente({ ...base, usadoEm: new Date('2026-10-02T13:00:00Z') }, emitidoEm)).toBe(
      false,
    );
  });

  it('não vale depois de invalidado por reenvio ou correção de e-mail', () => {
    expect(
      conviteVigente({ ...base, invalidadoEm: new Date('2026-10-02T13:00:00Z') }, emitidoEm),
    ).toBe(false);
  });
});
