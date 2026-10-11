/**
 * Fila de validação dos empregados (SPEC-014 §6.4): fila própria, o mesmo contrato de comando da
 * F13 (só ids e `correlationId`), id de job determinístico e falha fechada sem Redis.
 */
import { FILA_DE_VALIDACAO_EMPREGADOS, idDoJobDeValidacao } from '@contaia/shared';
import { describe, expect, it, vi } from 'vitest';

import { enfileirarValidacao } from '../importacao/fila';
import { JOB_DE_VALIDACAO_DOS_EMPREGADOS, criarFilaDeValidacaoDosEmpregados } from './empregados.fila';

const COMANDO = {
  tenantId: '0198f3c2-0000-7000-8000-000000000001',
  empresaId: '0198f3c2-0000-7000-8000-000000000002',
  tentativaId: '0198f3c2-0000-7000-8000-000000000003',
  correlationId: 'corr-fila-emp-1',
} as const;

describe('fila dos empregados', () => {
  it('enfileira o comando validado com o job dos empregados e o id determinístico', async () => {
    const fila = { add: vi.fn().mockResolvedValue({}), getJob: vi.fn().mockResolvedValue(undefined) };

    await enfileirarValidacao(fila, COMANDO, undefined, JOB_DE_VALIDACAO_DOS_EMPREGADOS);

    expect(fila.add).toHaveBeenCalledWith(
      'validar-importacao',
      COMANDO,
      expect.objectContaining({ jobId: idDoJobDeValidacao(COMANDO.tentativaId), attempts: 5 }),
    );
  });

  it('comando com dado a mais (ex.: CPF) é recusado antes de sair do processo', async () => {
    const fila = { add: vi.fn(), getJob: vi.fn() };

    await expect(
      enfileirarValidacao(fila, { ...COMANDO, cpf: '52998224725' } as never, undefined, JOB_DE_VALIDACAO_DOS_EMPREGADOS),
    ).rejects.toThrow();
    expect(fila.add).not.toHaveBeenCalled();
  });

  it('sem REDIS_URL toda tentativa de enfileirar falha, sem rede', async () => {
    const fila = criarFilaDeValidacaoDosEmpregados({});

    await expect(fila.enfileirar(COMANDO)).rejects.toThrow(/REDIS_URL/u);
    await expect(fila.onModuleDestroy()).resolves.toBeUndefined();
  });

  it('usa a fila própria dos empregados', () => {
    expect(FILA_DE_VALIDACAO_EMPREGADOS).toBe('empregados-validacao');
  });
});
