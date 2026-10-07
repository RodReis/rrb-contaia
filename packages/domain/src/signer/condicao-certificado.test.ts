import { describe, expect, it } from 'vitest';

import { certificadoUtilizavel, type VersaoDoCertificado } from './condicao-certificado.js';

const HOJE = '2026-10-07';

const versao = (parcial: Partial<VersaoDoCertificado> = {}): VersaoDoCertificado => ({
  estado: 'VIGENTE',
  validoDe: '2026-01-01',
  validoAte: '2027-01-01',
  responsavelValido: true,
  ...parcial,
});

describe('certificadoUtilizavel (SPEC-012 §3.5)', () => {
  it('libera certificado vigente dentro da validade', () => {
    expect(certificadoUtilizavel(versao(), HOJE)).toEqual({ ok: true });
  });

  it('bloqueia certificado ausente', () => {
    expect(certificadoUtilizavel(null, HOJE)).toEqual({ ok: false, codigo: 'SIGNER_CERTIFICADO_AUSENTE' });
  });

  it('bloqueia certificado desativado', () => {
    expect(certificadoUtilizavel(versao({ estado: 'DESATIVADO' }), HOJE)).toEqual({
      ok: false,
      codigo: 'SIGNER_CERTIFICADO_DESATIVADO',
    });
  });

  it('bloqueia versão substituída: só a vigente opera', () => {
    expect(certificadoUtilizavel(versao({ estado: 'SUBSTITUIDO' }), HOJE)).toEqual({
      ok: false,
      codigo: 'SIGNER_CERTIFICADO_AUSENTE',
    });
  });

  it('bloqueia certificado vencido, mas o último dia de validade ainda vale inteiro', () => {
    expect(certificadoUtilizavel(versao({ validoAte: '2026-10-06' }), HOJE)).toEqual({
      ok: false,
      codigo: 'SIGNER_CERTIFICADO_VENCIDO',
    });
    expect(certificadoUtilizavel(versao({ validoAte: HOJE }), HOJE)).toEqual({ ok: true });
  });

  it('bloqueia certificado ainda não vigente, mas o primeiro dia já vale', () => {
    expect(certificadoUtilizavel(versao({ validoDe: '2026-10-08' }), HOJE)).toEqual({
      ok: false,
      codigo: 'SIGNER_CERTIFICADO_AINDA_NAO_VIGENTE',
    });
    expect(certificadoUtilizavel(versao({ validoDe: HOJE }), HOJE)).toEqual({ ok: true });
  });

  it('responsável inválido NÃO bloqueia o uso (SPEC-012 §3.5)', () => {
    expect(certificadoUtilizavel(versao({ responsavelValido: false }), HOJE)).toEqual({ ok: true });
  });
});
