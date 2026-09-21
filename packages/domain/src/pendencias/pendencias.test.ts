import { describe, expect, it } from 'vitest';
import {
  causasCadastrais,
  causasDocumentais,
  prioridadeDaPendencia,
  reconciliarPendencias,
} from './pendencias.js';

describe('causasCadastrais', () => {
  it('nao gera causa para campo preenchido e valido', () => {
    const causas = causasCadastrais([{ chave: 'campo:razaoSocial', preenchido: true, valido: true }]);
    expect(causas).toHaveLength(0);
  });

  it('gera CAMPO_AUSENTE para campo obrigatorio nao preenchido', () => {
    const causas = causasCadastrais([{ chave: 'campo:cnae', preenchido: false, valido: true }]);
    expect(causas).toEqual([
      { origem: 'CADASTRAL', tipo: 'CAMPO_AUSENTE', chave: 'campo:cnae', dataLimite: null },
    ]);
  });

  it('gera CAMPO_INVALIDO para campo preenchido porem invalido', () => {
    const causas = causasCadastrais([{ chave: 'campo:cep', preenchido: true, valido: false }]);
    expect(causas).toEqual([
      { origem: 'CADASTRAL', tipo: 'CAMPO_INVALIDO', chave: 'campo:cep', dataLimite: null },
    ]);
  });
});

describe('causasDocumentais', () => {
  const agora = new Date('2026-09-21T12:00:00-03:00');

  it('gera DOCUMENTO_AUSENTE para exigencia do checklist padrao pendente', () => {
    const causas = causasDocumentais(
      [{ id: 'e1', estado: 'PENDENTE', dataLimite: null, validade: null, codigo: 'CARTAO_CNPJ' }],
      agora,
    );
    expect(causas).toEqual([
      { origem: 'DOCUMENTAL', tipo: 'DOCUMENTO_AUSENTE', chave: 'exigencia:e1', dataLimite: null },
    ]);
  });

  it('gera EXIGENCIA_ESPECIFICA para exigencia especifica pendente', () => {
    const causas = causasDocumentais(
      [{ id: 'e2', estado: 'PENDENTE', dataLimite: '2026-10-01', validade: null, codigo: null }],
      agora,
    );
    expect(causas).toEqual([
      { origem: 'DOCUMENTAL', tipo: 'EXIGENCIA_ESPECIFICA', chave: 'exigencia:e2', dataLimite: '2026-10-01' },
    ]);
  });

  it('gera DOCUMENTO_REJEITADO para exigencia rejeitada', () => {
    const causas = causasDocumentais(
      [{ id: 'e3', estado: 'REJEITADO', dataLimite: null, validade: null, codigo: 'CARTAO_CNPJ' }],
      agora,
    );
    expect(causas[0]?.tipo).toBe('DOCUMENTO_REJEITADO');
  });

  it('gera DOCUMENTO_VENCIDO para aprovado com validade no passado', () => {
    const causas = causasDocumentais(
      [{ id: 'e4', estado: 'APROVADO', dataLimite: null, validade: '2026-01-01', codigo: 'ALVARA_DE_FUNCIONAMENTO' }],
      agora,
    );
    expect(causas[0]?.tipo).toBe('DOCUMENTO_VENCIDO');
  });

  it('nao gera causa para aprovado com validade futura, enviado ou dispensado', () => {
    const causas = causasDocumentais(
      [
        { id: 'e5', estado: 'APROVADO', dataLimite: null, validade: '2030-01-01', codigo: 'CARTAO_CNPJ' },
        { id: 'e6', estado: 'ENVIADO', dataLimite: null, validade: null, codigo: 'CARTAO_CNPJ' },
        { id: 'e7', estado: 'DISPENSADO', dataLimite: null, validade: null, codigo: null },
      ],
      agora,
    );
    expect(causas).toHaveLength(0);
  });
});

describe('reconciliarPendencias', () => {
  it('abre causa nova que nao esta no banco', () => {
    const resultado = reconciliarPendencias(
      [{ origem: 'DOCUMENTAL', tipo: 'DOCUMENTO_AUSENTE', chave: 'exigencia:e1', dataLimite: null }],
      [],
    );
    expect(resultado.paraAbrir).toHaveLength(1);
    expect(resultado.paraResolver).toHaveLength(0);
  });

  it('nao duplica causa que ja esta aberta com a mesma chave', () => {
    const resultado = reconciliarPendencias(
      [{ origem: 'DOCUMENTAL', tipo: 'DOCUMENTO_AUSENTE', chave: 'exigencia:e1', dataLimite: null }],
      [{ chave: 'exigencia:e1' }],
    );
    expect(resultado.paraAbrir).toHaveLength(0);
    expect(resultado.paraResolver).toHaveLength(0);
  });

  it('resolve pendencia aberta cuja causa sumiu', () => {
    const resultado = reconciliarPendencias([], [{ chave: 'exigencia:e1' }]);
    expect(resultado.paraAbrir).toHaveLength(0);
    expect(resultado.paraResolver).toEqual(['exigencia:e1']);
  });

  it('processamento repetido da mesma causa e idempotente', () => {
    const causas = [
      { origem: 'CADASTRAL' as const, tipo: 'CAMPO_AUSENTE' as const, chave: 'campo:cnae', dataLimite: null },
    ];
    const primeira = reconciliarPendencias(causas, []);
    const segunda = reconciliarPendencias(causas, [{ chave: 'campo:cnae' }]);
    expect(primeira.paraAbrir).toHaveLength(1);
    expect(segunda.paraAbrir).toHaveLength(0);
  });
});

describe('prioridadeDaPendencia', () => {
  const hoje = '2026-09-21';

  it('prazo vencido tem prioridade maxima', () => {
    const p = prioridadeDaPendencia(
      { tipo: 'EXIGENCIA_ESPECIFICA', dataLimite: '2026-09-01', criadoEm: '2026-08-01T00:00:00Z' },
      hoje,
    );
    expect(p).toBe(0);
  });

  it('documento vencido vem antes de rejeitado', () => {
    const vencido = prioridadeDaPendencia(
      { tipo: 'DOCUMENTO_VENCIDO', dataLimite: null, criadoEm: '2026-08-01T00:00:00Z' },
      hoje,
    );
    const rejeitado = prioridadeDaPendencia(
      { tipo: 'DOCUMENTO_REJEITADO', dataLimite: null, criadoEm: '2026-08-01T00:00:00Z' },
      hoje,
    );
    expect(vencido).toBeLessThan(rejeitado);
  });

  it('item que vence em ate tres dias fica antes das demais', () => {
    const proximo = prioridadeDaPendencia(
      { tipo: 'EXIGENCIA_ESPECIFICA', dataLimite: '2026-09-23', criadoEm: '2026-08-01T00:00:00Z' },
      hoje,
    );
    const semPrazo = prioridadeDaPendencia(
      { tipo: 'CAMPO_AUSENTE', dataLimite: null, criadoEm: '2026-08-01T00:00:00Z' },
      hoje,
    );
    expect(proximo).toBeLessThan(semPrazo);
  });
});
