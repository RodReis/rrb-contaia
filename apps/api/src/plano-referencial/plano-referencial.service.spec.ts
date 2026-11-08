import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ contextoHumano: vi.fn(), query: vi.fn() }));

vi.mock('@contaia/db', async () => {
  const real = await vi.importActual<typeof import('@contaia/db')>('@contaia/db');
  return { ...real, comContextoHumano: mocks.contextoHumano };
});

import { comContextoHumano } from '@contaia/db';
import { PlanoReferencialService } from './plano-referencial.service';

describe('PlanoReferencialService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(comContextoHumano).mockImplementation(async (_pool, _contexto, executar) => executar({ query: mocks.query } as never));
  });

  it('retorna INDETERMINATE quando o catálogo oficial está vazio', async () => {
    mocks.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ id: 'company-1', name: 'Empresa', cnpj: '123' }] });
    const service = new PlanoReferencialService({ instancia: {} } as never);
    const result = await service.consultar({ tenantId: 'tenant-1', usuarioId: 'user-1' }, 'company-1', 2025, 'LUCRO_PRESUMIDO', null);
    expect(result).toMatchObject({ applicability: 'INDETERMINATE', selectedPackageId: null, packages: [] });
  });

  it('não cria rascunho sem pacote oficial curado e coberto', async () => {
    mocks.query.mockResolvedValueOnce({ rows: [{ id: 'company-1' }] }).mockResolvedValueOnce({ rows: [] });
    const service = new PlanoReferencialService({ instancia: {} } as never);
    await expect(service.criarRascunho(
      { tenantId: 'tenant-1', usuarioId: 'user-1' }, 'company-1',
      { calendarYear: 2025, taxRegime: 'LUCRO_PRESUMIDO', specialSituation: null, packageId: 'missing' }, 'corr-1',
    )).rejects.toMatchObject({ codigo: 'REFERENCE_PACKAGE_NOT_FOUND' });
    expect(mocks.query).toHaveBeenCalledTimes(2);
  });

  it('não aceita um pacote disponível que não cobre o exercício solicitado', async () => {
    mocks.query.mockResolvedValueOnce({ rows: [{ id: 'company-1' }] }).mockResolvedValueOnce({ rows: [
      { id: 'pkg-2025', status: 'AVAILABLE', coveredCalendarYears: [2025], coveredSpecialSituations: [], canonicalSha256: 'a'.repeat(64) },
    ] });
    const service = new PlanoReferencialService({ instancia: {} } as never);
    await expect(service.criarRascunho(
      { tenantId: 'tenant-1', usuarioId: 'user-1' }, 'company-1',
      { calendarYear: 2026, taxRegime: 'LUCRO_PRESUMIDO', specialSituation: null, packageId: 'pkg-2025' }, 'corr-1',
    )).rejects.toMatchObject({ codigo: 'REFERENCE_MAPPING_INDETERMINATE' });
    expect(mocks.query).toHaveBeenCalledTimes(2);
  });
});
