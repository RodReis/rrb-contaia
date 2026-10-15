import { comContextoHumano, getDfeCaptureCompany, ensureDfeCaptureState, hasDfeCaptureCertificate, listDfeCaptureRuns, createOrReuseDfeCaptureRun, prepararReprocessamentoDfeCapture, getDfeCaptureMetrics } from '@contaia/db';
import { DfeCaptureCommandSchema, DFE_CAPTURE_JOB, DFE_CAPTURE_JOB_OPTIONS, type DfeCaptureCommand } from '@contaia/shared';
import { CODIGOS_DE_ERRO, ErroDeDominio } from '@contaia/domain';
import { Inject, Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { PoolDoBanco } from '../banco/pool.provider';
import { DFE_CAPTURE_API_QUEUE } from './dfe-capture.queue';

@Injectable()
export class DfeCaptureService {
  constructor(private readonly pool: PoolDoBanco, @Inject(DFE_CAPTURE_API_QUEUE) private readonly queue: Queue | null) {}

  async status(tenantId: string, userId: string, companyId: string, correlationId: string) {
    return comContextoHumano(this.pool.instancia, { tenantId, usuarioId: userId, correlationId }, async (client) => {
      const company = await getDfeCaptureCompany(client, companyId);
      if (!company || company.tenantId !== tenantId) return { state: 'DISABLED', code: 'EMPRESA_NAO_ENCONTRADA' };
      const state = await ensureDfeCaptureState(client, { tenantId, companyId, cnpj: company.cnpj });
      const certificateAvailable = await hasDfeCaptureCertificate(client, companyId, new Date());
      return { companyId, state: company.active && certificateAvailable ? state.state : 'DISABLED',
        code: certificateAvailable ? null : 'DFE_CERTIFICATE_UNAVAILABLE', lastNsu: state.lastNsu, maxNsu: state.maxNsu,
        averageTimeMs: state.averageTimeMs, nextAllowedAt: state.nextAllowedAt.toISOString(),
        blockedUntil: state.blockedUntil?.toISOString() ?? null, consecutiveFailures: state.consecutiveFailures,
        lastSuccessAt: state.lastSuccessAt?.toISOString() ?? null, lastErrorCode: state.lastErrorCode,
        metrics30d: await getDfeCaptureMetrics(client, companyId) };
    });
  }

  async runs(tenantId: string, userId: string, companyId: string, page: number, correlationId: string) {
    return comContextoHumano(this.pool.instancia, { tenantId, usuarioId: userId, correlationId }, async (client) => {
      const company = await getDfeCaptureCompany(client, companyId);
      if (!company || company.tenantId !== tenantId) return { pagina: page, itens: [] };
      return { pagina: page, itens: await listDfeCaptureRuns(client, companyId, page) };
    });
  }

  async enfileirar(tenantId: string, userId: string, companyId: string, correlationId: string, idempotencyKey: string) {
    if (!this.queue) throw new ErroDeDominio(CODIGOS_DE_ERRO.FILA_INDISPONIVEL, 'Fila de captura indisponível.');
    const prepared = await comContextoHumano(this.pool.instancia, { tenantId, usuarioId: userId, correlationId }, async (client) => {
      const company = await getDfeCaptureCompany(client, companyId);
      if (!company || company.tenantId !== tenantId) throw new ErroDeDominio(CODIGOS_DE_ERRO.EMPRESA_NAO_ENCONTRADA, 'Empresa não encontrada.');
      if (!company.active) throw new ErroDeDominio(CODIGOS_DE_ERRO.EMPRESA_ARQUIVADA, 'Empresa inativa para captura.');
      const state = await ensureDfeCaptureState(client, { tenantId, companyId, cnpj: company.cnpj });
      const now = new Date();
      const run = await createOrReuseDfeCaptureRun(client, { state, origin: 'MANUAL', originatingUserId: userId, idempotencyKey, correlationId, occurredAt: now });
      const command: DfeCaptureCommand = DfeCaptureCommandSchema.parse({ tenantId, companyId, cnpj: company.cnpj, origin: run.origin, idempotencyKey: run.idempotencyKey, correlationId: run.correlationId, ...(run.originatingUserId ? { originatingUserId: run.originatingUserId } : {}) });
      if (run.reused) return { command, run };
      if (!(await hasDfeCaptureCertificate(client, companyId, now))) throw new ErroDeDominio(CODIGOS_DE_ERRO.ESTADO_INVALIDO_PARA_ACAO, 'Certificado A1 vigente necessario para captura DF-e.');
      if (state.state === 'FAILED' || state.state === 'DISABLED') throw new ErroDeDominio(CODIGOS_DE_ERRO.ESTADO_INVALIDO_PARA_ACAO, 'Captura exige recuperacao antes de nova consulta.');
      if (state.state === 'BLOCKED_656' && state.blockedUntil && state.blockedUntil > now) throw new ErroDeDominio(CODIGOS_DE_ERRO.ESTADO_INVALIDO_PARA_ACAO, 'Captura bloqueada temporariamente pelo provedor.');
      if (state.nextAllowedAt > now) throw new ErroDeDominio(CODIGOS_DE_ERRO.ESTADO_INVALIDO_PARA_ACAO, 'O intervalo mínimo entre consultas ainda não terminou.');
      return { command, run };
    });
    if (prepared.run.terminal) return { runId: prepared.run.id, status: 'COMPLETED' };
    const jobId = `capture-${companyId}`;
    const existing = await this.queue.getJob(jobId);
    if (existing) {
      const current = await existing.getState();
      if (current === 'waiting' || current === 'active' || current === 'delayed' || current === 'waiting-children') return { runId: prepared.run.id, status: 'ALREADY_QUEUED' };
      await existing.remove();
    }
    await this.queue.add(DFE_CAPTURE_JOB, { ...prepared.command, runId: prepared.run.id }, { ...DFE_CAPTURE_JOB_OPTIONS, jobId });
    return { runId: prepared.run.id, status: 'QUEUED' };
  }

  async reprocessar(tenantId: string, userId: string, companyId: string, runId: string, correlationId: string) {
    if (!this.queue) throw new ErroDeDominio(CODIGOS_DE_ERRO.FILA_INDISPONIVEL, 'Fila de captura indisponível.');
    const existingJobId = `capture-${companyId}`;
    const existingJob = await this.queue.getJob(existingJobId);
    if (existingJob) {
      const jobState = await existingJob.getState();
      if (['waiting', 'active', 'delayed', 'waiting-children'].includes(jobState)) {
        throw new ErroDeDominio(CODIGOS_DE_ERRO.ESTADO_INVALIDO_PARA_ACAO, 'Já existe uma captura pendente para este CNPJ.');
      }
      await existingJob.remove();
    }
    const prepared = await comContextoHumano(this.pool.instancia, { tenantId, usuarioId: userId, correlationId }, async (client) => {
      const company = await getDfeCaptureCompany(client, companyId);
      if (!company || company.tenantId !== tenantId) throw new ErroDeDominio(CODIGOS_DE_ERRO.EMPRESA_NAO_ENCONTRADA, 'Empresa não encontrada.');
      if (!company.active) throw new ErroDeDominio(CODIGOS_DE_ERRO.EMPRESA_ARQUIVADA, 'Empresa inativa para captura.');
      const now = new Date();
      if (!(await hasDfeCaptureCertificate(client, companyId, now))) throw new ErroDeDominio(CODIGOS_DE_ERRO.ESTADO_INVALIDO_PARA_ACAO, 'Reprocessamento exige certificado A1 vigente.');
      const state = await ensureDfeCaptureState(client, { tenantId, companyId, cnpj: company.cnpj });
      const run = await prepararReprocessamentoDfeCapture(client, { state, runId, actorId: userId, reprocessedAt: now });
      if (!run) throw new ErroDeDominio(CODIGOS_DE_ERRO.ESTADO_INVALIDO_PARA_ACAO, 'Execução não está disponível na DLQ ou o intervalo mínimo ainda não terminou.');
      return { run, command: DfeCaptureCommandSchema.parse({ tenantId, companyId, cnpj: company.cnpj,
        origin: run.origin, idempotencyKey: run.idempotencyKey, correlationId: run.correlationId,
        ...(run.originatingUserId ? { originatingUserId: run.originatingUserId } : {}) }) };
    });
    await this.queue.add(DFE_CAPTURE_JOB, { ...prepared.command, runId: prepared.run.id }, {
      ...DFE_CAPTURE_JOB_OPTIONS, attempts: 1, jobId: existingJobId,
    });
    return { runId: prepared.run.id, status: 'QUEUED' };
  }
}
