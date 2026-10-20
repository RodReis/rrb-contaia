import { beforeEach, describe, expect, it, vi } from 'vitest';

const { hashTaxPackage, noCatalogoTributario } = vi.hoisted(() => ({
  hashTaxPackage: vi.fn(),
  noCatalogoTributario: vi.fn(),
}));

vi.mock('@contaia/domain', async () => {
  const real = await vi.importActual<typeof import('@contaia/domain')>('@contaia/domain');
  return { ...real, hashTaxPackage };
});
vi.mock('../tax-rules/catalogo-contexto', () => ({ noCatalogoTributario }));

import { TaxPackagesService } from './tax-packages.service';

const actor = { id: '00000000-0000-7000-8000-000000000001', tipo: 'SUPER_ADMIN' } as const;
const correlationId = 'correlation-test';
const fonte = {
  id: 'lei', authority: 'Presidência da República', title: 'Lei compilada',
  url: 'https://www.planalto.gov.br/lei', provision: 'Art. 1', publishedOn: '2020-01-01',
  consultedOn: '2026-10-20', validFrom: '2020-01-01', validUntil: null,
};
const pacote = {
  schemaVersion: 1 as const, packageId: 'f26-draft', semanticVersion: '0.1.0', jurisdiction: 'GO' as const,
  regimes: ['SIMPLES_NACIONAL' as const, 'LUCRO_PRESUMIDO' as const],
  document: { model: '55' as const, direction: 'ENTRY' as const, purpose: 'RESALE' as const },
  operations: ['COMPRA_INTERNA_REVENDA' as const, 'COMPRA_INTERESTADUAL_REVENDA' as const],
  validFrom: '2026-01-01', validUntil: null, consultedOn: '2026-10-20',
  coverage: ['Pacote documental sem regras executáveis.'], exclusions: ['Sem revisão humana.'],
  sources: [fonte], rules: [], fixtures: [],
};

describe('TaxPackagesService validação do pacote documental F26', () => {
  const client = { query: vi.fn() };
  const pool = { instancia: {} } as never;
  let service: TaxPackagesService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new TaxPackagesService(pool);
    noCatalogoTributario.mockImplementation(async (_pool, _correlation, action) => action(client));
    hashTaxPackage.mockResolvedValue('a'.repeat(64));
  });

  it('importa o draft documental, mas não transiciona pacote sem regras para VALIDATED', async () => {
    client.query.mockResolvedValueOnce({ rows: [{
      id: '00000000-0000-7000-8000-000000000010', package_id: pacote.packageId,
      semantic_version: pacote.semanticVersion, status: 'IMPORTED', content: pacote,
      content_sha256: 'a'.repeat(64), imported_by: actor.id, imported_at: new Date('2026-10-20T10:00:00Z'),
      reviewed_by: null, reviewed_at: null, published_by: null, published_at: null, archived_at: null,
    }] });
    await service.import(actor, pacote, correlationId);
    expect(client.query).toHaveBeenCalledTimes(1);
    expect(client.query.mock.calls[0]?.[0]).toContain('tax_package_import');

    client.query.mockResolvedValueOnce({ rows: [{
      id: '00000000-0000-7000-8000-000000000010', package_id: pacote.packageId,
      semantic_version: pacote.semanticVersion, status: 'IMPORTED', content: pacote,
      content_sha256: 'a'.repeat(64), imported_by: actor.id, imported_at: new Date('2026-10-20T10:00:00Z'),
      reviewed_by: null, reviewed_at: null, published_by: null, published_at: null, archived_at: null,
    }] });
    const validation = await service.validate(actor, '00000000-0000-7000-8000-000000000010', correlationId);
    expect(validation).toMatchObject({ status: 'IMPORTED', validation: { valid: false, errors: ['PACKAGE_EXECUTABLE_RULES_EMPTY'] } });
    expect(client.query).toHaveBeenCalledTimes(2);
    expect(client.query.mock.calls[1]?.[0]).toContain('tax_package_get');
  });
});
