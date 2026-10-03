import { describe, expect, it } from 'vitest';

import { CODIGOS_DE_ERRO, ErroDeDominio } from '../erros.js';
import {
  FINALIDADES_ADMINISTRATIVAS,
  FINALIDADES_HUMANAS,
  FINALIDADES_TECNICAS,
  contextoHumano,
  contextoTecnico,
  parametrosDeSessao,
  trocarFinalidade,
} from './contexto-de-acesso.js';

const TENANT = '0197a1b2-0000-7000-8000-000000000001';
const USUARIO = '0197a1b2-0000-7000-8000-000000000002';
const EMPRESA = '0197a1b2-0000-7000-8000-000000000003';

const invalido = (acao: () => unknown): void => {
  try {
    acao();
  } catch (erro) {
    expect(erro).toBeInstanceOf(ErroDeDominio);
    expect((erro as ErroDeDominio).codigo).toBe(CODIGOS_DE_ERRO.CONTEXTO_DE_ACESSO_INVALIDO);
    return;
  }
  throw new Error('o contexto inválido foi aceito');
};

describe('contexto humano', () => {
  it('nasce comum, com tenant e usuário', () => {
    expect(contextoHumano({ tenantId: TENANT, usuarioId: USUARIO })).toEqual({
      origem: 'HUMANA',
      tenantId: TENANT,
      usuarioId: USUARIO,
      finalidade: 'COMUM',
      correlationId: null,
    });
  });

  it('aceita finalidade administrativa só pelo construtor explícito', () => {
    const contexto = contextoHumano({
      tenantId: TENANT,
      usuarioId: USUARIO,
      finalidade: 'ADMIN_ACESSO',
      correlationId: 'req-1',
    });

    expect(contexto.finalidade).toBe('ADMIN_ACESSO');
    expect(contexto.correlationId).toBe('req-1');
  });

  it.each([
    ['tenant ausente', { tenantId: '', usuarioId: USUARIO }],
    ['tenant que não é uuid', { tenantId: "x'; drop table app.tenant;--", usuarioId: USUARIO }],
    ['usuário ausente', { tenantId: TENANT, usuarioId: '' }],
    ['usuário que não é uuid', { tenantId: TENANT, usuarioId: 'abc' }],
  ])('recusa %s', (_nome, entrada) => {
    invalido(() => contextoHumano(entrada));
  });

  it('recusa finalidade técnica na origem humana', () => {
    invalido(() =>
      contextoHumano({
        tenantId: TENANT,
        usuarioId: USUARIO,
        finalidade: 'PROCESSAMENTO_DE_EMPRESA' as never,
      }),
    );
  });

  it('recusa finalidade desconhecida', () => {
    invalido(() =>
      contextoHumano({ tenantId: TENANT, usuarioId: USUARIO, finalidade: 'QUALQUER' as never }),
    );
  });
});

describe('contexto técnico', () => {
  const base = {
    identidadeTecnica: 'worker-captura',
    finalidade: 'PROCESSAMENTO_DE_EMPRESA',
    tenantId: TENANT,
    empresaId: EMPRESA,
    correlationId: 'job-42',
  } as const;

  it('exige identidade, finalidade, tenant, empresa e correlationId', () => {
    expect(contextoTecnico(base)).toEqual({ origem: 'TECNICA', ...base });
  });

  it.each([
    ['sem identidade técnica', { identidadeTecnica: '' }],
    ['sem tenant', { tenantId: '' }],
    ['sem empresa', { empresaId: '' }],
    ['empresa que não é uuid', { empresaId: 'todas' }],
    ['sem correlationId', { correlationId: '' }],
    ['finalidade humana', { finalidade: 'COMUM' as never }],
    ['finalidade desconhecida', { finalidade: 'BYPASS' as never }],
  ])('recusa job %s', (_nome, troca) => {
    invalido(() => contextoTecnico({ ...base, ...troca }));
  });

  it('não existe finalidade técnica administrativa', () => {
    for (const finalidade of FINALIDADES_TECNICAS) {
      expect(FINALIDADES_HUMANAS).not.toContain(finalidade);
    }
  });
});

describe('troca de finalidade dentro da transação', () => {
  it('só um contexto humano pode ser elevado, e só às finalidades humanas', () => {
    const comum = contextoHumano({ tenantId: TENANT, usuarioId: USUARIO });

    expect(trocarFinalidade(comum, 'ADMIN_ACESSO').finalidade).toBe('ADMIN_ACESSO');
    expect(comum.finalidade).toBe('COMUM');
    invalido(() => trocarFinalidade(comum, 'PROCESSAMENTO_DE_EMPRESA' as never));
  });

  it('contexto técnico não troca de finalidade', () => {
    const tecnico = contextoTecnico({
      identidadeTecnica: 'w',
      finalidade: 'PROCESSAMENTO_DE_EMPRESA',
      tenantId: TENANT,
      empresaId: EMPRESA,
      correlationId: 'c',
    });

    invalido(() => trocarFinalidade(tecnico, 'ADMIN_ACESSO'));
  });
});

describe('parâmetros de sessão', () => {
  it('humano: preenche usuário e zera o recorte técnico', () => {
    const parametros = parametrosDeSessao(
      contextoHumano({ tenantId: TENANT, usuarioId: USUARIO, correlationId: 'r1' }),
    );

    expect(parametros).toEqual({
      'app.tenant_id': TENANT,
      'app.origem': 'HUMANA',
      'app.usuario_id': USUARIO,
      'app.empresa_id': '',
      'app.finalidade': 'COMUM',
      'app.identidade_tecnica': '',
      'app.correlation_id': 'r1',
    });
  });

  it('técnico: preenche empresa e zera o usuário', () => {
    const parametros = parametrosDeSessao(
      contextoTecnico({
        identidadeTecnica: 'w',
        finalidade: 'PROCESSAMENTO_DE_EMPRESA',
        tenantId: TENANT,
        empresaId: EMPRESA,
        correlationId: 'c',
      }),
    );

    expect(parametros['app.usuario_id']).toBe('');
    expect(parametros['app.empresa_id']).toBe(EMPRESA);
    expect(parametros['app.origem']).toBe('TECNICA');
  });
});

describe('finalidades administrativas', () => {
  it('são humanas, enumeradas e distintas da comum', () => {
    expect(FINALIDADES_ADMINISTRATIVAS).toEqual(['ADMIN_ACESSO', 'LOCALIZACAO_BASICA_EMPRESA']);
    for (const finalidade of FINALIDADES_ADMINISTRATIVAS) {
      expect(FINALIDADES_HUMANAS).toContain(finalidade);
      expect(finalidade).not.toBe('COMUM');
    }
  });
});
