import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { comContextoHumano } from '@contaia/db';
import { redigirPayloadDeAuditoria } from '@contaia/domain';
import {
  AUDIT_EXPORT_EXPIRY_JOB, AUDIT_EXPORT_QUEUE, AUDIT_EXPORT_TTL_MS,
  AuditExportCommandSchema, AuditExportExpiryCommandSchema,
} from '@contaia/shared';
import { Queue, Worker, type Job } from 'bullmq';
import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import type { ConexaoDoRedis } from '@contaia/signer-client';
import type { ConfigDoArmazenamento } from './config.js';
import { criarConexaoRedis } from './redis.js';

type ExportFilters = Readonly<{
  inicio?: string; fim?: string; atorId?: string; agente?: string; tipo?: string; estado?: string; correlationId?: string;
  integridade?: 'VALIDA' | 'INVALIDA' | 'NAO_VERIFICAVEL';
}>;

type ExportJob = Readonly<{
  id: string; tenant_id: string; empresa_id: string; requested_by: string; format: 'JSON' | 'CSV'; filters: ExportFilters;
  empresas_autorizadas: string[]; correlation_id: string; criado_em: Date; estado: string; expires_at: Date | null;
}>;

const construirFiltro = (filtros: ExportFilters, empresaId: string) => {
  const values: unknown[] = [empresaId];
  const clauses = ['e.tenant_id=$1', 'app.empresa_autorizada(e.empresa_id)', 'e.empresa_id=$2'];
  const entries: readonly [keyof ExportFilters, string][] = [
    ['inicio','e.occurred_at >= ?::date'], ['fim',"e.occurred_at < (?::date + interval '1 day')"], ['atorId','e.actor_id=?::uuid'],
    ['agente','e.agent=?'], ['tipo','e.event_type=?'], ['estado','e.state=?'], ['correlationId','e.correlation_id=?'],
  ];
  for (const [key, mold] of entries) {
    const value = filtros[key];
    if (value === undefined) continue;
    values.push(value);
    clauses.push(mold.replace('?', `$${values.length}`));
  }
  if (filtros.integridade === 'NAO_VERIFICAVEL') clauses.push('(e.payload_sha256 IS NULL OR p.event_id IS NULL)');
  else if (filtros.integridade === 'VALIDA') clauses.push("(p.event_id IS NOT NULL AND encode(digest(convert_to(e.envelope::text,'UTF8'),'sha256'),'hex')=e.envelope_sha256 AND encode(digest(convert_to(p.payload::text,'UTF8'),'sha256'),'hex')=p.payload_sha256)");
  else if (filtros.integridade === 'INVALIDA') clauses.push("(encode(digest(convert_to(e.envelope::text,'UTF8'),'sha256'),'hex')<>e.envelope_sha256 OR (p.event_id IS NOT NULL AND encode(digest(convert_to(p.payload::text,'UTF8'),'sha256'),'hex')<>p.payload_sha256))");
  return { sql: clauses.join(' AND '), values };
};

const csv = (eventos: readonly Record<string, unknown>[]): string => {
  const colunas = ['id','empresa_id','event_type','origin','occurred_at','actor_id','actor_kind','actor_role','agent','agent_version','model','provider','source_type','source_id','decision','state','score','measured_cost_microusd','input_tokens','output_tokens','correlation_id','causation_id','envelope_sha256','payload_sha256','payload'];
  const escape = (valor: unknown): string => `"${String(valor ?? '').replaceAll('"', '""')}"`;
  return [colunas.join(','), ...eventos.map((evento) => colunas.map((coluna) => escape(typeof evento[coluna] === 'object' ? JSON.stringify(evento[coluna]) : evento[coluna])).join(','))].join('\r\n');
};

const carregarJob = async (pool: Pool, input: Readonly<{ tenantId: string; userId: string; jobId: string; correlationId: string }>) =>
  comContextoHumano(pool, { tenantId: input.tenantId, usuarioId: input.userId, correlationId: input.correlationId }, async (client) => {
    const result = await client.query<ExportJob>('SELECT * FROM app.audit_export_job WHERE id=$1 AND tenant_id=$2 AND requested_by=$3', [input.jobId,input.tenantId,input.userId]);
    return result.rows[0] ?? null;
  });

