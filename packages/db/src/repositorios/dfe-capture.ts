import type { DfeBatchItem, DfeCaptureState } from '@contaia/domain';
import type { PoolClient } from 'pg';

export type DfeCaptureStateRecord = Readonly<{
  id: string;
  tenantId: string;
  companyId: string;
  cnpj: string;
  lastNsu: string;
  maxNsu: string;
  averageTimeMs: number;
  nextAllowedAt: Date;
  state: DfeCaptureState;
  blockedUntil: Date | null;
  consecutiveFailures: number;
  lastSuccessAt: Date | null;
  lastErrorCode: string | null;
  version: number;
}>;

const mapState = (row: {
  id: string; tenant_id: string; empresa_id: string; cnpj: string; ult_nsu: string; max_nsu: string;
  tempo_medio_ms: number; proximo_instante_permitido: Date; estado: DfeCaptureState; bloqueado_ate: Date | null;
  falhas_consecutivas: number; ultimo_sucesso_em: Date | null; ultimo_erro_codigo: string | null; versao: number;
}): DfeCaptureStateRecord => ({
  id: row.id, tenantId: row.tenant_id, companyId: row.empresa_id, cnpj: row.cnpj,
  lastNsu: row.ult_nsu, maxNsu: row.max_nsu, averageTimeMs: row.tempo_medio_ms,
  nextAllowedAt: row.proximo_instante_permitido, state: row.estado, blockedUntil: row.bloqueado_ate,
  consecutiveFailures: row.falhas_consecutivas, lastSuccessAt: row.ultimo_sucesso_em,
  lastErrorCode: row.ultimo_erro_codigo, version: row.versao,
});

export const ensureDfeCaptureState = async (
  client: PoolClient,
  input: Readonly<{ tenantId: string; companyId: string; cnpj: string }>,
): Promise<DfeCaptureStateRecord> => {
  const { rows } = await client.query(
    `insert into app.dfe_capture_state (tenant_id, empresa_id, cnpj)
     values ($1, $2, $3)
     on conflict (tenant_id, empresa_id, cnpj) do nothing
     returning *`,
    [input.tenantId, input.companyId, input.cnpj],
  );
  if (rows[0] !== undefined) return mapState(rows[0] as Parameters<typeof mapState>[0]);
  const existing = await client.query(`select * from app.dfe_capture_state where tenant_id=$1 and empresa_id=$2 and cnpj=$3`, [input.tenantId,input.companyId,input.cnpj]);
  if (existing.rows[0] === undefined) throw new Error('DFE_CAPTURE_STATE_NOT_FOUND');
  return mapState(existing.rows[0] as Parameters<typeof mapState>[0]);
};

export const getDfeCaptureCompany = async (client: PoolClient, companyId: string): Promise<Readonly<{ id: string; tenantId: string; cnpj: string; active: boolean }> | null> => {
  const { rows } = await client.query<{ id: string; tenant_id: string; cnpj: string; status: string; situacao: string }>(
    `select * from app.dfe_capture_empresa($1)`, [companyId],
  );
  const row = rows[0];
  return row === undefined ? null : { id: row.id, tenantId: row.tenant_id, cnpj: row.cnpj, active: row.status === 'ATIVA' && row.situacao === 'ativo' };
};

/** So metadados: a chave e o certificado continuam exclusivos do Signer. */
export const hasDfeCaptureCertificate = async (client: PoolClient, companyId: string, now: Date): Promise<boolean> => {
  const { rows } = await client.query<{ available: boolean }>(
    `select app.dfe_capture_certificado_vigente($1, $2) as available`,
    [companyId, now],
  );
  return rows[0]?.available === true;
};

export const getDfeCaptureState = async (client: PoolClient, companyId: string): Promise<DfeCaptureStateRecord | null> => {
  const { rows } = await client.query(`select * from app.dfe_capture_state where empresa_id = $1 order by cnpj limit 1`, [companyId]);
  return rows[0] === undefined ? null : mapState(rows[0] as Parameters<typeof mapState>[0]);
};

