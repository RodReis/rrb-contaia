import { randomUUID } from 'node:crypto';
import { comContexto, createOrReuseDfeCaptureRun, ensureDfeCaptureState, getDfeCaptureCompany } from '@contaia/db';
import { contextoTecnico } from '@contaia/domain';
import { DFE_CAPTURE_JOB, DFE_CAPTURE_JOB_OPTIONS, DFE_CAPTURE_SCAN_INTERVAL_MS, DfeCaptureCommandSchema,
  FISCAL_DOCUMENTS_JOB, FISCAL_DOCUMENTS_JOB_OPTIONS, FiscalDocumentCommandSchema } from '@contaia/shared';
import type { Queue } from 'bullmq';
import type { Pool } from 'pg';
import { ehDocumentoFiscalElegivel } from '@contaia/shared/fiscal-document-parser';

type Candidate = Readonly<{ tenant_id: string; empresa_id: string; cnpj: string }>;
type Options = Readonly<{ pool: Pool; schedulerPool: Pool; queue: Queue; documentQueue?: Queue; now: () => Date }>;

const enqueue = async (options: Options, candidate: Candidate): Promise<void> => {
  const correlationId = `dfe-auto-${randomUUID()}`;
  const prepared = await comContexto(options.pool, contextoTecnico({
    identidadeTecnica: 'workers-dfe-capture', finalidade: 'PROCESSAMENTO_DE_EMPRESA',
    tenantId: candidate.tenant_id, empresaId: candidate.empresa_id, correlationId,
  }), async (client) => {
    const company = await getDfeCaptureCompany(client, candidate.empresa_id);
    if (!company?.active || company.tenantId !== candidate.tenant_id || company.cnpj !== candidate.cnpj) return null;
    const state = await ensureDfeCaptureState(client, { tenantId: candidate.tenant_id, companyId: candidate.empresa_id, cnpj: candidate.cnpj });
    const now = options.now();
    if (state.nextAllowedAt > now || state.state === 'DISABLED' || state.state === 'FAILED' ||
      (state.state === 'BLOCKED_656' && state.blockedUntil !== null && state.blockedUntil > now)) return null;
    const run = await createOrReuseDfeCaptureRun(client, {
      state, origin: 'AUTOMATIC', originatingUserId: null,
      idempotencyKey: `dfe-auto-${randomUUID()}`, correlationId, occurredAt: now,
    });
    if (run.terminal) return null;
    const command = DfeCaptureCommandSchema.parse({
      tenantId: candidate.tenant_id, companyId: candidate.empresa_id, cnpj: candidate.cnpj,
      origin: run.origin, idempotencyKey: run.idempotencyKey, correlationId: run.correlationId,
      ...(run.originatingUserId ? { originatingUserId: run.originatingUserId } : {}),
    });
    return { command, runId: run.id };
  });
  if (!prepared) return;

  const jobId = `capture-${candidate.empresa_id}`;
  const existing = await options.queue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (state === 'waiting' || state === 'active' || state === 'delayed' || state === 'waiting-children') return;
    await existing.remove();
  }
  await options.queue.add(DFE_CAPTURE_JOB, { ...prepared.command, runId: prepared.runId }, { ...DFE_CAPTURE_JOB_OPTIONS, jobId });
};

export const scanDfeCapture = async (options: Options): Promise<void> => {
  const { rows } = await options.schedulerPool.query<Candidate>('select * from app.dfe_capture_empresas_elegiveis(100)');
  for (const candidate of rows) await enqueue(options, candidate);
};

type FiscalOutboxOptions = Pick<Options,'pool'|'schedulerPool'|'documentQueue'>;

export const scanFiscalDocumentsOutbox = async (options: FiscalOutboxOptions): Promise<void> => {
  if (!options.documentQueue) return;
  const { rows } = await options.schedulerPool.query<Candidate>(
    'select * from app.fiscal_document_empresas_pendentes(100)',
  );
  for (const candidate of rows) {
    const correlationId = `fiscal-outbox-${randomUUID()}`;
    const ctx = contextoTecnico({ identidadeTecnica: 'workers-dfe-capture', finalidade: 'PROCESSAMENTO_DE_EMPRESA',
      tenantId: candidate.tenant_id, empresaId: candidate.empresa_id, correlationId });
    const pendentes = await comContexto(options.pool, ctx, async (client) => client.query<{
      staging_id: string; especie: 'NFE_55' | 'CTE'; conteudo_bruto: Buffer; correlation_id: string;
    }>(`select o.staging_id,s.especie,s.conteudo_bruto,s.correlation_id
          from app.fiscal_document_outbox o join app.dfe_capture_staging s on s.id=o.staging_id
         where o.empresa_id=$1 and o.estado='PENDENTE' order by o.criado_em,o.staging_id limit 100`,
      [candidate.empresa_id]));

    for (const item of pendentes.rows) {
      try {
        if (!ehDocumentoFiscalElegivel(item.conteudo_bruto,item.especie)) {
          await comContexto(options.pool, ctx, (client) => client.query(
            `update app.fiscal_document_outbox set estado='IGNORADO',tentativas=tentativas+1
              where staging_id=$1 and empresa_id=$2 and estado='PENDENTE'`, [item.staging_id,candidate.empresa_id]));
          continue;
        }
        const command = FiscalDocumentCommandSchema.parse({ tenantId: candidate.tenant_id, companyId: candidate.empresa_id,
          stagingId: item.staging_id, correlationId: item.correlation_id });
        await options.documentQueue!.add(FISCAL_DOCUMENTS_JOB, command, {
          ...FISCAL_DOCUMENTS_JOB_OPTIONS, jobId: `fiscal-${item.staging_id}`,
        });
        await comContexto(options.pool, ctx, (client) => client.query(
          `update app.fiscal_document_outbox set estado='PUBLICADO',tentativas=tentativas+1,publicado_em=now()
            where staging_id=$1 and empresa_id=$2 and estado='PENDENTE'`, [item.staging_id,candidate.empresa_id]));
      } catch (error) {
        await comContexto(options.pool, ctx, (client) => client.query(
          `update app.fiscal_document_outbox set tentativas=tentativas+1
            where staging_id=$1 and empresa_id=$2 and estado='PENDENTE'`, [item.staging_id,candidate.empresa_id]));
        console.error(JSON.stringify({ event: 'fiscal-document-outbox-publish-failed', name: error instanceof Error ? error.name : 'UnknownError' }));
      }
    }
  }
};

export const iniciarAgendadorDfeCapture = (options: Options): Readonly<{ close: () => void }> => {
  let running = false;
  const scan = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      await scanDfeCapture(options);
    } catch (error) {
      console.error(JSON.stringify({ event: 'dfe-capture-scheduler-error', name: error instanceof Error ? error.name : 'Unknown' }));
    } finally {
      running = false;
    }
  };
  const interval = setInterval(() => void scan(), DFE_CAPTURE_SCAN_INTERVAL_MS);
  void scan();
  return { close: () => clearInterval(interval) };
};

export const iniciarAgendadorDeDocumentosFiscais = (options: FiscalOutboxOptions): Readonly<{ close: () => void }> => {
  let running = false;
  const scan = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      await scanFiscalDocumentsOutbox(options);
    } catch (error) {
      console.error(JSON.stringify({ event: 'fiscal-document-outbox-scheduler-error', name: error instanceof Error ? error.name : 'Unknown' }));
    } finally {
      running = false;
    }
  };
  const interval = setInterval(() => void scan(), DFE_CAPTURE_SCAN_INTERVAL_MS);
  void scan();
  return { close: () => clearInterval(interval) };
};
