import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ contextoHumano: vi.fn(), query: vi.fn() }));

vi.mock('@contaia/db', async () => {
  const real = await vi.importActual<typeof import('@contaia/db')>('@contaia/db');
  return { ...real, comContextoHumano: mocks.contextoHumano };
});

import { CatalogoContabilService } from './catalogo-contabil.service';
import { comContextoHumano } from '@contaia/db';

describe('CatalogoContabilService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(comContextoHumano).mockImplementation(async (_pool, _contexto, executar) => executar({ query: mocks.query } as never));
  });

  it('registra recusa sem consultar empresa invisível por RLS', async () => {
    const service = new CatalogoContabilService({ instancia: {} } as never);
    mocks.query.mockResolvedValue({ rows: [] });

    await service.registrarTentativaNegada(
      { tenantId: 'tenant-1', usuarioId: 'user-1' },
      'company-1',
      'CONTA',
      '1.1',
      'corr-1',
      'ACCOUNTING_CATALOG_FORBIDDEN',
    );

    expect(mocks.query).toHaveBeenCalledTimes(1);
    expect(String(mocks.query.mock.calls[0]?.[0])).toMatch(/^insert into app\.catalogo_contabil_evento/iu);
  });

  it('bloqueia salvar filha quando a classe diverge do pai', async () => {
    const service = new CatalogoContabilService({ instancia: {} } as never);
    mocks.query.mockResolvedValueOnce({ rows: [{ id: 'company-1' }] }).mockResolvedValueOnce({ rows: [
      { code: '1', parentCode: null, type: 'SYNTHETIC', archived: false, accountClass: 'ASSET' },
    ] });

    await expect(service.salvarConta(
      { tenantId: 'tenant-1', usuarioId: 'user-1' },
      'company-1',
      '1.1',
      { code: '1.1', name: 'Conta filha', type: 'ANALYTICAL', parentCode: '1', accountClass: 'EXPENSE', normalBalance: 'DEBIT', costCenterPolicy: 'OPTIONAL' },
      'corr-1',
    )).rejects.toMatchObject({ codigo: 'ACCOUNTING_ACCOUNT_HIERARCHY_INCOMPATIBLE' });
    expect(mocks.query).toHaveBeenCalledTimes(2);
  });
});