export type DfeCaptureRun = Readonly<{ id: string; reused: boolean; idempotencyKey: string; correlationId: string; origin: 'AUTOMATIC' | 'MANUAL'; originatingUserId: string | null; terminal: boolean }>;

const currentAlert = async (client: PoolClient, state: DfeCaptureStateRecord): Promise<Readonly<{ tipo: 'OPENED' | 'RESOLVED'; causa: 'DLQ' | 'BLOCKED_656'; codigo: string }> | null> => {
  await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`${state.tenantId}:${state.companyId}:${state.cnpj}:dfe-alert`]);
  const { rows } = await client.query<{ tipo: 'OPENED' | 'RESOLVED'; causa: 'DLQ' | 'BLOCKED_656'; codigo: string }>(
    `select tipo, causa, codigo from app.dfe_capture_alert_event
      where tenant_id=$1 and empresa_id=$2 and cnpj=$3 order by sequencia desc limit 1`,
    [state.tenantId, state.companyId, state.cnpj],
  );
  return rows[0] ?? null;
};

const alertEvent = async (client: PoolClient, input: Readonly<{ state: DfeCaptureStateRecord; runId: string; type: 'OPENED' | 'RESOLVED'; cause: 'DLQ' | 'BLOCKED_656'; code: string; correlationId: string; at: Date }>): Promise<void> => {
  await client.query(
    `insert into app.dfe_capture_alert_event
       (tenant_id, empresa_id, run_id, cnpj, tipo, causa, codigo, correlation_id, ocorrido_em)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [input.state.tenantId, input.state.companyId, input.runId, input.state.cnpj, input.type,
      input.cause, input.code, input.correlationId, input.at],
  );
};

export const marcarDfeCaptureEmExecucao = async (client: PoolClient, runId: string, state: DfeCaptureStateRecord, now: Date): Promise<boolean> => {
  const updated = await client.query(
    `update app.dfe_capture_state set estado='CAPTURING', bloqueado_ate=null, versao=versao+1, atualizado_em=$1 where id=$2 and versao=$3 and estado <> 'DISABLED' returning id`,
    [now, state.id, state.version],
  );
  if (updated.rowCount !== 1) return false;
  const started = await client.query(`update app.dfe_capture_run set estado='RUNNING', iniciado_em=coalesce(iniciado_em,$1), tentativa=least(tentativa+1,3) where id=$2 and estado='QUEUED'`, [now, runId]);
  if (started.rowCount !== 1) throw new Error('DFE_CAPTURE_CONFLICT');
  return true;
};

export const reservarJanelaDfeTenant = async (client: PoolClient, runId: string): Promise<Readonly<{ reserved: boolean; nextWindow: Date }>> => {
  const { rows } = await client.query<{ reservado: boolean; proxima_janela: Date }>(
    'select * from app.reservar_janela_dfe_tenant($1)', [runId]);
  const row = rows[0];
  if (!row) throw new Error('DFE_CAPTURE_RATE_LIMIT_UNAVAILABLE');
  return { reserved: row.reservado, nextWindow: row.proxima_janela };
};

export const registrarFalhaDfeCapture = async (client: PoolClient, input: Readonly<{ state: DfeCaptureStateRecord; runId: string; code: string; attempt: number; failedAt: Date; blockedUntil?: Date | null; retrying?: boolean }>): Promise<void> => {
  const dead = input.attempt >= 3;
  const blocked = input.blockedUntil !== null && input.blockedUntil !== undefined;
  await client.query(
    `update app.dfe_capture_state set estado=$1, bloqueado_ate=$2, falhas_consecutivas=falhas_consecutivas+1, ultimo_erro_codigo=$3, versao=versao+1, atualizado_em=$4 where id=$5`,
    [blocked ? 'BLOCKED_656' : input.retrying ? 'CAPTURING' : 'FAILED', input.blockedUntil ?? null, input.code, input.failedAt, input.state.id],
  );
  await client.query(`update app.dfe_capture_run set estado=$1, tentativa=$2, codigo=$3, finalizado_em=$4 where id=$5`, [blocked ? 'BLOCKED_656' : dead ? 'DEAD' : input.retrying ? 'QUEUED' : 'FAILED', input.attempt, input.code, dead || blocked || !input.retrying ? input.failedAt : null, input.runId]);
  const run = await client.query<{ correlation_id: string }>('select correlation_id from app.dfe_capture_run where id=$1', [input.runId]);
  const correlationId = run.rows[0]?.correlation_id ?? '';
  await client.query(`insert into app.dfe_capture_event (tenant_id,empresa_id,run_id,cnpj,tipo,codigo,tentativa,correlation_id,ocorrido_em) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [input.state.tenantId,input.state.companyId,input.runId,input.state.cnpj,blocked?'BLOCKED_656':dead?'DEAD':'FAILED',input.code,input.attempt,correlationId,input.failedAt]);
  if ((blocked || dead) && (await currentAlert(client, input.state))?.tipo !== 'OPENED') {
    await alertEvent(client, { state: input.state, runId: input.runId, type: 'OPENED',
      cause: blocked ? 'BLOCKED_656' : 'DLQ', code: input.code, correlationId, at: input.failedAt });
  }
};

