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
    mocks.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ id: 'company-1', name: 'Empresa', cnpj: '123' }] }).mockResolvedValueOnce({ rows: [] });
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

  it('atualiza decisões do rascunho com revisão otimista e trilha append-only', async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [{ id: 'mapping-1', packageId: 'pkg-2025', revision: 2, status: 'DRAFT' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'account-1', code: '1.1', nature: 'devedora', eligible: true, complete: true }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ code: '1.01', sourceNature: 'DEBIT', status: 'ACTIVE' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const service = new PlanoReferencialService({ instancia: {} } as never);
    const result = await service.atualizarDecisoes({ tenantId: 'tenant-1', usuarioId: 'user-1' }, 'company-1', 'mapping-1', 2,
      [{ accountCode: '1.1', centerCode: null, kind: 'MAPPED', referenceCode: '1.01', reason: null }], 'corr-1');
    expect(result).toMatchObject({ mappingId: 'mapping-1', revision: 3, decisions: 1, status: 'DRAFT' });
    expect(mocks.query).toHaveBeenCalledTimes(8);
    expect(mocks.query.mock.calls[4]?.[0]).toContain('set active=false');
    expect(mocks.query.mock.calls[7]?.[0]).toContain('DRAFT_DECISIONS_UPDATED');
  });

  it('não altera decisões quando a natureza referencial diverge', async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [{ id: 'mapping-1', packageId: 'pkg-2025', revision: 0, status: 'DRAFT' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'account-1', code: '1.1', nature: 'devedora', eligible: true, complete: true }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ code: '2.01', sourceNature: 'CREDIT', status: 'ACTIVE' }] });
    const service = new PlanoReferencialService({ instancia: {} } as never);
    await expect(service.atualizarDecisoes({ tenantId: 'tenant-1', usuarioId: 'user-1' }, 'company-1', 'mapping-1', 0,
      [{ accountCode: '1.1', centerCode: null, kind: 'MAPPED', referenceCode: '2.01', reason: null }], 'corr-1'))
      .rejects.toMatchObject({ codigo: 'REFERENCE_ACCOUNT_NATURE_MISMATCH' });
    expect(mocks.query).toHaveBeenCalledTimes(4);
  });

  it('bloqueia publicação quando o pacote perdeu cobertura do exercício', async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [{ id: 'mapping-1', packageId: 'pkg-2025', packageSha256: 'a'.repeat(64), calendarYear: 2026,
        taxRegime: 'LUCRO_PRESUMIDO', specialSituation: null, revision: 1, status: 'DRAFT' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'pkg-2025', status: 'AVAILABLE', coveredCalendarYears: [2025], coveredSpecialSituations: [], canonicalSha256: 'a'.repeat(64) }] });
    const service = new PlanoReferencialService({ instancia: {} } as never);
    await expect(service.publicar({ tenantId: 'tenant-1', usuarioId: 'user-1' }, 'company-1', 'mapping-1', 1, 'corr-1'))
      .rejects.toMatchObject({ codigo: 'REFERENCE_PACKAGE_NOT_APPLICABLE' });
    expect(mocks.query).toHaveBeenCalledTimes(2);
  });

  it('publica com cobertura integral, hash canônico e versão monotônica', async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [{ id: 'mapping-1', packageId: 'pkg-2025', packageSha256: 'a'.repeat(64), calendarYear: 2025,
        taxRegime: 'LUCRO_PRESUMIDO', specialSituation: null, revision: 1, status: 'DRAFT' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'pkg-2025', authority: 'RFB', sourceDocument: 'ECF leiaute 12', sourceUrl: 'https://example.test',
        layout: '12', revision: '2026-09-07', coveredCalendarYears: [2025], coveredSpecialSituations: [], downloadedAt: new Date(),
        sourceSha256: 'b'.repeat(64), canonicalSha256: 'a'.repeat(64), status: 'AVAILABLE' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'account-1', active: true, analytical: true, complete: true, normalBalance: 'DEBIT' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ packageId: 'pkg-2025', code: '1.01', active: true, normalBalance: 'DEBIT' }] })
      .mockResolvedValueOnce({ rows: [{ accountId: 'account-1', centerId: null, kind: 'MAPPED', referenceCode: '1.01', reason: null, authorId: 'user-1', reviewedBy: null }] })
      .mockResolvedValueOnce({ rows: [{ canonicalSha256: 'a'.repeat(64) }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ version: 1 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const service = new PlanoReferencialService({ instancia: {} } as never);
    const result = await service.publicar({ tenantId: 'tenant-1', usuarioId: 'user-1' }, 'company-1', 'mapping-1', 1, 'corr-1');
    expect(result).toMatchObject({ mappingId: 'mapping-1', version: 1, revision: 2, status: 'PUBLISHED' });
    expect(result.canonicalSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(mocks.query.mock.calls[9]?.[0]).toContain("status='SUPERSEDED'");
    expect(mocks.query.mock.calls[10]?.[0]).toContain("status='PUBLISHED'");
  });
});
