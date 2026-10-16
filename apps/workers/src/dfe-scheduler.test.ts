import type { Pool } from 'pg';
import type { Queue } from 'bullmq';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  statements: [] as Array<{ sql: string; values?: readonly unknown[] }>,
  staging: null as null | { staging_id: string; especie: 'NFE_55' | 'CTE'; conteudo_bruto: Buffer; correlation_id: string; cnpj: string },
  acknowledgement: { id: '44444444-4444-4444-8444-444444444444', tentativas_ciencia: 0, tentativas_xml: 0 },
  pendentesAck: [] as Array<{id:string;tenant_id:string;empresa_id:string;correlation_id:string;tentativas_ciencia:number;tentativas_xml:number}>,
  fullXmlAvailable: false,
  iniciar: vi.fn(async () => ({ id: '44444444-4444-4444-8444-444444444444', tentativas_ciencia: 0, tentativas_xml: 0 })),
  impedir: vi.fn(async () => ({ id: '44444444-4444-4444-8444-444444444444', tentativas_ciencia: 0, tentativas_xml: 0 })),
  disponivel: vi.fn(async () => ({ id: '44444444-4444-4444-8444-444444444444', tentativas_ciencia: 0, tentativas_xml: 0 })),
}));

vi.mock('@contaia/db', () => ({
  comContexto: async (_pool: unknown, _context: unknown, execute: (client: unknown) => Promise<unknown>) => execute({
    query: async (sql: string, values?: readonly unknown[]) => {
      fixture.statements.push({ sql, values });
      if (sql.includes('from app.fiscal_document_outbox o join app.dfe_capture_staging')) {
        return { rows: fixture.staging ? [fixture.staging] : [], rowCount: fixture.staging ? 1 : 0 };
      }
      if (sql.includes('from app.fiscal_document where tenant_id')) return { rows: [{ disponivel: fixture.fullXmlAvailable }], rowCount: 1 };
      if (sql.includes('from app.fiscal_acknowledgement_outbox')) return {rows:fixture.pendentesAck,rowCount:fixture.pendentesAck.length};
      return { rows: [], rowCount: 1 };
    },
  }),
  createOrReuseDfeCaptureRun: vi.fn(), ensureDfeCaptureState: vi.fn(), getDfeCaptureCompany: vi.fn(),
  iniciarCienciaDaEmissao: fixture.iniciar,
  registrarResumoImpedido: fixture.impedir,
  registrarXmlCompletoJaDisponivel: fixture.disponivel,
  listarCienciasPendentes: vi.fn(async()=>fixture.pendentesAck),
}));

import { scanCienciasOutbox, scanFiscalDocumentsOutbox } from './dfe-scheduler.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const companyId = '22222222-2222-4222-8222-222222222222';
const stagingId = '33333333-3333-4333-8333-333333333333';
const cnpj='12345678000195';
const chave='35240112345678000195550010000000011000000019';
const resumo=`<resNFe xmlns="http://www.portalfiscal.inf.br/nfe"><chNFe>${chave}</chNFe><CNPJ>${cnpj}</CNPJ></resNFe>`;

const criarDependencias = (queueAdd: ReturnType<typeof vi.fn>, ackAdd=vi.fn(async()=>({}))) => {
  const schedulerPool = { query: vi.fn(async (sql: string) => ({
    rows: sql.includes('fiscal_ack_empresas_pendentes') || sql.includes('fiscal_document_empresas_pendentes') ? [{ tenant_id: tenantId, empresa_id: companyId, cnpj }] : [],
  })) };
  const documentQueue = { add: queueAdd };
  return {
    schedulerPool: schedulerPool as unknown as Pool,
    pool: {} as Pool,
    queue: { add: vi.fn(), getJob: vi.fn() } as unknown as Queue,
    documentQueue: documentQueue as unknown as Queue,
    acknowledgementQueue: { add: ackAdd, getJob: vi.fn(async () => null) } as unknown as Queue,
    now: () => new Date('2026-10-15T12:00:00Z'),
  };
};