export const createOrReuseDfeCaptureRun = async (
  client: PoolClient,
  input: Readonly<{
    state: DfeCaptureStateRecord; origin: 'AUTOMATIC' | 'MANUAL'; originatingUserId: string | null;
    idempotencyKey: string; correlationId: string; occurredAt: Date;
  }>,
): Promise<DfeCaptureRun> => {
  await client.query(
    `select pg_advisory_xact_lock(hashtextextended($1, 0))`,
    [`${input.state.tenantId}:${input.state.companyId}:${input.state.cnpj}`],
  );
  const existing = await client.query<{ id: string; chave_idempotente: string; ult_nsu_entrada: string; cnpj: string; correlation_id: string; origem: 'AUTOMATIC' | 'MANUAL'; usuario_originador_id: string | null }>(
    `select id, chave_idempotente, ult_nsu_entrada, cnpj, correlation_id, origem, usuario_originador_id from app.dfe_capture_run
      where tenant_id = $1 and empresa_id = $2 and cnpj = $3 and estado in ('QUEUED', 'RUNNING')
      order by sequencia desc limit 1`,
    [input.state.tenantId, input.state.companyId, input.state.cnpj],
  );
  if (existing.rows[0] !== undefined) {
    const run = existing.rows[0];
    if (run.cnpj !== input.state.cnpj || run.ult_nsu_entrada !== input.state.lastNsu) {
      throw new Error('DFE_CAPTURE_IDEMPOTENCY_CONFLICT');
    }
    return { id: run.id, reused: true, idempotencyKey: run.chave_idempotente, correlationId: run.correlation_id, origin: run.origem, originatingUserId: run.usuario_originador_id, terminal: false };
  }

  const byKey = await client.query<{ id: string; cnpj: string; ult_nsu_entrada: string; estado: string; correlation_id: string; origem: 'AUTOMATIC' | 'MANUAL'; usuario_originador_id: string | null; chave_idempotente: string }>(
    `select id, cnpj, ult_nsu_entrada, estado, correlation_id, origem, usuario_originador_id, chave_idempotente from app.dfe_capture_run
      where tenant_id = $1 and empresa_id = $2 and chave_idempotente = $3`,
    [input.state.tenantId, input.state.companyId, input.idempotencyKey],
  );
  if (byKey.rows[0] !== undefined) {
    const run = byKey.rows[0];
    if (run.cnpj !== input.state.cnpj || (!['SUCCEEDED', 'FAILED', 'DEAD', 'BLOCKED_656'].includes(run.estado) && run.ult_nsu_entrada !== input.state.lastNsu)) {
      throw new Error('DFE_CAPTURE_IDEMPOTENCY_CONFLICT');
    }
    return { id: run.id, reused: true, idempotencyKey: run.chave_idempotente, correlationId: run.correlation_id, origin: run.origem, originatingUserId: run.usuario_originador_id, terminal: ['SUCCEEDED', 'FAILED', 'DEAD', 'BLOCKED_656'].includes(run.estado) };
  }

  const { rows } = await client.query<{ id: string }>(
    `insert into app.dfe_capture_run
       (tenant_id, empresa_id, estado_id, cnpj, origem, usuario_originador_id,
        chave_idempotente, correlation_id, ult_nsu_entrada)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     returning id`,
    [input.state.tenantId, input.state.companyId, input.state.id, input.state.cnpj, input.origin,
      input.originatingUserId, input.idempotencyKey, input.correlationId, input.state.lastNsu],
  );
  const id = rows[0]!.id;
  await client.query(
    `insert into app.dfe_capture_event
       (tenant_id, empresa_id, run_id, cnpj, tipo, tentativa, correlation_id, ocorrido_em)
     values ($1,$2,$3,$4,'QUEUED',0,$5,$6)`,
    [input.state.tenantId, input.state.companyId, id, input.state.cnpj, input.correlationId, input.occurredAt],
  );
  return { id, reused: false, idempotencyKey: input.idempotencyKey, correlationId: input.correlationId, origin: input.origin, originatingUserId: input.originatingUserId, terminal: false };
};

