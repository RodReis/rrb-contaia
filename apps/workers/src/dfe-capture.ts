import { randomUUID } from 'node:crypto';
import {
  commitDfeBatch,
  comContexto,
  ensureDfeCaptureState,
  getDfeCaptureCompany,
  marcarDfeCaptureEmExecucao,
  registrarFalhaDfeCapture,
  reservarJanelaDfeTenant,
  createOrReuseDfeCaptureRun,
} from '@contaia/db';
import { classifyCaptureFailure, contextoTecnico, evaluateBatch, nextAllowedAt } from '@contaia/domain';
import {
  DFE_CAPTURE_DLQ,
  DFE_CAPTURE_QUEUE,
  DfeCaptureCommandSchema,
  type DfeCaptureCommand,
  type ComandoDistribuicaoDfe,
  type RespostaDistribuicaoDfe,
} from '@contaia/shared';
import { Queue, Worker, type Job } from 'bullmq';
import type { Pool } from 'pg';

import type { ConexaoDoRedis } from '@contaia/signer-client';
import { criarConexaoRedis } from './redis.js';
import { iniciarAgendadorDfeCapture } from './dfe-scheduler.js';

type Options = Readonly<{ pool: Pool; schedulerPool: Pool; conexao: ConexaoDoRedis; signer: Readonly<{ distribuirDfe: (command: ComandoDistribuicaoDfe) => Promise<RespostaDistribuicaoDfe> }>; agora: () => Date; prefixo?: string }>;
type JobInput = DfeCaptureCommand & { runId?: string };

const context = (command: DfeCaptureCommand) => contextoTecnico({
  identidadeTecnica: 'worker', finalidade: 'PROCESSAMENTO_DE_EMPRESA', tenantId: command.tenantId,
  empresaId: command.companyId, correlationId: command.correlationId,
});

