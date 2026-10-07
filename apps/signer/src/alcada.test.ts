import { describe, expect, it } from 'vitest';

import { ALCADAS, OPERACOES, identidadeDoSan, permitido } from './alcada.js';

describe('alçadas técnicas (SPEC-012 §3.1)', () => {
  it('o worker assina e executa mTLS; a API não', () => {
    expect(permitido('worker', 'assinar')).toBe(true);
    expect(permitido('worker', 'executar-mtls')).toBe(true);
    expect(permitido('api', 'assinar')).toBe(false);
    expect(permitido('api', 'executar-mtls')).toBe(false);
  });

  it('a API consulta saúde, estados e histórico e pode diagnosticar', () => {
    for (const operacao of ['saude', 'estados', 'historico', 'diagnosticar'] as const) {
      expect(permitido('api', operacao)).toBe(true);
    }
  });

  it('o worker não consulta estados nem histórico', () => {
    expect(permitido('worker', 'estados')).toBe(false);
    expect(permitido('worker', 'historico')).toBe(false);
  });

  it('a identidade do próprio Signer só serve para a verificação de saúde', () => {
    expect(ALCADAS.signer).toEqual(['saude']);
  });

  it('toda operação conhecida é permitida a pelo menos uma identidade', () => {
    for (const operacao of OPERACOES) {
      expect(Object.values(ALCADAS).some((operacoes) => operacoes.includes(operacao))).toBe(true);
    }
  });
});

describe('identidadeDoSan: só o URN de serviço conhecido vale', () => {
  it('lê o URN exato da API, do worker e do Signer', () => {
    expect(identidadeDoSan('URI:urn:contaia:servico:api')).toBe('api');
    expect(identidadeDoSan('DNS:signer, URI:urn:contaia:servico:signer')).toBe('signer');
    expect(identidadeDoSan('URI:urn:contaia:servico:worker')).toBe('worker');
  });

  it.each([
    undefined,
    '',
    'DNS:api',
    'URI:urn:contaia:servico:intruso',
    'URI:urn:contaia:servico:api2',
    'URI:https://evil.example/urn:contaia:servico:api',
    // Dois URNs: ambíguo, recusa (nunca escolhe um).
    'URI:urn:contaia:servico:api, URI:urn:contaia:servico:worker',
  ])('recusa SAN sem identidade válida: %s', (san) => {
    expect(identidadeDoSan(san)).toBeNull();
  });
});