export const prepararReprocessamentoDfeCapture = async (
  client: PoolClient,
  input: Readonly<{ state: DfeCaptureStateRecord; runId: string; actorId: string; reprocessedAt: Date }>,
): Promise<Readonly<{ id: string; idempotencyKey: string; correlationId: string; origin: 'AUTOMATIC' | 'MANUAL'; originatingUserId: string | null }> | null> => {
  const { rows } = await client.query<{ id: string; chave_idempotente: string; correlation_id: string; origem: 'AUTOMATIC' | 'MANUAL'; usuario_originador_id: string | null }>(
    `select id, chave_idempotente, correlation_id, origem, usuario_originador_id
       from app.dfe_capture_run
      where id=$1 and estado='DEAD' and empresa_id=$2 and tenant_id=$3
      for update`,
    [input.runId, input.state.companyId, input.state.tenantId],
  );
  const run = rows[0];
  if (run === undefined || input.state.state !== 'FAILED' || input.state.nextAllowedAt > input.reprocessedAt) return null;
  const updatedState = await client.query(
    `update app.dfe_capture_state set estado='READY', versao=versao+1, atualizado_em=$1
      where id=$2 and versao=$3 and estado='FAILED' returning id`,
    [input.reprocessedAt, input.state.id, input.state.version],
  );
  if (updatedState.rowCount !== 1) return null;
  const updatedRun = await client.query(
    `update app.dfe_capture_run set estado='QUEUED', finalizado_em=null, codigo=null
      where id=$1 and estado='DEAD' returning id`, [run.id],
  );
  if (updatedRun.rowCount !== 1) throw new Error('DFE_CAPTURE_CONFLICT');
  await client.query(
    `insert into app.dfe_capture_event
       (tenant_id, empresa_id, run_id, cnpj, tipo, tentativa, correlation_id, ocorrido_em, usuario_ator_id)
     values ($1,$2,$3,$4,'QUEUED',3,$5,$6,$7)`,
    [input.state.tenantId, input.state.companyId, run.id, input.state.cnpj, run.correlation_id, input.reprocessedAt, input.actorId],
  );
  return { id: run.id, idempotencyKey: run.chave_idempotente, correlationId: run.correlation_id,
    origin: run.origem, originatingUserId: run.usuario_originador_id };
};

