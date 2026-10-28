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
});