describe('outbox F17 → F18', () => {
  beforeEach(() => {
    fixture.statements = [];
    fixture.iniciar.mockClear();
    fixture.impedir.mockClear();
    fixture.disponivel.mockClear();
    fixture.fullXmlAvailable = false;
    fixture.pendentesAck=[];
    fixture.staging = { staging_id: stagingId, especie: 'NFE_55', conteudo_bruto: Buffer.from('<nfeProc/>'), correlation_id: 'capture-correlation-01', cnpj };
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

  it('registra impedimento quando chave de resumo tem DV inválido', async () => {
    fixture.staging = { ...fixture.staging!, conteudo_bruto: Buffer.from(resumo.replace(chave,'35240112345678000195550010000000011000000010')) };
    const add = vi.fn(async () => ({}));
    await scanFiscalDocumentsOutbox(criarDependencias(add));

    expect(add).not.toHaveBeenCalled();
    expect(fixture.impedir).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ codigo: 'FISCAL_ACK_IDENTITY_INVALID' }));
    expect(fixture.statements.some(({ sql }) => sql.includes("estado='IGNORADO'"))).toBe(true);
  });

  it('encaminha resNFe elegível à fila própria de Ciência', async () => {
    fixture.staging = { ...fixture.staging!, conteudo_bruto: Buffer.from(resumo) };
    const add = vi.fn(async () => ({}));
    const ackAdd = vi.fn(async () => ({}));
    await scanFiscalDocumentsOutbox(criarDependencias(add, ackAdd));

    expect(add).not.toHaveBeenCalled();
    expect(ackAdd).toHaveBeenCalledWith('process-acknowledgement', expect.objectContaining({ acknowledgementId: fixture.acknowledgement.id }), expect.objectContaining({ jobId: expect.stringContaining('ack-') }));
    expect(fixture.statements.some(({ sql }) => sql.includes("estado='PUBLICADO'"))).toBe(true);
    expect(fixture.statements.some(({ sql }) => sql.includes("estado='IGNORADO'"))).toBe(true);
  });

  it('não transmite Ciência quando F18 já tem o documento completo', async () => {
    fixture.staging = { ...fixture.staging!, conteudo_bruto: Buffer.from(resumo) };
    fixture.fullXmlAvailable = true;
    const add = vi.fn(async () => ({}));
    const ackAdd = vi.fn(async () => ({}));
    await scanFiscalDocumentsOutbox(criarDependencias(add, ackAdd));

    expect(fixture.disponivel).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({chaveAcesso:chave}));
    expect(fixture.iniciar).not.toHaveBeenCalled();
    expect(ackAdd).not.toHaveBeenCalled();
    expect(fixture.statements.some(({ sql }) => sql.includes("estado='IGNORADO'"))).toBe(true);
  });

  it('registra impedimento quando destinatário do resumo diverge da empresa', async () => {
    fixture.staging = { ...fixture.staging!, conteudo_bruto: Buffer.from(resumo.replace(cnpj,'99999999000191')) };
    const add = vi.fn(async () => ({}));
    const ackAdd = vi.fn(async () => ({}));
    await scanFiscalDocumentsOutbox(criarDependencias(add, ackAdd));

    expect(ackAdd).not.toHaveBeenCalled();
    expect(fixture.statements.some(({ sql }) => sql.includes("estado='IGNORADO'"))).toBe(true);
  });

  it('republica ciclo retomado em job idempotente do scheduler', async () => {
    fixture.pendentesAck=[{id:fixture.acknowledgement.id,tenant_id:tenantId,empresa_id:companyId,correlation_id:'ack-correlation-01',tentativas_ciencia:3,tentativas_xml:0}];
    const add=vi.fn(async()=>({}));
    const dependencies=criarDependencias(vi.fn(async()=>({})),add);
    await scanCienciasOutbox(dependencies);
    expect(add).toHaveBeenCalledWith('process-acknowledgement',expect.objectContaining({acknowledgementId:fixture.acknowledgement.id}),
      expect.objectContaining({jobId:`ack-${fixture.acknowledgement.id}-c-3-x-0`,attempts:3}));
    expect(fixture.statements.some(({sql})=>sql.includes("set estado='PUBLICADO'"))).toBe(true);
  });
});
