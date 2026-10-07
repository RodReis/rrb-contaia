import { describe, expect, it } from 'vitest';

import { CODIGOS_DE_ERRO, ErroDeDominio } from '../erros.js';
import {
  FINALIDADES_DE_SERVICO,
  contextoDeServico,
  parametrosDeSessao,
} from './contexto-de-acesso.js';

const recusado = (acao: () => unknown): void => {
  try {
    acao();
  } catch (erro) {
    expect(erro).toBeInstanceOf(ErroDeDominio);
    expect((erro as ErroDeDominio).codigo).toBe(CODIGOS_DE_ERRO.CONTEXTO_DE_ACESSO_INVALIDO);
    return;
  }
  throw new Error('o contexto de serviço inválido foi aceito');
};

describe('contexto de serviço (SPEC-012 §3.10: monitor global sem tenant)', () => {
  it('a única finalidade de serviço é o monitoramento do Signer', () => {
    expect([...FINALIDADES_DE_SERVICO]).toEqual(['MONITORAMENTO_DO_SIGNER']);
  });

  it('nasce com identidade, finalidade e correlationId — e sem tenant, empresa nem usuário', () => {
    const contexto = contextoDeServico({
      identidadeTecnica: 'workers-monitor-signer',
      finalidade: 'MONITORAMENTO_DO_SIGNER',
      correlationId: 'monitor-0001',
    });

    expect(contexto).toEqual({
      origem: 'SERVICO',
      identidadeTecnica: 'workers-monitor-signer',
      finalidade: 'MONITORAMENTO_DO_SIGNER',
      correlationId: 'monitor-0001',
    });
    expect(parametrosDeSessao(contexto)).toEqual({
      'app.tenant_id': '',
      'app.origem': 'SERVICO',
      'app.usuario_id': '',
      'app.empresa_id': '',
      'app.finalidade': 'MONITORAMENTO_DO_SIGNER',
      'app.identidade_tecnica': 'workers-monitor-signer',
      'app.correlation_id': 'monitor-0001',
      'app.empresa_em_criacao': '',
    });
  });

  it('recusa finalidade que não é de serviço', () => {
    recusado(() =>
      contextoDeServico({
        identidadeTecnica: 'x',
        finalidade: 'PROCESSAMENTO_DE_EMPRESA' as never,
        correlationId: 'y',
      }),
    );
  });

  it.each(['', '   ', 'x'.repeat(129)])('recusa identidade ou correlationId inválidos: %j', (valor) => {
    recusado(() =>
      contextoDeServico({
        identidadeTecnica: valor,
        finalidade: 'MONITORAMENTO_DO_SIGNER',
        correlationId: 'y',
      }),
    );
    recusado(() =>
      contextoDeServico({
        identidadeTecnica: 'x',
        finalidade: 'MONITORAMENTO_DO_SIGNER',
        correlationId: valor,
      }),
    );
  });
});