const captureOne = async (deps: Options, input: JobInput): Promise<void> => {
  const { runId, ...payload } = input;
  const command = DfeCaptureCommandSchema.parse(payload);
  const started = deps.agora();
  const reservation = await comContexto(deps.pool, context(command), async (client) => {
    const company = await getDfeCaptureCompany(client, command.companyId);
    if (!company || company.tenantId !== command.tenantId || company.cnpj !== command.cnpj || !company.active) throw new Error('DFE_CAPTURE_NOT_READY');
    const state = await ensureDfeCaptureState(client, { tenantId: command.tenantId, companyId: command.companyId, cnpj: command.cnpj });
    if (state.nextAllowedAt > started || (state.state === 'BLOCKED_656' && state.blockedUntil && state.blockedUntil > started)) {
      return { state, skip: true as const };
    }
    const run = runId ? { id: runId, reused: false, correlationId: command.correlationId, origin: command.origin, originatingUserId: command.originatingUserId ?? null } : await createOrReuseDfeCaptureRun(client, {
      state, origin: command.origin, originatingUserId: command.originatingUserId ?? null,
      idempotencyKey: command.idempotencyKey, correlationId: command.correlationId, occurredAt: started,
    });
    if (!runId && run.reused) return { state, run, skip: true as const };
    if (!(await marcarDfeCaptureEmExecucao(client, run.id, state, started))) throw new Error('DFE_CAPTURE_CONFLICT');
    return { state: { ...state, state: 'CAPTURING' as const, version: state.version + 1 }, run, skip: false as const };
  });
  if (reservation.skip) return;
  const attempt = Math.max(1, Number((await comContexto(deps.pool, context(command), async (client) => {
    const { rows } = await client.query<{ tentativa: number }>('select tentativa from app.dfe_capture_run where id=$1', [reservation.run.id]);
    return rows[0]?.tentativa ?? 1;
  }))));

  try {
    for (;;) {
      const window = await comContexto(deps.pool, context(command), (client) => reservarJanelaDfeTenant(client, reservation.run.id));
      if (window.reserved) break;
      await new Promise<void>((resolve) => setTimeout(resolve, Math.max(100, window.nextWindow.getTime() - deps.agora().getTime())));
    }
    const response = await deps.signer.distribuirDfe({
      tenantId: command.tenantId, empresaId: command.companyId, cnpj: command.cnpj,
      ultNSU: reservation.state.lastNsu, limite: 50,
      chaveIdempotente: command.idempotencyKey, correlationId: command.correlationId,
      ...(command.originatingUserId === undefined ? {} : { usuarioOriginadorId: command.originatingUserId }),
    });
    if (response.tipo === 'CONSUMO_INDEVIDO') {
      const classification = classifyCaptureFailure({ kind: 'CONSUMO_INDEVIDO', providerRetryAt: response.disponivelNovamenteEm ? new Date(response.disponivelNovamenteEm) : null, now: deps.agora() });
      await comContexto(deps.pool, context(command), (client) => registrarFalhaDfeCapture(client, {
        state: reservation.state, runId: reservation.run.id, code: classification.code, attempt, failedAt: deps.agora(), blockedUntil: classification.blockedUntil,
      }));
      return;
    }
    const items = response.itens.map((item) => ({ nsu: item.nsu, accessKey: item.chaveAcesso, kind: item.especie,
      rawContent: item.conteudoBruto, availableAt: item.disponibilizadoEm ? new Date(item.disponibilizadoEm) : null }));
    const checked = evaluateBatch({ previousLastNsu: reservation.state.lastNsu, returnedLastNsu: response.ultNSU, maxNsu: response.maxNSU, items });
    if (!checked.ok) throw new Error(checked.code);
    const finished = deps.agora();
    await comContexto(deps.pool, context(command), (client) => commitDfeBatch(client, {
      state: reservation.state, runId: reservation.run.id, returnedLastNsu: response.ultNSU, maxNsu: response.maxNSU,
      averageTimeMs: response.tempoMedioMs, nextAllowedAt: nextAllowedAt(finished, response.tempoMedioMs),
      capturedAt: finished, attempt, correlationId: command.correlationId, items,
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'DFE_PROVIDER_UNAVAILABLE';
    if (message === 'DFE_CONSUMO_INDEVIDO') {
      const classification = classifyCaptureFailure({ kind: 'CONSUMO_INDEVIDO', providerRetryAt: null, now: deps.agora() });
      await comContexto(deps.pool, context(command), (client) => registrarFalhaDfeCapture(client, {
        state: reservation.state, runId: reservation.run.id, code: classification.code, attempt, failedAt: deps.agora(), blockedUntil: classification.blockedUntil,
      }));
      return;
    }
    const mapping = message === 'DFE_CAPTURE_CONFLICT' ? 'BATCH_CONFLICT' : message === 'DFE_RESPONSE_INVALID' ? 'INVALID_RESPONSE' : message === 'DFE_BATCH_INVALID' ? 'INVALID_BATCH' : message.startsWith('SIGNER_CERTIFICADO_') ? 'CERTIFICATE_UNAVAILABLE' : message === 'SIGNER_INDISPONIVEL' ? 'SIGNER_UNAVAILABLE' : 'PROVIDER_UNAVAILABLE';
    const classification = classifyCaptureFailure({ kind: mapping, providerRetryAt: null, now: deps.agora() });
    const retrying = attempt < 3 && classification.retry;
    await comContexto(deps.pool, context(command), (client) => registrarFalhaDfeCapture(client, {
      state: reservation.state, runId: reservation.run.id, code: classification.code, attempt, failedAt: deps.agora(), retrying,
    }));
    if (classification.retry) throw new Error(classification.code);
  }
};

export const iniciarConsumidorDfeCapture = async (deps: Options) => {
  const redis = criarConexaoRedis(deps.conexao);
  const common = { connection: redis, ...(deps.prefixo === undefined ? {} : { prefix: deps.prefixo }) };
  const dead = new Queue(DFE_CAPTURE_DLQ, common);
  const queue = new Queue(DFE_CAPTURE_QUEUE, common);
  const worker = new Worker(DFE_CAPTURE_QUEUE, async (job: Job<JobInput>) => {
    await captureOne(deps, job.data);
  }, { ...common, concurrency: 2 });
  worker.on('failed', (job, error) => {
    if (!job || job.name !== 'capture' || job.attemptsMade < Number(job.opts.attempts ?? 3)) return;
    const { runId, ...payload } = job.data;
    const command = DfeCaptureCommandSchema.safeParse(payload);
    if (command.success && runId) void dead.add('dead', { ...command.data, runId, attempts: job.attemptsMade, code: error.message }, { jobId: `dead-${runId}-${randomUUID()}`, removeOnFail: false });
  });
  worker.on('error', (error) => console.error(JSON.stringify({ event: 'dfe-capture-worker-error', name: error.name })));
  await worker.waitUntilReady();
  const scheduler = iniciarAgendadorDfeCapture({ pool: deps.pool, schedulerPool: deps.schedulerPool, queue, now: deps.agora });
  return { fechar: async () => { scheduler.close(); await worker.close(); await queue.close(); await dead.close(); redis.disconnect(); } };
};
