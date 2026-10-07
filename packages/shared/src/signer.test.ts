import { CODIGOS_DE_ERRO, FINALIDADES as FINALIDADES_DO_DOMINIO } from '@contaia/domain';
import { describe, expect, it } from 'vitest';

import {
  ComandoAssinarSchema,
  ComandoDiagnosticarSchema,
  ComandoExecutarMtlsSchema,
  ConsultaHistoricoSchema,
  ConsultaEstadosSchema,
  FINALIDADES,
  ITENS_POR_PAGINA_DO_HISTORICO,
  VERSAO_DO_CONTRATO_DO_SIGNER,
} from './signer.js';

const UUID_A = '0198f3c2-0000-7000-8000-000000000001';
const UUID_B = '0198f3c2-0000-7000-8000-000000000002';

const contexto = {
  tenantId: UUID_A,
  empresaId: UUID_B,
  finalidade: 'DFE_TESTE',
  chaveIdempotente: 'chave-de-teste-0001',
  correlationId: 'corr-0001-abcd',
} as const;

const CAMPOS_PROIBIDOS = /url|host|porta|vault|pkcs12|senha|token|chave_?privada|certificado/iu;

const camposDe = (schema: { shape: Record<string, unknown> }): string[] => Object.keys(schema.shape);

describe('contrato do Signer alinhado ao domínio', () => {
  it('as finalidades são as mesmas nos dois pacotes', () => {
    expect([...FINALIDADES]).toEqual([...FINALIDADES_DO_DOMINIO]);
  });

  it('o contrato é versionado e o histórico pagina de 15 em 15', () => {
    expect(VERSAO_DO_CONTRATO_DO_SIGNER).toBe('v1');
    expect(ITENS_POR_PAGINA_DO_HISTORICO).toBe(15);
  });

  it('todo código SIGNER_* usado no contrato existe como código de erro estável', () => {
    const codigos = Object.values(CODIGOS_DE_ERRO) as string[];

    expect(codigos.filter((codigo) => codigo.startsWith('SIGNER_')).length).toBeGreaterThanOrEqual(15);
  });
});

describe('nenhum DTO aceita URL, caminho do Vault, PKCS#12, senha, chave ou token (SPEC-012 §6.2)', () => {
  it.each([
    ['assinar', ComandoAssinarSchema],
    ['executar mTLS', ComandoExecutarMtlsSchema],
    ['diagnosticar', ComandoDiagnosticarSchema],
    ['consultar estados', ConsultaEstadosSchema],
    ['consultar histórico', ConsultaHistoricoSchema],
  ])('o comando %s não declara campo proibido', (_nome, schema) => {
    for (const campo of camposDe(schema)) {
      expect(campo).not.toMatch(CAMPOS_PROIBIDOS);
    }
  });

  it('recusa campo extra, como uma URL informada pelo chamador', () => {
    const resultado = ComandoExecutarMtlsSchema.safeParse({
      ...contexto,
      xml: '<NFe/>',
      url: 'https://evil.example/',
    });

    expect(resultado.success).toBe(false);
  });

  it('recusa finalidade livre', () => {
    const resultado = ComandoAssinarSchema.safeParse({ ...contexto, finalidade: 'LIVRE', xml: '<a/>' });

    expect(resultado.success).toBe(false);
  });
});

describe('comandos operacionais', () => {
  it('aceita assinatura com contexto completo', () => {
    expect(ComandoAssinarSchema.safeParse({ ...contexto, xml: '<infNFe Id="NFe1"/>' }).success).toBe(true);
  });

  it('exige tenant, empresa e chave idempotente', () => {
    for (const faltando of ['tenantId', 'empresaId', 'chaveIdempotente', 'correlationId'] as const) {
      const resto: Record<string, unknown> = { ...contexto };
      delete resto[faltando];

      expect(ComandoAssinarSchema.safeParse({ ...resto, xml: '<a/>' }).success).toBe(false);
    }
  });

  it('recusa XML vazio e XML acima do limite', () => {
    expect(ComandoAssinarSchema.safeParse({ ...contexto, xml: '' }).success).toBe(false);
    expect(ComandoAssinarSchema.safeParse({ ...contexto, xml: 'x'.repeat(1_048_577) }).success).toBe(false);
  });

  it('diagnóstico não recebe XML: o Signer usa o seu próprio de teste', () => {
    const semChave: Record<string, unknown> = { ...contexto };
    delete semChave.chaveIdempotente;
    const valido = ComandoDiagnosticarSchema.safeParse({ ...semChave, origem: 'MANUAL' });

    expect(valido.success).toBe(true);
    expect(ComandoDiagnosticarSchema.safeParse({ ...semChave, origem: 'MANUAL', xml: '<a/>' }).success).toBe(
      false,
    );
  });

  it('estados em lote aceitam de 1 a 50 empresas', () => {
    const base = { tenantId: UUID_A, correlationId: 'corr-0001-abcd' };
    const empresas = (n: number): string[] =>
      Array.from({ length: n }, (_, i) => `0198f3c2-0000-7000-8000-${String(i).padStart(12, '0')}`);

    expect(ConsultaEstadosSchema.safeParse({ ...base, empresaIds: empresas(1) }).success).toBe(true);
    expect(ConsultaEstadosSchema.safeParse({ ...base, empresaIds: empresas(50) }).success).toBe(true);
    expect(ConsultaEstadosSchema.safeParse({ ...base, empresaIds: [] }).success).toBe(false);
    expect(ConsultaEstadosSchema.safeParse({ ...base, empresaIds: empresas(51) }).success).toBe(false);
  });

  it('o histórico filtra por finalidade e resultado e começa na página 1', () => {
    const base = { tenantId: UUID_A, empresaId: UUID_B, correlationId: 'corr-0001-abcd' };

    expect(ConsultaHistoricoSchema.safeParse({ ...base, pagina: 1 }).success).toBe(true);
    expect(
      ConsultaHistoricoSchema.safeParse({ ...base, pagina: 2, finalidade: 'ESOCIAL_TESTE', resultado: 'FALHA' })
        .success,
    ).toBe(true);
    expect(ConsultaHistoricoSchema.safeParse({ ...base, pagina: 0 }).success).toBe(false);
    // Sem tenant o contexto de RLS não abre: a consulta é recusada, nunca ampliada.
    expect(ConsultaHistoricoSchema.safeParse({ empresaId: UUID_B, pagina: 1, correlationId: 'corr-0001-abcd' }).success).toBe(false);
  });
});
