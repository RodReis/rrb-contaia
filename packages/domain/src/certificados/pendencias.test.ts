import { describe, expect, it } from 'vitest';

import { reconciliarPendencias } from '../pendencias/pendencias.js';
import { causasDeCertificado } from './pendencias.js';

const HOJE = '2026-10-15';

describe('causasDeCertificado', () => {
  it('sem vigente (nunca cadastrado ou desativado) é certificado ausente, sem data limite', () => {
    expect(causasDeCertificado({ vigente: null, responsavelInconsistente: false }, HOJE)).toEqual([
      {
        origem: 'CERTIFICADO',
        tipo: 'CERTIFICADO_AUSENTE',
        chave: 'certificado:ausente',
        dataLimite: null,
      },
    ]);
  });

  it('vigente válido e responsável consistente não gera pendência', () => {
    expect(
      causasDeCertificado({ vigente: { validoAte: '2027-01-01' }, responsavelInconsistente: false }, HOJE),
    ).toEqual([]);
  });

  it('vencimento próximo é alerta, não pendência; o último dia ainda vale', () => {
    expect(
      causasDeCertificado({ vigente: { validoAte: HOJE }, responsavelInconsistente: false }, HOJE),
    ).toEqual([]);
  });

  it('vencido gera pendência com data limite no fim da validade', () => {
    expect(
      causasDeCertificado({ vigente: { validoAte: '2026-10-14' }, responsavelInconsistente: false }, HOJE),
    ).toEqual([
      {
        origem: 'CERTIFICADO',
        tipo: 'CERTIFICADO_VENCIDO',
        chave: 'certificado:vencido',
        dataLimite: '2026-10-14',
      },
    ]);
  });

  it('responsável inconsistente gera pendência própria sem derrubar o certificado', () => {
    const causas = causasDeCertificado(
      { vigente: { validoAte: '2027-01-01' }, responsavelInconsistente: true },
      HOJE,
    );

    expect(causas.map((causa) => causa.chave)).toEqual(['certificado:responsavel']);
    expect(causas[0]?.tipo).toBe('CERTIFICADO_SEM_RESPONSAVEL');
  });

  it('vencido e sem responsável convivem', () => {
    expect(
      causasDeCertificado({ vigente: { validoAte: '2026-01-01' }, responsavelInconsistente: true }, HOJE).map(
        (causa) => causa.tipo,
      ),
    ).toEqual(['CERTIFICADO_VENCIDO', 'CERTIFICADO_SEM_RESPONSAVEL']);
  });

  it('reconciliar é idempotente e resolve a causa que sumiu', () => {
    const ausente = causasDeCertificado({ vigente: null, responsavelInconsistente: false }, HOJE);
    const primeira = reconciliarPendencias(ausente, []);
    const segunda = reconciliarPendencias(ausente, [{ chave: 'certificado:ausente' }]);
    const cadastrado = reconciliarPendencias(
      causasDeCertificado({ vigente: { validoAte: '2027-01-01' }, responsavelInconsistente: false }, HOJE),
      [{ chave: 'certificado:ausente' }],
    );

    expect(primeira.paraAbrir).toHaveLength(1);
    expect(segunda.paraAbrir).toHaveLength(0);
    expect(segunda.paraResolver).toHaveLength(0);
    expect(cadastrado.paraResolver).toEqual(['certificado:ausente']);
  });
});
