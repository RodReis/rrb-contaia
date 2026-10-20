import { describe, expect, it } from 'vitest';
import { decimalDeclaradoParaCentavos, statusRetencaoIcmsDeclarada, validateIcmsStDeclaredEvidence } from './validate-icms-st-evidence.js';

describe('evidência declarada de ICMS-ST', () => {
  it('reconhece somente presença/ausência explícita no grupo ICMS do item', () => {
    expect(statusRetencaoIcmsDeclarada([{ codigo: 'ICMS_ST', situacao: '10', valor: '1.00' }])).toBe(true);
    expect(statusRetencaoIcmsDeclarada([{ codigo: 'ICMS', situacao: '00', valor: '1.00' }])).toBe(false);
    expect(statusRetencaoIcmsDeclarada([])).toBeNull();
  });
  it('valida presença e fechamento exato em centavos sem recalcular tributo', () => {
    const checks = validateIcmsStDeclaredEvidence({ cest: '0100100', ncm: '87089990', taxableBaseCents: 100_000, rateBasisPoints: 1800, retainedAmountCents: 18_000 }, 18_000, 18_000);
    expect(checks.every((check) => check.status === 'VALID')).toBe(true);
  });

  it('indetermina ausência, total divergente e total não informado', () => {
    const evidence = { cest: null, ncm: null, taxableBaseCents: null, rateBasisPoints: null, retainedAmountCents: null };
    const checks = validateIcmsStDeclaredEvidence(evidence, 0, 100);
    expect(checks.map((check) => check.status)).toEqual(['INVALID', 'INVALID', 'INVALID', 'INVALID']);
    expect(checks.flatMap((check) => check.reasons)).toContain('TAX_ST_DOCUMENT_TOTAL_MISMATCH');
    expect(validateIcmsStDeclaredEvidence({ ...evidence, cest: '0100100', ncm: '87089990', retainedAmountCents: 1 }, 1, null)[3]?.status).toBe('NOT_CHECKED');
  });

  it('converte decimal declarado em centavos inteiros e rejeita escala ou overflow', () => {
    expect(decimalDeclaradoParaCentavos('123.4')).toBe(12_340);
    expect(decimalDeclaradoParaCentavos('1.001')).toBeNull();
    expect(decimalDeclaradoParaCentavos('999999999999999999999999')).toBeNull();
  });
});
