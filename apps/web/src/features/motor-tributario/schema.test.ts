import { describe, expect, it } from 'vitest';

import { validarComplementoDaNfe, validarRegra, validarSimulacaoManual } from './schema';

const manual = {
  factDate: '2026-06-15',
  regime: 'LUCRO_PRESUMIDO',
  taxType: 'ICMS',
  operationType: 'VENDA_MERCADORIA',
  baseCents: 10_000,
};

describe('validarSimulacaoManual (contrato do POST /tax-simulations/manual)', () => {
  it('aceita a entrada completa e devolve o corpo exato da API', () => {
    expect(validarSimulacaoManual(manual)).toEqual({ ok: true, dados: manual });
  });

  it('aceita base zero e o maior inteiro seguro', () => {
    expect(validarSimulacaoManual({ ...manual, baseCents: 0 }).ok).toBe(true);
    expect(validarSimulacaoManual({ ...manual, baseCents: Number.MAX_SAFE_INTEGER }).ok).toBe(true);
  });

  it('formulário vazio aponta cada campo com mensagem em PT-BR', () => {
    const resultado = validarSimulacaoManual({ factDate: '', regime: '', taxType: '', operationType: '', baseCents: null });

    expect(resultado).toEqual({
      ok: false,
      erros: {
        factDate: 'Informe a data do fato gerador',
        regime: 'Selecione o regime',
        taxType: 'Selecione o tributo',
        operationType: 'Selecione o tipo de operação',
        baseCents: 'Informe a base de cálculo',
      },
    });
  });

  it.each([
    ['data inexistente', { factDate: '2026-02-30' }, 'factDate', 'Informe uma data válida'],
    ['data em outro formato', { factDate: '15/06/2026' }, 'factDate', 'Informe uma data válida'],
    ['regime fora da lista', { regime: 'MEI' }, 'regime', 'Selecione o regime'],
    ['base negativa', { baseCents: -1 }, 'baseCents', 'Informe a base de cálculo'],
    ['base acima do inteiro seguro', { baseCents: Number.MAX_SAFE_INTEGER + 1 }, 'baseCents', 'Informe a base de cálculo'],
  ])('recusa %s', (_nome, override, campo, mensagem) => {
    const resultado = validarSimulacaoManual({ ...manual, ...override });

    expect(resultado.ok).toBe(false);
    expect(resultado.ok ? null : resultado.erros[campo]).toBe(mensagem);
  });
});

const regra = {
  taxType: 'ICMS',
  regime: 'LUCRO_PRESUMIDO',
  operationType: 'VENDA_MERCADORIA',
  validFrom: '2026-01-01',
  validUntil: '',
  baseReductionBasisPoints: null,
  rateBasisPoints: 1_800,
  source: 'Fixture de teste não oficial',
  fixtureNote: 'Dado de teste não oficial',
};

describe('validarRegra (rascunho do catálogo)', () => {
  it('vigência final vazia vira intervalo aberto (null) e a redução ausente fica nula', () => {
    expect(validarRegra(regra)).toEqual({ ok: true, dados: { ...regra, validUntil: null } });
  });

  it('mantém a vigência final e a redução informadas', () => {
    const resultado = validarRegra({ ...regra, validUntil: '2026-06-30', baseReductionBasisPoints: 3_333 });

    expect(resultado).toEqual({ ok: true, dados: { ...regra, validUntil: '2026-06-30', baseReductionBasisPoints: 3_333 } });
  });

  it('um dia só é vigência válida (limites inclusivos)', () => {
    expect(validarRegra({ ...regra, validFrom: '2026-03-01', validUntil: '2026-03-01' }).ok).toBe(true);
  });

  it('aponta a vigência final anterior à inicial no campo da vigência final', () => {
    const resultado = validarRegra({ ...regra, validFrom: '2026-06-30', validUntil: '2026-01-01' });

    expect(resultado.ok ? null : resultado.erros['validUntil']).toBe('A vigência final não pode ser anterior à inicial');
  });

  it('formulário vazio aponta o que é obrigatório', () => {
    const resultado = validarRegra({
      taxType: '',
      regime: '',
      operationType: '',
      validFrom: '',
      validUntil: '',
      baseReductionBasisPoints: null,
      rateBasisPoints: null,
      source: '  ',
      fixtureNote: '',
    });

    expect(resultado.ok).toBe(false);
    expect(resultado.ok ? [] : Object.keys(resultado.erros).sort()).toEqual([
      'operationType',
      'rateBasisPoints',
      'regime',
      'source',
      'taxType',
      'validFrom',
    ]);
  });

  it('a alíquota fora de 0–100% é recusada, e zero é válido', () => {
    expect(validarRegra({ ...regra, rateBasisPoints: 10_001 }).ok).toBe(false);
    expect(validarRegra({ ...regra, rateBasisPoints: 0 }).ok).toBe(true);
  });

  it('a fonte é obrigatória e limitada a 500 caracteres', () => {
    expect(validarRegra({ ...regra, source: 'x'.repeat(501) }).ok).toBe(false);
    expect(validarRegra({ ...regra, source: 'x'.repeat(500) }).ok).toBe(true);
  });

  it('o aviso de fixture é opcional, mas limitado a 500 caracteres', () => {
    expect(validarRegra({ ...regra, fixtureNote: '' }).ok).toBe(true);
    expect(validarRegra({ ...regra, fixtureNote: 'x'.repeat(501) }).ok).toBe(false);
  });
});

