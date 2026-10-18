import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, Optional, ServiceUnavailableException } from '@nestjs/common';
import { comContextoHumano } from '@contaia/db';
import { redigirPayloadDeAuditoria } from '@contaia/domain';
import { AUDIT_EXPORT_JOB, type AuditExportCommand } from '@contaia/shared';
import type { Queue } from 'bullmq';
import { StorageService } from '../comum/storage.service';
import { PoolDoBanco } from '../banco/pool.provider';
import { AUDIT_EXPORT_API_QUEUE } from './auditoria.queue';

export type FiltrosDeAuditoria = Readonly<{
  inicio?: string | undefined; fim?: string | undefined; empresaId?: string | undefined; atorId?: string | undefined; agente?: string | undefined;
  tipo?: string | undefined; estado?: string | undefined; integridade?: 'VALIDA' | 'INVALIDA' | 'NAO_VERIFICAVEL' | undefined; correlationId?: string | undefined;
  pagina: number; limite: number;
}>;

export const construirFiltroSqlDeAuditoria = (f: FiltrosDeAuditoria, inicio = 2): { sql: string; valores: unknown[] } => {
  const condicoes = ['e.tenant_id=$1', 'app.empresa_autorizada(e.empresa_id)'];
  const valores: unknown[] = [];
  const porChave: readonly [keyof FiltrosDeAuditoria, string][] = [
    ['inicio', 'e.occurred_at >= ?::date'], ['fim', 'e.occurred_at < (?::date + interval \'1 day\')'],
    ['empresaId', 'e.empresa_id = ?::uuid'], ['atorId', 'e.actor_id = ?::uuid'], ['agente', 'e.agent = ?'],
    ['tipo', 'e.event_type = ?'], ['estado', 'e.state = ?'], ['correlationId', 'e.correlation_id = ?'],
  ];
  for (const [chave, molde] of porChave) {
    const valor = f[chave];
    if (valor === undefined || typeof valor !== 'string') continue;
    valores.push(valor);
    condicoes.push(molde.replace('?', `$${inicio + valores.length - 1}`));
  }
  if (f.integridade !== undefined) {
    const envelopeValido = "encode(digest(convert_to(e.envelope::text,'UTF8'),'sha256'),'hex')=e.envelope_sha256";
    const payloadValido = "encode(digest(convert_to(p.payload::text,'UTF8'),'sha256'),'hex')=p.payload_sha256";
    if (f.integridade === 'NAO_VERIFICAVEL') condicoes.push('(e.payload_sha256 IS NULL OR p.event_id IS NULL)');
    else if (f.integridade === 'VALIDA') condicoes.push(`(p.event_id IS NOT NULL AND ${envelopeValido} AND ${payloadValido})`);
    else condicoes.push(`(NOT ${envelopeValido} OR (p.event_id IS NOT NULL AND NOT ${payloadValido}))`);
  }
  return { sql: condicoes.join(' AND '), valores };
};

@Injectable()
export class AuditoriaService {
  constructor(
    private readonly pool: PoolDoBanco,
    private readonly storage: StorageService,
    @Optional() @Inject(AUDIT_EXPORT_API_QUEUE) private readonly exportQueue: Queue | null,
  ) {}

  private exigirPapel(papeis: readonly string[]): void {
    if (!papeis.some((papel) => papel === 'admin_escritorio' || papel === 'auditor_readonly')) {
      throw new ForbiddenException('A trilha transversal exige papel admin_escritorio ou auditor_readonly.');
    }
  }

