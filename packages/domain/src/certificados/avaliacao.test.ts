import { describe, expect, it } from 'vitest';

import {
  CODIGOS_DE_RECUSA_DA_INGESTAO,
  PREFIXO_DA_POLITICA_A1,
  avaliarCertificado,
  type CertificadoExtraido,
} from './avaliacao.js';

const CNPJ = '11222333000181';
// 2026-10-03 12:00 em São Paulo (UTC-3).
const AGORA = new Date('2026-10-03T15:00:00Z');

const extraido = (sobrescrita: Partial<CertificadoExtraido> = {}): CertificadoExtraido => ({
  cnpjsDoTitular: [CNPJ],
  oidsDePoliticas: [`${PREFIXO_DA_POLITICA_A1}1`],
  ehAutoridade: false,
  permiteAssinaturaDigital: true,
  cadeiaIcpValidada: true,
  possuiChavePrivada: true,
  naoAntes: new Date('2026-09-01T03:00:00Z'),
  naoDepois: new Date('2027-09-01T03:00:00Z'),
  ...sobrescrita,
});

const avaliar = (c: CertificadoExtraido, agora = AGORA, cnpjDaEmpresa = CNPJ) =>
  avaliarCertificado(c, { cnpjDaEmpresa, agora });

describe('avaliarCertificado — aceite', () => {
  it('aceita e-CNPJ A1 vigente do mesmo CNPJ e devolve a validade como data civil', () => {
    expect(avaliar(extraido())).toEqual({ ok: true, validoDe: '2026-09-01', validoAte: '2027-09-01' });
  });

  it('compara o CNPJ normalizado: máscara e caixa não importam', () => {
    expect(avaliar(extraido({ cnpjsDoTitular: ['11.222.333/0001-81'] })).ok).toBe(true);
    expect(avaliar(extraido(), AGORA, '11.222.333/0001-81').ok).toBe(true);
  });

  it('suporta CNPJ alfanumérico', () => {
    const alfanumerico = '12ABC34501DE35';

    expect(avaliar(extraido({ cnpjsDoTitular: ['12abc34501de35'] }), AGORA, alfanumerico).ok).toBe(true);
  });

  it('aceita se qualquer um dos CNPJs do titular for o da empresa', () => {
    expect(avaliar(extraido({ cnpjsDoTitular: ['45723174000110', CNPJ] })).ok).toBe(true);
  });

  it('aceita quando uma das políticas é A1, mesmo com outras presentes', () => {
    expect(avaliar(extraido({ oidsDePoliticas: ['2.16.76.1.2.3.1', `${PREFIXO_DA_POLITICA_A1}2`] })).ok).toBe(true);
  });
});

describe('avaliarCertificado — tipo incompatível', () => {
  const tipoIncompativel = { ok: false, codigo: 'CERTIFICADO_TIPO_INCOMPATIVEL' };

  it.each([
    ['A3 (política 2.16.76.1.2.3.x)', { oidsDePoliticas: ['2.16.76.1.2.3.1'] }],
    ['sem política alguma', { oidsDePoliticas: [] }],
    ['política que apenas contém o prefixo no meio', { oidsDePoliticas: ['9.2.16.76.1.2.1.1'] }],
    ['e-CPF (sem CNPJ do titular)', { cnpjsDoTitular: [] }],
    ['certificado de autoridade', { ehAutoridade: true }],
    ['sem uso de assinatura digital', { permiteAssinaturaDigital: false }],
    ['cadeia fora da raiz ICP-Brasil confiável', { cadeiaIcpValidada: false }],
    ['sem chave privada', { possuiChavePrivada: false }],
  ])('recusa %s', (_nome, alteracao) => {
    expect(avaliar(extraido(alteracao as Partial<CertificadoExtraido>))).toEqual(tipoIncompativel);
  });

  it('o tipo é avaliado antes do CNPJ e da vigência', () => {
    const tudoErrado = extraido({
      oidsDePoliticas: [],
      cnpjsDoTitular: ['45723174000110'],
      naoDepois: new Date('2020-01-01T00:00:00Z'),
    });

    expect(avaliar(tudoErrado)).toEqual(tipoIncompativel);
  });
});

