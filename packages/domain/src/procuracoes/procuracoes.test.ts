import { describe, expect, it } from 'vitest';

import {
  CATALOGO_DE_PODERES_RFB,
  autorizarOperacaoRfb,
  estadoDaProcuracao,
  marcosDeAlertaDaProcuracao,
  periodosSobrepostos,
  validarPoderesRfb,
  type ProcuracaoParaAutorizacao,
} from './procuracoes.js';

const ativa = (ajustes: Partial<ProcuracaoParaAutorizacao> = {}): ProcuracaoParaAutorizacao => ({
  tenantId: 'tenant-1',
  empresaId: 'empresa-1',
  status: 'ACTIVE',
  arquivada: false,
  validFrom: '2026-10-01',
  validUntil: '2026-10-18',
  poderes: ['RFB_CNPJ_STATUS_READ'],
  ...ajustes,
});

describe('procuração RFB/e-CAC', () => {
  it('mantém o último dia civil inclusivo e expira no primeiro dia seguinte', () => {
    expect(estadoDaProcuracao('SCHEDULED', '2026-10-18', '2026-10-18', '2026-10-18')).toBe('ACTIVE');
    expect(estadoDaProcuracao('SCHEDULED', '2026-10-19', '2026-10-30', '2026-10-18')).toBe('SCHEDULED');
    expect(estadoDaProcuracao('ACTIVE', '2026-10-01', '2026-10-18', '2026-10-19')).toBe('EXPIRED');
    expect(estadoDaProcuracao('REVOKED', '2026-10-01', '2026-10-02', '2026-10-02')).toBe('REVOKED');
  });

  it('trata datas de vigência como intervalo civil inclusivo', () => {
    expect(periodosSobrepostos('2026-10-01', '2026-10-31', '2026-10-31', '2026-11-30')).toBe(true);
    expect(periodosSobrepostos('2026-10-01', '2026-10-30', '2026-10-31', '2026-11-30')).toBe(false);
  });

  it('recusa código fora do catálogo fechado', () => {
    expect(validarPoderesRfb(['RFB_CNPJ_STATUS_READ'])).toEqual({ ok: true });
    expect(validarPoderesRfb(['RFB_CNPJ_STATUS_READ', 'RFB_SEFAZ_TRANSMIT'])).toEqual({
      ok: false,
      code: 'PODER_RFB_INVALIDO',
    });
    expect(CATALOGO_DE_PODERES_RFB).toHaveLength(3);
  });

  it('autoriza só contexto, carteira, estado, vigência e poder coincidentes', () => {
    const entrada = {
      procuracao: ativa(),
      tenantId: 'tenant-1',
      empresaId: 'empresa-1',
      usuarioNaCarteira: true,
      poder: 'RFB_CNPJ_STATUS_READ' as const,
      hoje: '2026-10-18',
    };

    expect(autorizarOperacaoRfb(entrada)).toEqual({ ok: true });
    expect(autorizarOperacaoRfb({ ...entrada, tenantId: 'tenant-2' })).toEqual({
      ok: false,
      code: 'ESCOPO_DIVERGENTE',
    });
    expect(autorizarOperacaoRfb({ ...entrada, usuarioNaCarteira: false })).toEqual({
      ok: false,
      code: 'SEM_ACESSO_A_CARTEIRA',
    });
    expect(autorizarOperacaoRfb({ ...entrada, hoje: '2026-10-19' })).toEqual({
      ok: false,
      code: 'PROCURACAO_FORA_DA_VIGENCIA',
    });
    expect(autorizarOperacaoRfb({ ...entrada, poder: 'RFB_TAX_CLEARANCE_CERTIFICATE_READ' })).toEqual({
      ok: false,
      code: 'PODER_NAO_CONCEDIDO',
    });
    expect(autorizarOperacaoRfb({ ...entrada, procuracao: ativa({ status: 'REVOKED' }) })).toEqual({
      ok: false,
      code: 'PROCURACAO_INATIVA',
    });
    expect(autorizarOperacaoRfb({ ...entrada, procuracao: ativa({ arquivada: true }) })).toEqual({
      ok: false,
      code: 'PROCURACAO_INATIVA',
    });
  });

  it('emite cada marco D-30, D-7 e vencimento uma vez por versão', () => {
    expect(marcosDeAlertaDaProcuracao('2026-11-17', '2026-10-18')).toEqual(['D30']);
    expect(marcosDeAlertaDaProcuracao('2026-10-25', '2026-10-18')).toEqual(['D7']);
    expect(marcosDeAlertaDaProcuracao('2026-10-18', '2026-10-18')).toEqual(['VENCIMENTO']);
    expect(marcosDeAlertaDaProcuracao('2026-10-25', '2026-10-18')).toEqual(['D7']);
    expect(marcosDeAlertaDaProcuracao('2026-11-17', '2026-11-18')).toEqual([]);
  });
});