  async listar(tenantId: string, usuarioId: string, correlationId: string, papeis: readonly string[], filtros: FiltrosDeAuditoria) {
    this.exigirPapel(papeis);
    return comContextoHumano(this.pool.instancia, { tenantId, usuarioId, correlationId }, async (client) => {
      const { sql, valores } = construirFiltroSqlDeAuditoria(filtros);
      const params = [tenantId, ...valores];
      const contagem = await client.query<{ total: string }>(`SELECT count(*)::text AS total FROM app.audit_event e LEFT JOIN app.audit_payload p ON p.event_id=e.id WHERE ${sql}`, params);
      const rows = await client.query(
        `SELECT e.id,e.empresa_id,empresa.nome_fantasia AS empresa,e.event_type,e.origin,e.occurred_at,e.actor_id,
          usuario.nome AS ator,e.actor_kind,e.actor_role,e.agent,e.agent_version,e.model,e.provider,
          e.source_type,e.source_id,e.decision,e.state,e.score,e.measured_cost_microusd,e.input_tokens,e.output_tokens,
          e.correlation_id,e.causation_id,e.envelope_sha256,e.payload_sha256,
          CASE WHEN encode(digest(convert_to(e.envelope::text,'UTF8'),'sha256'),'hex')=e.envelope_sha256
            AND (p.event_id IS NULL OR encode(digest(convert_to(p.payload::text,'UTF8'),'sha256'),'hex')=p.payload_sha256)
            THEN CASE WHEN p.event_id IS NULL THEN 'NAO_VERIFICAVEL' ELSE 'VALIDA' END ELSE 'INVALIDA' END AS integridade
         FROM app.audit_event e JOIN app.empresa empresa ON empresa.id=e.empresa_id AND empresa.tenant_id=e.tenant_id
         LEFT JOIN app.usuario usuario ON usuario.id=e.actor_id AND usuario.tenant_id=e.tenant_id
         LEFT JOIN app.audit_payload p ON p.event_id=e.id WHERE ${sql}
         ORDER BY e.occurred_at DESC,e.id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, filtros.limite, (filtros.pagina - 1) * filtros.limite],
      );
      return { eventos: rows.rows, total: Number(contagem.rows[0]?.total ?? 0), pagina: filtros.pagina, limite: filtros.limite };
    });
  }

  async detalhe(tenantId: string, usuarioId: string, correlationId: string, papeis: readonly string[], id: string) {
    this.exigirPapel(papeis);
    return comContextoHumano(this.pool.instancia, { tenantId, usuarioId, correlationId }, async (client) => {
      const result = await client.query(
        `SELECT e.*,p.payload,p.expires_at,CASE WHEN p.event_id IS NULL THEN 'EXPIRADO' ELSE 'DISPONIVEL' END AS payload_status,
          encode(digest(convert_to(e.envelope::text,'UTF8'),'sha256'),'hex')=e.envelope_sha256 AS envelope_valido,
          (p.event_id IS NULL OR encode(digest(convert_to(p.payload::text,'UTF8'),'sha256'),'hex')=p.payload_sha256) AS payload_valido
         FROM app.audit_event e LEFT JOIN app.audit_payload p ON p.event_id=e.id
         WHERE e.tenant_id=$1 AND e.id=$2 AND app.empresa_autorizada(e.empresa_id)`, [tenantId, id]);
      const evento = result.rows[0] as (Record<string, unknown> & { payload?: unknown }) | undefined;
      if (evento === undefined) return null;
      return { ...evento, payload: evento.payload === undefined ? null : redigirPayloadDeAuditoria(evento.payload as never) };
    });
  }

  async revelar(tenantId: string, usuarioId: string, correlationId: string, papeis: readonly string[], id: string, justificativa: string) {
    if (!papeis.includes('admin_escritorio')) throw new ForbiddenException('Somente admin_escritorio pode revelar payload integral.');
    return comContextoHumano(this.pool.instancia, { tenantId, usuarioId, correlationId }, async (client) => {
      const result = await client.query<Record<string, unknown> & { empresa_id: string; payload: unknown; envelope_valido: boolean; payload_valido: boolean }>(
        `SELECT e.empresa_id,p.payload,
          encode(digest(convert_to(e.envelope::text,'UTF8'),'sha256'),'hex')=e.envelope_sha256 AS envelope_valido,
          encode(digest(convert_to(p.payload::text,'UTF8'),'sha256'),'hex')=p.payload_sha256 AS payload_valido
         FROM app.audit_event e JOIN app.audit_payload p ON p.event_id=e.id
         WHERE e.tenant_id=$1 AND e.id=$2 AND p.expires_at>now() AND app.empresa_autorizada(e.empresa_id)`, [tenantId,id]);
      const evento = result.rows[0];
      if (evento === undefined) return null;
      if (evento.envelope_valido !== true || evento.payload_valido !== true) throw new ConflictException('Integridade divergente: conteúdo integral não pode ser revelado.');
      await client.query(
        `INSERT INTO app.audit_payload_revelation(tenant_id,empresa_id,event_id,ator_id,justificativa,correlation_id)
         VALUES($1,$2,$3,$4,$5,$6)`, [tenantId,evento.empresa_id,id,usuarioId,justificativa,correlationId]);
      return { eventId:id, payload:evento.payload };
    });
  }

  async exportar(tenantId: string, usuarioId: string, correlationId: string, papeis: readonly string[], formato: 'JSON' | 'CSV', filtros: FiltrosDeAuditoria) {
    this.exigirPapel(papeis);
    if (this.exportQueue === null) throw new ServiceUnavailableException('Fila de exportação indisponível.');
    const filtrosNormalizados = Object.fromEntries(Object.entries(filtros).filter(([chave, valor]) => valor !== undefined && chave !== 'pagina' && chave !== 'limite' && chave !== 'empresaId'));
    const job = await comContextoHumano(this.pool.instancia, { tenantId, usuarioId, correlationId }, async (client) => {
      const autorizadas = await client.query<{ id: string }>(
        'SELECT id FROM app.empresa WHERE tenant_id=$1 AND app.empresa_autorizada(id) AND ($2::uuid IS NULL OR id=$2) ORDER BY id',
        [tenantId, filtros.empresaId ?? null],
      );
      const empresas = autorizadas.rows.map((row) => row.id);
      if (empresas.length === 0) throw new ForbiddenException('Carteira vazia ou empresa fora da carteira autorizada.');
      const result = await client.query<{ id: string }>(
        `INSERT INTO app.audit_export_job(tenant_id,empresa_id,requested_by,format,filters,empresas_autorizadas,correlation_id)
         VALUES($1,$2,$3,$4,$5::jsonb,$6::uuid[],$7) RETURNING id`,
        [tenantId, empresas[0], usuarioId, formato, JSON.stringify(filtrosNormalizados), empresas, correlationId],
      );
      return result.rows[0]?.id ?? null;
    });
    if (job === null) throw new ServiceUnavailableException('Não foi possível registrar exportação.');
    const comando: AuditExportCommand = { tenantId, userId: usuarioId, jobId: job, correlationId };
    try {
      await this.exportQueue.add(AUDIT_EXPORT_JOB, comando, { jobId: `audit-export-${job}`, attempts: 3, backoff: { type: 'exponential', delay: 1_000 }, removeOnComplete: true, removeOnFail: false });
    } catch {
      await comContextoHumano(this.pool.instancia, { tenantId, usuarioId, correlationId }, (client) => client.query(
        "UPDATE app.audit_export_job SET estado='FALHA',error_code='FILA_INDISPONIVEL',atualizado_em=now() WHERE id=$1 AND tenant_id=$2 AND requested_by=$3 AND estado='PENDENTE'", [job,tenantId,usuarioId],
      ));
      throw new ServiceUnavailableException('Fila de exportação indisponível. Tente novamente.');
    }
    return { id: job, estado: 'PENDENTE' as const };
  }

  async estadoDaExportacao(tenantId: string, usuarioId: string, correlationId: string, papeis: readonly string[], id: string) {
    this.exigirPapel(papeis);
    return comContextoHumano(this.pool.instancia, { tenantId, usuarioId, correlationId }, async (client) => {
      const result = await client.query<{ id:string; estado:string; format:string; item_count:number|null; artifact_sha256:string|null; expires_at:Date|null; error_code:string|null }>(
        "SELECT id,CASE WHEN estado='CONCLUIDA' AND expires_at<=now() THEN 'EXPIRADA' ELSE estado END AS estado,format,item_count,artifact_sha256,expires_at,error_code FROM app.audit_export_job WHERE tenant_id=$1 AND requested_by=$2 AND id=$3", [tenantId,usuarioId,id],
      );
      return result.rows[0] ?? null;
    });
  }

  async baixarExportacao(tenantId: string, usuarioId: string, correlationId: string, papeis: readonly string[], id: string) {
    this.exigirPapel(papeis);
    const job = await comContextoHumano(this.pool.instancia, { tenantId, usuarioId, correlationId }, async (client) => {
      const result = await client.query<{ empresa_id:string; empresas_autorizadas:string[]; storage_key:string|null; format:'JSON'|'CSV'; expires_at:Date|null; estado:string }>(
        'SELECT empresa_id,empresas_autorizadas,storage_key,format,expires_at,estado FROM app.audit_export_job WHERE tenant_id=$1 AND requested_by=$2 AND id=$3', [tenantId,usuarioId,id],
      );
      const row = result.rows[0];
      if (!row || row.estado !== 'CONCLUIDA' || row.expires_at === null || row.expires_at.getTime() <= Date.now() || row.storage_key === null) return null;
      const validacao = await client.query<{ total:string }>(
        'SELECT count(*)::text total FROM app.empresa WHERE tenant_id=$1 AND id=ANY($2::uuid[]) AND app.empresa_autorizada(id)', [tenantId,row.empresas_autorizadas],
      );
      if (Number(validacao.rows[0]?.total ?? 0) !== row.empresas_autorizadas.length) return null;
      return row;
    });
    if (job === null) throw new NotFoundException('Exportação indisponível, expirada ou fora do escopo atual.');
    const arquivo = await this.storage.obter(job.storage_key!);
    await comContextoHumano(this.pool.instancia, { tenantId, usuarioId, correlationId }, (client) => client.query(
      'INSERT INTO app.audit_export_download(tenant_id,empresa_id,job_id,requested_by,correlation_id) VALUES($1,$2,$3,$4,$5)',
      [tenantId,job.empresa_id,id,usuarioId,correlationId],
    ));
    return { conteudo: arquivo.conteudo, formato: job.format, nome: `auditoria-${id}.${job.format.toLowerCase()}` };
  }
}
