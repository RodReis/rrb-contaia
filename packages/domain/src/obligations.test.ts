import { describe, expect, it } from 'vitest';

import { calcularOcorrencia, calcularVencimento, prioridadeDoAlerta, type RegraDeObrigacao } from './obligations.js';

const regra: RegraDeObrigacao = {
  codigo: 'DAS_SIMPLES', nome: 'DAS do Simples Nacional', versao: 1,
  regimes: ['SIMPLES_NACIONAL'], ufs: [], cnaes: [], periodicidade: 'MENSAL', diaNominal: 20,
  ajustarDiaUtil: 'ANTECEDENTE', exigeFeriadoEstadual: true, exigeFeriadoMunicipal: true,
  dependencias: [], vigenteDe: '2026-01-01', vigenteAte: null,
};
const empresa = { regime: 'SIMPLES_NACIONAL', uf: 'GO', municipio: 'Goiânia', cnaes: [] } as const;

describe('agenda de obrigações F22', () => {
  it('ajusta o dia nominal ao dia útil anterior em fim de semana e feriado local', () => {
    expect(calcularVencimento(regra, '2026-09', [
      { data: '2026-09-18', abrangencia: 'MUNICIPAL', uf: 'GO', municipio: 'Goiânia' },
    ], empresa)).toEqual({ nominal: '2026-09-20', ajustado: '2026-09-17' });
  });

  it('não presume prazo quando falta a localidade exigida', () => {
    expect(calcularOcorrencia({ regra, competencia: '2026-09', referencia: '2026-09-17', empresa: { ...empresa, municipio: null }, feriados: [], estadosDasDependencias: {} }))
      .toMatchObject({ estado: 'COBERTURA_INCOMPLETA', vencimentoAjustado: null });
  });

  it('não gera obrigação para regime incompatível', () => {
    expect(calcularOcorrencia({ regra, competencia: '2026-09', referencia: '2026-09-01', empresa: { ...empresa, regime: 'LUCRO_REAL' }, feriados: [], estadosDasDependencias: {} }))
      .toMatchObject({ estado: 'NAO_EXIGIVEL' });
  });

  it('marca dependência pendente sem ocultar a ocorrência e calcula alerta evolutivo', () => {
    const dependente = { ...regra, dependencias: ['ENTREGA_ANTERIOR'] };
    expect(calcularOcorrencia({ regra: dependente, competencia: '2026-09', referencia: '2026-09-17', empresa, feriados: [], coberturaEstadualCompleta: true, coberturaMunicipalCompleta: true, estadosDasDependencias: {} }))
      .toMatchObject({ estado: 'BLOQUEADA_POR_DEPENDENCIA', dependenciasPendentes: ['ENTREGA_ANTERIOR'] });
    expect(prioridadeDoAlerta('2026-09-20', '2026-09-17')).toBe('ALTA');
    expect(prioridadeDoAlerta('2026-09-20', '2026-09-20')).toBe('CRITICA');
    expect(prioridadeDoAlerta('2026-09-20', '2026-09-16')).toBeNull();
  });

  it('não presume que um calendário sem registros esteja completo', () => {
    expect(calcularOcorrencia({ regra, competencia: '2026-09', referencia: '2026-09-17', empresa, feriados: [], estadosDasDependencias: {} }))
      .toMatchObject({ estado: 'COBERTURA_INCOMPLETA', vencimentoAjustado: null });
  });
});
