import { beforeEach, describe, expect, it, vi } from 'vitest';

const requisitarMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/http', () => ({ requisitar: requisitarMock }));
vi.mock('../importacao/api', () => ({ novoCorrelationId: () => 'correlation-test' }));

import { listarLancamentos } from './api';

describe('listarLancamentos', () => {
  beforeEach(() => vi.clearAllMocks());

  it('omite o estado quando Todos está selecionado', async () => {
    requisitarMock.mockResolvedValue([]);

    await listarLancamentos('empresa-1', '2026-02', '');

    expect(requisitarMock).toHaveBeenCalledWith('/empresas/empresa-1/lancamentos-contabeis?competence=2026-02');
  });

  it('inclui o estado quando há filtro selecionado', async () => {
    requisitarMock.mockResolvedValue([]);

    await listarLancamentos('empresa-1', '2026-02', 'DRAFT');

    expect(requisitarMock).toHaveBeenCalledWith('/empresas/empresa-1/lancamentos-contabeis?competence=2026-02&status=DRAFT');
  });
});