describe('avaliarCertificado — CNPJ', () => {
  it('recusa CNPJ diferente', () => {
    expect(avaliar(extraido({ cnpjsDoTitular: ['45723174000110'] }))).toEqual({
      ok: false,
      codigo: 'CERTIFICADO_CNPJ_DIVERGENTE',
    });
  });

  it('é avaliado antes da vigência', () => {
    const expiradoDeOutroCnpj = extraido({
      cnpjsDoTitular: ['45723174000110'],
      naoDepois: new Date('2020-01-01T00:00:00Z'),
    });

    expect(avaliar(expiradoDeOutroCnpj)).toMatchObject({ codigo: 'CERTIFICADO_CNPJ_DIVERGENTE' });
  });
});

describe('avaliarCertificado — vigência por data civil em America/Sao_Paulo', () => {
  // naoDepois = 2026-10-03T02:59:59Z = 2026-10-02 23:59:59 em São Paulo → validoAte = 2026-10-02.
  const termina = extraido({ naoDepois: new Date('2026-10-03T02:59:59Z') });

  it('o último dia de validade ainda vale, até 23:59 de São Paulo', () => {
    const ultimoMinuto = new Date('2026-10-03T02:59:00Z'); // 2026-10-02 23:59 em SP

    expect(avaliar(termina, ultimoMinuto)).toMatchObject({ ok: true, validoAte: '2026-10-02' });
  });

  it('na virada do dia em São Paulo (00:00 SP = 03:00Z) já está expirado', () => {
    expect(avaliar(termina, new Date('2026-10-03T03:00:00Z'))).toEqual({
      ok: false,
      codigo: 'CERTIFICADO_EXPIRADO',
    });
  });

  it('a data civil não segue UTC: 02:00Z ainda é o dia anterior em São Paulo', () => {
    expect(avaliar(termina, new Date('2026-10-03T02:00:00Z')).ok).toBe(true);
  });

  // naoAntes = 2026-10-04T03:00:00Z = 2026-10-04 00:00 em São Paulo → validoDe = 2026-10-04.
  const comeca = extraido({ naoAntes: new Date('2026-10-04T03:00:00Z') });

  it('a véspera do início ainda não vale, mesmo já sendo o dia seguinte em UTC', () => {
    // 2026-10-04T02:59:59Z = 2026-10-03 23:59:59 em SP
    expect(avaliar(comeca, new Date('2026-10-04T02:59:59Z'))).toEqual({
      ok: false,
      codigo: 'CERTIFICADO_AINDA_NAO_VIGENTE',
    });
  });

  it('no primeiro instante do dia de início (00:00 SP) já vale', () => {
    expect(avaliar(comeca, new Date('2026-10-04T03:00:00Z'))).toMatchObject({ ok: true, validoDe: '2026-10-04' });
  });

  it('expirado de fato e futuro de fato', () => {
    expect(avaliar(extraido({ naoDepois: new Date('2026-01-01T00:00:00Z') }))).toMatchObject({
      codigo: 'CERTIFICADO_EXPIRADO',
    });
    expect(avaliar(extraido({ naoAntes: new Date('2027-01-01T00:00:00Z') }))).toMatchObject({
      codigo: 'CERTIFICADO_AINDA_NAO_VIGENTE',
    });
  });

  it('o resultado não depende do relógio da máquina: só do "agora" recebido', () => {
    const passado = new Date('2026-09-15T12:00:00Z');

    expect(avaliar(extraido({ naoAntes: new Date('2026-09-20T03:00:00Z') }), passado)).toMatchObject({
      codigo: 'CERTIFICADO_AINDA_NAO_VIGENTE',
    });
  });
});

describe('códigos de recusa', () => {
  it('toda recusa devolvida pela avaliação pertence à lista estável', () => {
    const recusas = [
      avaliar(extraido({ oidsDePoliticas: [] })),
      avaliar(extraido({ cnpjsDoTitular: ['45723174000110'] })),
      avaliar(extraido({ naoDepois: new Date('2020-01-01T00:00:00Z') })),
      avaliar(extraido({ naoAntes: new Date('2030-01-01T00:00:00Z') })),
    ];

    for (const recusa of recusas) {
      expect(recusa.ok).toBe(false);
      if (!recusa.ok) expect(CODIGOS_DE_RECUSA_DA_INGESTAO).toContain(recusa.codigo);
    }
  });

  it('a lista não tem códigos repetidos', () => {
    expect(new Set(CODIGOS_DE_RECUSA_DA_INGESTAO).size).toBe(CODIGOS_DE_RECUSA_DA_INGESTAO.length);
  });
});
