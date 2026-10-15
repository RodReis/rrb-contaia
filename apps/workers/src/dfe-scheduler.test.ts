import type { Pool } from 'pg';
import type { Queue } from 'bullmq';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  statements: [] as Array<{ sql: string; values?: readonly unknown[] }>,
  staging: null as null | { staging_id: string; especie: 'NFE_55' | 'CTE'; conteudo_bruto: Buffer; correlation_id: string },
}));

vi.mock('@contaia/db', () => ({
  comContexto: async (_pool: unknown, _context: unknown, execute: (client: unknown) => Promise<unknown>) => execute({
    query: async (sql: string, values?: readonly unknown[]) => {
      fixture.statements.push({ sql, values });
      if (sql.includes('from app.fiscal_document_outbox o join app.dfe_capture_staging')) {
        return { rows: fixture.staging ? [fixture.staging] : [], rowCount: fixture.staging ? 1 : 0 };
      }
      return { rows: [], rowCount: 1 };
    },
  }),
  createOrReuseDfeCaptureRun: vi.fn(), ensureDfeCaptureState: vi.fn(), getDfeCaptureCompany: vi.fn(),
}));

import { scanFiscalDocumentsOutbox } from './dfe-scheduler.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const companyId = '22222222-2222-4222-8222-222222222222';
const stagingId = '33333333-3333-4333-8333-333333333333';

const criarDependencias = (queueAdd: ReturnType<typeof vi.fn>) => {
  const schedulerPool = { query: vi.fn(async (sql: string) => ({
    rows: sql.includes('fiscal_document_empresas_pendentes') ? [{ tenant_id: tenantId, empresa_id: companyId, cnpj: '12345678000195' }] : [],
  })) };
  const documentQueue = { add: queueAdd };
  return {
    schedulerPool: schedulerPool as unknown as Pool,
    pool: {} as Pool,
    queue: { add: vi.fn(), getJob: vi.fn() } as unknown as Queue,
    documentQueue: documentQueue as unknown as Queue,
    now: () => new Date('2026-10-15T12:00:00Z'),
  };
};

describe('outbox F17 → F18', () => {
  beforeEach(() => {
    fixture.statements = [];
    fixture.staging = { staging_id: stagingId, especie: 'NFE_55', conteudo_bruto: Buffer.from('<nfeProc/>'), correlation_id: 'capture-correlation-01' };
  });

  it('publica com identificador idempotente e só então marca o outbox', async () => {
    const add = vi.fn(async () => ({}));
    await scanFiscalDocumentsOutbox(criarDependencias(add));

    expect(add).toHaveBeenCalledWith('process-staging', { tenantId, companyId, stagingId, correlationId: 'capture-correlation-01' }, expect.objectContaining({ jobId: `fiscal-${stagingId}` }));
    expect(fixture.statements.some(({ sql }) => sql.includes("estado='PUBLICADO'"))).toBe(true);
  });

  it('mantém o item pendente e incrementa tentativas se Redis falhar', async () => {
    const add = vi.fn(async () => { throw new Error('redis indisponível'); });
    await scanFiscalDocumentsOutbox(criarDependencias(add));

    const retry = fixture.statements.find(({ sql }) => sql.includes('set tentativas=tentativas+1'));
    expect(retry).toBeDefined();
    expect(retry?.sql).not.toContain("estado='PUBLICADO'");
  });

  it('marca resumo/evento como ignorado sem publicar job F18', async () => {
    fixture.staging = { ...fixture.staging!, conteudo_bruto: Buffer.from('<resNFe/>') };
    const add = vi.fn(async () => ({}));
    await scanFiscalDocumentsOutbox(criarDependencias(add));

    expect(add).not.toHaveBeenCalled();
    expect(fixture.statements.some(({ sql }) => sql.includes("estado='IGNORADO'"))).toBe(true);
  });
});
