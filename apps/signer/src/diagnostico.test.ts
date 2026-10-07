import { describe, expect, it } from 'vitest';

import { xmlDeDiagnostico } from './diagnostico.js';
import { ADAPTADORES } from './xml/adaptadores.js';
import { analisarXml } from './xml/seguranca.js';

const CNPJ = '11222333000181';

describe('XML de diagnóstico: o Signer usa o seu, o chamador não envia conteúdo (SPEC-012 §3.9)', () => {
  it.each(['DFE_TESTE', 'ESOCIAL_TESTE'] as const)('%s passa pela análise do próprio adaptador', (finalidade) => {
    const xml = xmlDeDiagnostico(finalidade, CNPJ, 'corr-0001-abcd');

    expect(() => analisarXml(xml, ADAPTADORES[finalidade])).not.toThrow();
    expect(xml).toContain(CNPJ);
  });

  it('é determinístico por correlationId e distinto entre execuções', () => {
    expect(xmlDeDiagnostico('DFE_TESTE', CNPJ, 'corr-0001-abcd')).toBe(xmlDeDiagnostico('DFE_TESTE', CNPJ, 'corr-0001-abcd'));
    expect(xmlDeDiagnostico('DFE_TESTE', CNPJ, 'corr-0001-abcd')).not.toBe(xmlDeDiagnostico('DFE_TESTE', CNPJ, 'corr-0002-abcd'));
  });

  it('o Id do elemento assinado só usa o alfabeto seguro, mesmo com correlationId estranho', () => {
    const xml = xmlDeDiagnostico('ESOCIAL_TESTE', CNPJ, "corr-'-\"-<x>-0001");

    expect(() => analisarXml(xml, ADAPTADORES['ESOCIAL_TESTE'])).not.toThrow();
  });
});
