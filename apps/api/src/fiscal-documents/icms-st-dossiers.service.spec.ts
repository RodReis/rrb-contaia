import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { canonicalizarJson } from '@contaia/shared';

const state = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@contaia/db', () => ({
  comContextoHumano: (_pool: unknown, _context: unknown, operation: (client: { query: typeof state.query }) => unknown) => operation({ query: state.query }),
}));

import { IcmsStDossiersService } from './icms-st-dossiers.service.js';

const createService = () => new IcmsStDossiersService({ instancia: {} as never } as never, { obter: vi.fn().mockResolvedValue({ conteudo: Buffer.from('official') }) } as never);
const decision = (track: 'RESTITUTION' | 'COMPLEMENT') => ({
  action: 'APPROVED' as const, reason: 'Revisão humana das evidências anexadas.', evidenceIds: ['evidence-id'], conditionConfirmations: [0],
  destination: track === 'RESTITUTION' ? 'REFUND_REQUEST' as const : 'GUIDE_PAYMENT' as const,
  rulePackageId: 'rule-id',
});

afterEach(() => vi.clearAllMocks());

describe('IcmsStDossiersService', () => {
  it('serializa decisões distintas pelo mesmo dossiê', async () => {
    state.query.mockImplementation(async (sql: string) => {
      if (sql.includes('select id,content_sha256,canonical_json from app.tax_st_internal_decision_dossier')) return { rows: [] };
      if (sql.includes('select d.id,d.source_package_id')) return { rows: [] };
      return { rows: [] };
    });
    const service = createService();

    await expect(service.decidir('tenant', 'reviewer', 'company', 'dossier', 'RESTITUTION', decision('RESTITUTION'), ['contador'], 'corr-1')).rejects.toBeDefined();
    await expect(service.decidir('tenant', 'reviewer', 'company', 'dossier', 'COMPLEMENT', decision('COMPLEMENT'), ['contador'], 'corr-2')).rejects.toBeDefined();

    const dossierLocks = state.query.mock.calls
      .filter(([sql, params]) => String(sql).includes('pg_advisory_xact_lock') && String((params as string[])[0]).includes('f35/dossier/'))
      .map(([, params]) => (params as string[])[0]);
    expect(dossierLocks).toEqual(['f35/dossier/tenant/company/dossier', 'f35/dossier/tenant/company/dossier']);
  });

  it('audita como FAILED a tentativa negada de autoaprovação de pacote de destino', async () => {
    state.query.mockImplementation(async (sql: string) => {
      if (sql.includes('select p.id,p.storage_key,p.source_sha256,p.requested_by')) return { rows: [{ id: 'rule-id', requested_by: 'reviewer' }] };
      if (sql.includes('select id from app.tax_st_destination_rule_package')) return { rows: [{ id: 'rule-id' }] };
      return { rows: [] };
    });

    await expect(createService().decidirRegra('tenant', 'reviewer', 'company', 'rule-id', ['contador'], 'APPROVED', null, 'corr'))
      .rejects.toMatchObject({ codigo: 'ICMS_ST_DOSSIER_SELF_APPROVAL_FORBIDDEN' });

    expect(state.query).toHaveBeenCalledWith(expect.stringContaining("values($1,$2,$3,'FAILED',$4,now(),$5,$6::jsonb)"), expect.any(Array));
  });

  it('audita como FAILED a tentativa de revisão por papel não autorizado', async () => {
    state.query.mockImplementation(async (sql: string) => {
      if (sql.includes('select id from app.tax_st_destination_rule_package')) return { rows: [{ id: 'rule-id' }] };
      return { rows: [] };
    });

    await expect(createService().decidirRegra('tenant', 'assistant', 'company', 'rule-id', ['auxiliar'], 'REJECTED', 'Motivo de revisão inválida.', 'corr'))
      .rejects.toBeDefined();

    expect(state.query).toHaveBeenCalledWith(expect.stringContaining("values($1,$2,$3,'FAILED',$4,now(),$5,$6::jsonb)"), expect.any(Array));
  });

  it('anexa evidência criando revisão imutável e superando o dossiê anterior', async () => {
    const dossier = { dossierId: 'dossier', status: 'DRAFT', restitution: { status: 'PENDING', evidenceIds: [] }, complement: { status: 'PENDING', evidenceIds: [] }, evidenceManifest: [] };
    const contentHash = createHash('sha256').update(canonicalizarJson(dossier)).digest('hex');
    state.query.mockImplementation(async (sql: string) => {
      if (sql.includes('select id,content_sha256,canonical_json from app.tax_st_internal_decision_dossier')) return { rows: [] };
      if (sql.includes('select d.id,d.source_package_id,d.accrual_result_id')) return { rows: [{ id: 'dossier', source_package_id: 'source', accrual_result_id: 'accrual', prepared_by: 'preparer', canonical_json: dossier, content_sha256: contentHash }] };
      if (sql.includes('from app.tax_st_internal_decision_evidence where dossier_id')) return { rows: [] };
      if (sql.includes('coalesce(max(revision)')) return { rows: [{ revision: 2 }] };
      return { rows: [] };
    });
    const storage = { enviarComChave: vi.fn(), remover: vi.fn(), obter: vi.fn() };
    const service = new IcmsStDossiersService({ instancia: {} as never } as never, storage as never);

    const result = await service.anexarEvidencia('tenant', 'preparer', 'company', 'dossier', 'RESTITUTION', 'Nota', 'Documento de suporte fiscal', { originalname: 'nota.pdf', mimetype: 'application/pdf', buffer: Buffer.from('evidence') }, 'corr');

    expect(result.id).not.toBe('dossier');
    expect((result.dossier as { evidenceManifest: unknown[] }).evidenceManifest).toHaveLength(1);
    expect(state.query).toHaveBeenCalledWith(expect.stringContaining('insert into app.tax_st_internal_decision_event'), expect.arrayContaining(['dossier', 'DOSSIER', 'SUPERSEDED']));
    expect(state.query).toHaveBeenCalledWith(expect.stringContaining('insert into app.tax_st_internal_decision_evidence'), expect.any(Array));
  });

  it('exporta CSV com metadados de origem, pacote normativo e manifesto de evidências', async () => {
    const dossier = {
      originalPeriod: { start: '2017-01', end: '2017-12' }, referenceDate: '2026-10-24', sourceHashes: { f33: 'a'.repeat(64), f34: 'b'.repeat(64) },
      evidenceManifest: [{ id: 'evidence', track: 'RESTITUTION', kind: 'Nota', description: 'Documento fiscal', fileName: 'nota.pdf', contentSha256: 'c'.repeat(64) }],
      restitution: { status: 'APPROVED', principalCents: 100, legalAccrualsCents: 20, totalCents: 120, destination: 'REFUND_REQUEST', rulePackageVersion: 'go-v1', evidenceIds: ['evidence'], rulePackageSnapshot: { id: 'rule', version: 'go-v1', validFrom: '2016-10-01', validThrough: '2018-02-28', officialBasis: 'Ato oficial', sourceSha256: 'd'.repeat(64), sourceUrl: 'https://example.gov.br/ato', conditions: ['Condição 1'] } },
      complement: { status: 'PENDING', evidenceIds: [] },
    };
    const contentHash = createHash('sha256').update(canonicalizarJson(dossier)).digest('hex');
    state.query.mockImplementation(async (sql: string) => sql.includes('select d.id,d.canonical_json,d.content_sha256')
      ? { rows: [{ id: 'dossier', canonical_json: dossier, content_sha256: contentHash, events: [] }] }
      : { rows: [] });

    const result = await createService().exportar('tenant', 'user', 'company', 'dossier', 'CSV', 'corr');
    const csv = result.conteudo.toString('utf8');

    expect(csv).toContain('2017-01');
    expect(csv).toContain('2026-10-24');
    expect(csv).toContain('a'.repeat(64));
    expect(csv).toContain('b'.repeat(64));
    expect(csv).toContain('nota.pdf');
    expect(csv).toContain('c'.repeat(64));
    expect(csv).toContain('Ato oficial');
    expect(csv).toContain('2018-02-28');
    expect(csv).toContain('Condição 1');
  });
});