describe('validarComplementoDaNfe (só o que o XML não traz — SPEC-016 §3.6)', () => {
  const sempre = [{ field: 'operationType', reason: 'NOT_IN_XML' }] as const;

  it('exige o tipo de operação, que o XML nunca traz', () => {
    const resultado = validarComplementoDaNfe({ operationType: '', regime: '', itemBases: {} }, sempre);

    expect(resultado).toEqual({ ok: false, erros: { operationType: 'Selecione o tipo de operação' } });
  });

  it('só operação quando o XML já mapeia o regime e traz as bases', () => {
    expect(validarComplementoDaNfe({ operationType: 'VENDA_MERCADORIA', regime: '', itemBases: {} }, sempre)).toEqual({
      ok: true,
      dados: { operationType: 'VENDA_MERCADORIA' },
    });
  });

  it('o regime só é pedido, e só vai no corpo, quando o XML não o mapeia', () => {
    const pendencias = [...sempre, { field: 'regime', reason: 'AMBIGUOUS_IN_XML' }] as const;

    expect(validarComplementoDaNfe({ operationType: 'VENDA_MERCADORIA', regime: '', itemBases: {} }, pendencias)).toEqual({
      ok: false,
      erros: { regime: 'Selecione o regime' },
    });
    expect(validarComplementoDaNfe({ operationType: 'VENDA_MERCADORIA', regime: 'LUCRO_REAL', itemBases: {} }, pendencias)).toEqual({
      ok: true,
      dados: { operationType: 'VENDA_MERCADORIA', regime: 'LUCRO_REAL' },
    });
  });

  it('cada item sem base no XML exige a base em centavos', () => {
    const pendencias = [...sempre, { field: 'itemBases.1', reason: 'NOT_IN_XML' }, { field: 'itemBases.2', reason: 'NOT_IN_XML' }] as const;

    expect(validarComplementoDaNfe({ operationType: 'VENDA_MERCADORIA', regime: '', itemBases: { '1': 25_000, '2': null } }, pendencias)).toEqual({
      ok: false,
      erros: { 'itemBases.2': 'Informe a base de cálculo do item 2' },
    });
    expect(validarComplementoDaNfe({ operationType: 'VENDA_MERCADORIA', regime: '', itemBases: { '1': 25_000, '2': 0 } }, pendencias)).toEqual({
      ok: true,
      dados: { operationType: 'VENDA_MERCADORIA', itemBases: { '1': 25_000, '2': 0 } },
    });
  });

  it('ignora o que o formulário carrega mas a análise não pediu', () => {
    const resultado = validarComplementoDaNfe(
      { operationType: 'VENDA_MERCADORIA', regime: 'LUCRO_REAL', itemBases: { '1': 5 } },
      sempre,
    );

    expect(resultado).toEqual({ ok: true, dados: { operationType: 'VENDA_MERCADORIA' } });
  });
});