const gerar = async (deps: Readonly<{ pool: Pool; armazenamento: ConfigDoArmazenamento; queue: Queue; s3: S3Client }>, input: unknown) => {
  const command = AuditExportCommandSchema.parse(input);
  const job = await carregarJob(deps.pool, command);
  if (!job || job.estado === 'CONCLUIDA' || job.estado === 'EXPIRADA') return;
  const contexto = { tenantId: command.tenantId, usuarioId: command.userId, correlationId: command.correlationId };
  const marcado = await comContextoHumano(deps.pool, contexto, async (client) => {
    const empresas = await client.query<{ id: string }>(`SELECT id FROM app.empresa WHERE tenant_id=$1 AND id=ANY($2::uuid[]) AND app.empresa_autorizada(id)`, [command.tenantId, job.empresas_autorizadas]);
    if (empresas.rows.length !== job.empresas_autorizadas.length) throw new Error('AUDIT_EXPORT_SCOPE_CHANGED');
    await client.query("UPDATE app.audit_export_job SET estado='PROCESSANDO',atualizado_em=now() WHERE id=$1 AND tenant_id=$2 AND requested_by=$3 AND estado='PENDENTE'", [command.jobId,command.tenantId,command.userId]);
    const fresh = await client.query<ExportJob>('SELECT * FROM app.audit_export_job WHERE id=$1 AND tenant_id=$2 AND requested_by=$3', [command.jobId,command.tenantId,command.userId]);
    return fresh.rows[0] ?? null;
  });
  if (!marcado || marcado.estado !== 'PROCESSANDO') return;

    const eventos: Record<string, unknown>[] = [];
    const contagens = new Map<string, number>();
    for (const empresaId of job.empresas_autorizadas) {
      const { sql, values } = construirFiltro(job.filters, empresaId);
      const cutoff = job.criado_em;
      const result = await comContextoHumano(deps.pool, contexto, (client) => client.query<Record<string, unknown>>(
        `SELECT e.id,e.empresa_id,e.event_type,e.origin,e.occurred_at,e.actor_id,e.actor_kind,e.actor_role,e.agent,e.agent_version,e.model,e.provider,
          e.source_type,e.source_id,e.decision,e.state,e.score,e.measured_cost_microusd,e.input_tokens,e.output_tokens,e.correlation_id,
          e.causation_id,e.envelope_sha256,e.payload_sha256,e.envelope,p.payload
         FROM app.audit_event e LEFT JOIN app.audit_payload p ON p.event_id=e.id WHERE ${sql} AND e.occurred_at <= $${values.length + 2}
         ORDER BY e.occurred_at DESC,e.id DESC`, [command.tenantId,...values,cutoff],
      ));
      contagens.set(empresaId, result.rows.length);
      eventos.push(...result.rows.map((row) => ({ ...row, payload: row['payload'] === null ? null : redigirPayloadDeAuditoria(row['payload'] as never) })));
    }

    const conteudo = job.format === 'JSON' ? JSON.stringify(eventos) : csv(eventos);
    const bytes = Buffer.from(conteudo, 'utf8');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const chave = `${command.tenantId}/auditoria/${command.jobId}.${job.format.toLowerCase()}`;
    const bucket = deps.armazenamento.bucket;
    const expiraEm = new Date(Date.now() + AUDIT_EXPORT_TTL_MS);
    await deps.s3.send(new PutObjectCommand({ Bucket: bucket, Key: chave, Body: bytes,
      ContentType: job.format === 'JSON' ? 'application/json; charset=utf-8' : 'text/csv; charset=utf-8' }));
    await deps.queue.add(AUDIT_EXPORT_EXPIRY_JOB, command, { jobId: `${AUDIT_EXPORT_EXPIRY_JOB}-${command.jobId}`, delay: AUDIT_EXPORT_TTL_MS, attempts: 5, removeOnComplete: true, removeOnFail: false });
    await comContextoHumano(deps.pool, contexto, async (client) => {
      await client.query("UPDATE app.audit_export_job SET estado='CONCLUIDA',storage_key=$4,artifact_sha256=$5,item_count=$6,expires_at=$7,atualizado_em=now() WHERE id=$1 AND tenant_id=$2 AND requested_by=$3 AND estado='PROCESSANDO'", [command.jobId,command.tenantId,command.userId,chave,sha256,eventos.length,expiraEm]);
      for (const empresaId of job.empresas_autorizadas) await client.query(
        `INSERT INTO app.audit_export_manifest(tenant_id,empresa_id,job_id,requested_by,format,filters,item_count,schema_version,artifact_sha256,expires_at)
         VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,1,$8,$9)`,
        [command.tenantId,empresaId,command.jobId,command.userId,job.format,JSON.stringify(job.filters),contagens.get(empresaId)??0,sha256,expiraEm],
      );
    });
};