export type CommitDfeBatchInput = Readonly<{
    state: DfeCaptureStateRecord;
    runId: string;
  returnedLastNsu: string;
  maxNsu: string;
  averageTimeMs: number;
  nextAllowedAt: Date;
  capturedAt: Date;
  attempt: number;
  correlationId: string;
  items: readonly DfeBatchItem[];
}>;

export const commitDfeBatch = async (client: PoolClient, input: CommitDfeBatchInput): Promise<Readonly<{ created: number; deduplicated: number }>> => {
  let created = 0;
  for (const item of input.items) {
    if (item.accessKey !== null) {
      const byKey = await client.query<{ nsu: string; conteudo_bruto: Buffer }>(
        `select nsu, conteudo_bruto from app.dfe_capture_staging
          where tenant_id=$1 and empresa_id=$2 and chave_acesso=$3`,
        [input.state.tenantId, input.state.companyId, item.accessKey],
      );
      const keyed = byKey.rows[0];
      if (keyed !== undefined && (keyed.nsu !== item.nsu || !keyed.conteudo_bruto.equals(Buffer.from(item.rawContent, 'utf8')))) {
        throw new Error('DFE_CAPTURE_CONFLICT');
      }
    }
    const result = await client.query(
      `insert into app.dfe_capture_staging
         (tenant_id, empresa_id, run_id, cnpj, nsu, chave_acesso, especie, conteudo_bruto,
          disponibilizado_em, capturado_em, correlation_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       on conflict (tenant_id, empresa_id, cnpj, nsu) do nothing
      returning id`,
      [input.state.tenantId, input.state.companyId, input.runId, input.state.cnpj, item.nsu,
        item.accessKey, item.kind, Buffer.from(item.rawContent, 'utf8'), item.availableAt ?? null, input.capturedAt, input.correlationId],
    ).catch((error: unknown) => {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
        throw new Error('DFE_CAPTURE_CONFLICT');
      }
      throw error;
    });
    if (result.rowCount === 1) {
      created += 1;
      continue;
    }
    const existing = await client.query<{ chave_acesso: string | null; conteudo_bruto: Buffer }>(
      `select chave_acesso, conteudo_bruto from app.dfe_capture_staging
        where tenant_id=$1 and empresa_id=$2 and cnpj=$3 and nsu=$4`,
      [input.state.tenantId, input.state.companyId, input.state.cnpj, item.nsu],
    );
    const row = existing.rows[0];
    if (row === undefined || row.chave_acesso !== item.accessKey || !row.conteudo_bruto.equals(Buffer.from(item.rawContent, 'utf8'))) {
      throw new Error('DFE_CAPTURE_CONFLICT');
    }
  }
  const deduplicated = input.items.length - created;
  const updated = await client.query(
    `update app.dfe_capture_state
        set ult_nsu=$1, max_nsu=$2, tempo_medio_ms=$3, proximo_instante_permitido=$4,
            estado='WAITING', bloqueado_ate=null, falhas_consecutivas=0, ultimo_sucesso_em=$5,
            ultimo_erro_codigo=null, versao=versao+1, atualizado_em=$5
      where id=$6 and versao=$7 and $1::numeric >= ult_nsu::numeric
      returning id`,
    [input.returnedLastNsu, input.maxNsu, input.averageTimeMs, input.nextAllowedAt, input.capturedAt,
      input.state.id, input.state.version],
  );
  if (updated.rowCount !== 1) throw new Error('DFE_CAPTURE_CONFLICT');

  const completed = await client.query(
    `update app.dfe_capture_run
        set estado='SUCCEEDED', ult_nsu_retorno=$1, max_nsu_retorno=$2,
            quantidade_recebida=$3, quantidade_criada=$4, quantidade_deduplicada=$5,
            finalizado_em=$6, codigo=null
      where id=$7 and estado='RUNNING'`,
    [input.returnedLastNsu, input.maxNsu, input.items.length, created, deduplicated, input.capturedAt, input.runId],
  );
  if (completed.rowCount !== 1) throw new Error('DFE_CAPTURE_CONFLICT');
  await client.query(
    `insert into app.dfe_capture_event
       (tenant_id, empresa_id, run_id, cnpj, tipo, tentativa, correlation_id, ocorrido_em)
     values ($1,$2,$3,$4,'SUCCEEDED',$5,$6,$7)`,
    [input.state.tenantId, input.state.companyId, input.runId, input.state.cnpj, input.attempt, input.correlationId, input.capturedAt],
  );
  const alert = await currentAlert(client, input.state);
  if (alert?.tipo === 'OPENED') {
    await alertEvent(client, { state: input.state, runId: input.runId, type: 'RESOLVED',
      cause: alert.causa, code: alert.codigo, correlationId: input.correlationId, at: input.capturedAt });
    await client.query(
      `insert into app.dfe_capture_event
         (tenant_id, empresa_id, run_id, cnpj, tipo, tentativa, correlation_id, ocorrido_em)
       values ($1,$2,$3,$4,'RECOVERED',$5,$6,$7)`,
      [input.state.tenantId, input.state.companyId, input.runId, input.state.cnpj,
        input.attempt, input.correlationId, input.capturedAt],
    );
  }
  return { created, deduplicated };
};

