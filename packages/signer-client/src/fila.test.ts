import { describe, expect, it } from 'vitest';

import {
  FILA_DE_DIAGNOSTICO,
  FILA_DE_DIAGNOSTICO_MORTA,
  INTERVALO_DO_MONITOR_MS,
  OPCOES_DO_DIAGNOSTICO,
  conexaoDoRedis,
  idDoJobDeDiagnostico,
} from './fila.js';

const TENANT = '0198f3c2-0000-7000-8000-000000000001';
const EMPRESA = '0198f3c2-0000-7000-8000-000000000002';

describe('filas do Signer (SPEC-012 §3.8–§3.10)', () => {
  it('a fila morta é distinta da principal', () => {
    expect(FILA_DE_DIAGNOSTICO).not.toBe(FILA_DE_DIAGNOSTICO_MORTA);
  });

  it('o monitor verifica a cada minuto', () => {
    expect(INTERVALO_DO_MONITOR_MS).toBe(60_000);
  });

  it('o diagnóstico tem retry com backoff exponencial e teto; falha final fica retida (DLQ)', () => {
    expect(OPCOES_DO_DIAGNOSTICO).toMatchObject({
      attempts: 5,
      backoff: { type: 'exponential' },
      removeOnFail: false,
    });
  });

  it('o id do job dedupica: o mesmo diagnóstico (correlação e finalidade) não é enfileirado duas vezes', () => {
    const base = { tenantId: TENANT, empresaId: EMPRESA, correlationId: 'corr-0001-abcd', origem: 'AUTOMATICO' as const };

    expect(idDoJobDeDiagnostico({ ...base, finalidade: 'DFE_TESTE' })).toBe(idDoJobDeDiagnostico({ ...base, finalidade: 'DFE_TESTE' }));
    expect(idDoJobDeDiagnostico({ ...base, finalidade: 'DFE_TESTE' })).not.toBe(
      idDoJobDeDiagnostico({ ...base, finalidade: 'ESOCIAL_TESTE' }),
    );
    expect(idDoJobDeDiagnostico({ ...base, finalidade: 'DFE_TESTE' })).not.toBe(
      idDoJobDeDiagnostico({ ...base, correlationId: 'corr-0002-abcd', finalidade: 'DFE_TESTE' }),
    );
  });

  it('o id do job só usa o alfabeto seguro (BullMQ rejeita ":" no id)', () => {
    const id = idDoJobDeDiagnostico({
      tenantId: TENANT,
      empresaId: EMPRESA,
      finalidade: 'DFE_TESTE',
      correlationId: 'corr-0001-abcd',
      origem: 'MANUAL',
    });

    expect(id).toMatch(/^[A-Za-z0-9._-]+$/u);
  });

  it('a URL do Redis vira opções de conexão sem depender de ioredis', () => {
    expect(conexaoDoRedis('redis://redis:6379')).toEqual({ host: 'redis', port: 6379 });
    expect(conexaoDoRedis('redis://127.0.0.1:26379')).toEqual({ host: '127.0.0.1', port: 26379 });
    expect(conexaoDoRedis('redis://:segredo@redis:6380/2')).toEqual({ host: 'redis', port: 6380, password: 'segredo', db: 2 });
  });

  it('URL de Redis inválida falha fechada', () => {
    expect(() => conexaoDoRedis('http://redis:6379')).toThrow(/REDIS_URL/u);
    expect(() => conexaoDoRedis('')).toThrow(/REDIS_URL/u);
  });
});