const expirar = async (deps: Readonly<{ pool: Pool; armazenamento: ConfigDoArmazenamento; s3: S3Client }>, input: unknown) => {
  const command = AuditExportExpiryCommandSchema.parse(input);
  const key = await deps.pool.query<{ storage_key: string | null }>(
    'SELECT app.audit_export_expirar($1,$2,$3,$4) AS storage_key', [command.tenantId,command.jobId,command.userId,command.correlationId],
  ).then((result) => result.rows[0]?.storage_key ?? null);
  if (!key) return;
  await deps.s3.send(new DeleteObjectCommand({ Bucket: deps.armazenamento.bucket, Key: key }));
};

export const iniciarConsumidorDeExportacoesDeAuditoria = async (deps: Readonly<{ pool: Pool; conexao: ConexaoDoRedis; armazenamento: ConfigDoArmazenamento; prefixo?: string }>) => {
  const redis = criarConexaoRedis(deps.conexao);
  const common = { connection: redis, ...(deps.prefixo === undefined ? {} : { prefix: deps.prefixo }) };
  const queue = new Queue(AUDIT_EXPORT_QUEUE, common);
  const s3 = new S3Client({ endpoint: deps.armazenamento.endpoint, region: deps.armazenamento.regiao, forcePathStyle: true,
    credentials: { accessKeyId: deps.armazenamento.usuario, secretAccessKey: deps.armazenamento.senha } });
  const worker = new Worker(AUDIT_EXPORT_QUEUE, async (job: Job<unknown>) => {
    if (job.name === AUDIT_EXPORT_EXPIRY_JOB) await expirar({ ...deps, s3 }, job.data);
    else await gerar({ ...deps, queue, s3 }, job.data);
  }, { ...common, concurrency: 2 });
  worker.on('failed', (job,error) => {
    if (!job || job.attemptsMade < Number(job.opts.attempts ?? 1)) return;
    const parsed = AuditExportCommandSchema.safeParse(job.data);
    if (parsed.success) {
      const command = parsed.data;
      void comContextoHumano(deps.pool, { tenantId: command.tenantId, usuarioId: command.userId, correlationId: command.correlationId }, (client) => client.query(
        "UPDATE app.audit_export_job SET estado='FALHA',error_code=$4,atualizado_em=now() WHERE id=$1 AND tenant_id=$2 AND requested_by=$3 AND estado IN ('PENDENTE','PROCESSANDO')",
        [command.jobId,command.tenantId,command.userId,error.message === 'AUDIT_EXPORT_SCOPE_CHANGED' ? 'ESCOPO_ALTERADO' : 'EXPORTACAO_FALHOU'],
      )).catch((cause: unknown) => console.error(JSON.stringify({ event: 'audit-export-failure-state-update-failed', jobId: job.id, name: cause instanceof Error ? cause.name : 'UnknownError' })));
    }
    console.error(JSON.stringify({ event: 'audit-export-failed', jobId: job.id, name: error.name }));
  });
  worker.on('error', (error) => console.error(JSON.stringify({ event: 'audit-export-worker-error', name: error.name })));
  return { fechar: async () => { await worker.close(); await queue.close(); s3.destroy(); await redis.quit().catch(() => redis.disconnect()); } };
};