export const listDfeCaptureRuns = async (client: PoolClient, companyId: string, page: number, pageSize = 15) => {
  const offset = (page - 1) * pageSize;
  const { rows } = await client.query(
    `select id, origem, estado, tentativa, ult_nsu_entrada, ult_nsu_retorno, max_nsu_retorno,
            quantidade_recebida, quantidade_criada, quantidade_deduplicada, codigo,
            correlation_id, iniciado_em, finalizado_em, criado_em
       from app.dfe_capture_run where empresa_id=$1
      order by criado_em desc, sequencia desc limit $2 offset $3`,
    [companyId, pageSize, offset],
  );
  return rows;
};

export const getDfeCaptureMetrics = async (client: PoolClient, companyId: string) => {
  const { rows } = await client.query<{
    total_execucoes: string; documentos_recebidos: string; duplicados_evitados: string;
    duracao_media_ms: number | null; atraso_medio_fila_ms: number | null;
    falhas: string; dlq: string;
  }>(
    `select count(*)::text total_execucoes,
            coalesce(sum(quantidade_recebida),0)::text documentos_recebidos,
            coalesce(sum(quantidade_deduplicada),0)::text duplicados_evitados,
            coalesce(avg(extract(epoch from (finalizado_em-iniciado_em))*1000)
              filter (where iniciado_em is not null and finalizado_em is not null),0)::float8 duracao_media_ms,
            coalesce(avg(extract(epoch from (coalesce(iniciado_em, now())-criado_em))*1000),0)::float8 atraso_medio_fila_ms,
            count(*) filter (where estado in ('FAILED','DEAD','BLOCKED_656'))::text falhas,
            count(*) filter (where estado='DEAD')::text dlq
       from app.dfe_capture_run
      where empresa_id=$1 and criado_em >= now()-interval '30 days'`, [companyId],
  );
  const rejected = await client.query<{ total: string }>(
    `select count(*)::text total from app.dfe_capture_event
      where empresa_id=$1 and tipo='BLOCKED_656' and ocorrido_em >= now()-interval '30 days'`, [companyId],
  );
  const row = rows[0]!;
  return {
    totalExecucoes: Number(row.total_execucoes), documentosRecebidos: Number(row.documentos_recebidos),
    duplicadosEvitados: Number(row.duplicados_evitados), duracaoMediaMs: row.duracao_media_ms ?? 0,
    atrasoMedioFilaMs: row.atraso_medio_fila_ms ?? 0, falhas: Number(row.falhas), dlq: Number(row.dlq),
    rejeicoes656: Number(rejected.rows[0]?.total ?? 0),
  };
};
