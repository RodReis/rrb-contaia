import { ForbiddenException, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { comContextoHumano } from '@contaia/db';
import { redigirPayloadDeAuditoria } from '@contaia/domain';
import { PoolDoBanco } from '../banco/pool.provider';

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
  constructor(private readonly pool: PoolDoBanco) {}

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

  async exportar(tenantId: string, usuarioId: string, correlationId: string, papeis: readonly string[], formato: 'JSON' | 'CSV', filtros: FiltrosDeAuditoria) {
    this.exigirPapel(papeis);
    return comContextoHumano(this.pool.instancia, { tenantId, usuarioId, correlationId }, async (client) => {
      const semPaginacao = { ...filtros, pagina: 1, limite: 1000000 };
      const { sql, valores } = construirFiltroSqlDeAuditoria(semPaginacao);
      const result = await client.query(
        `SELECT e.id,e.empresa_id,e.event_type,e.origin,e.occurred_at,e.actor_id,e.actor_kind,e.actor_role,e.agent,e.agent_version,e.model,e.provider,
          e.source_type,e.source_id,e.decision,e.state,e.score,e.measured_cost_microusd,e.input_tokens,e.output_tokens,e.correlation_id,
          e.causation_id,e.envelope_sha256,e.payload_sha256,e.envelope,p.payload
         FROM app.audit_event e LEFT JOIN app.audit_payload p ON p.event_id=e.id WHERE ${sql} ORDER BY e.occurred_at DESC,e.id DESC`, [tenantId, ...valores]);
      const eventos = result.rows.map((row) => ({ ...row, payload: row.payload === null ? null : redigirPayloadDeAuditoria(row.payload as never) }));
      const filtrosNormalizados = Object.fromEntries(Object.entries(filtros).filter(([, value]) => value !== undefined));
      const conteudo = formato === 'JSON' ? JSON.stringify(eventos) : this.csv(eventos);
      const hash = createHash('sha256').update(conteudo, 'utf8').digest('hex');
      const empresas = [...new Set(eventos.map((evento) => String(evento.empresa_id)))];
      if (empresas.length === 0 && filtros.empresaId !== undefined) {
        const autorizada = await client.query<{ id: string }>('SELECT id FROM app.empresa WHERE tenant_id=$1 AND id=$2 AND app.empresa_autorizada(id)', [tenantId, filtros.empresaId]);
        if (autorizada.rows[0] === undefined) throw new ForbiddenException('Empresa fora da carteira autorizada.');
        empresas.push(filtros.empresaId);
      }
      // Um manifesto vazio ainda precisa apontar a um escopo único; usar a primeira empresa
      // autorizada só quando o filtro não identifica uma, sem sugerir que o artefato cubra outras.
      if (empresas.length === 0) empresas.push(await this.empresaDoManifesto(client, tenantId));
      for (const empresaId of empresas) {
        await client.query(
          `INSERT INTO app.audit_export_manifest(tenant_id,empresa_id,requested_by,format,filters,item_count,schema_version,artifact_sha256)
           VALUES($1,$2,$3,$4,$5::jsonb,$6,1,$7)`,
          [tenantId, empresaId, usuarioId, formato, JSON.stringify(filtrosNormalizados), eventos.length, hash],
        );
      }
      return { formato, arquivo: formato === 'JSON' ? 'auditoria.json' : 'auditoria.csv', sha256: hash, quantidade: eventos.length, conteudo };
    });
  }

  private async empresaDoManifesto(client: import('pg').PoolClient, tenantId: string): Promise<string> {
    const result = await client.query<{ id: string }>('SELECT id FROM app.empresa WHERE tenant_id=$1 AND app.empresa_autorizada(id) ORDER BY id LIMIT 1', [tenantId]);
    if (result.rows[0] === undefined) throw new ForbiddenException('Carteira vazia: não há escopo autorizado para exportar.');
    return result.rows[0].id;
  }

  private csv(eventos: readonly Record<string, unknown>[]): string {
    const colunas = ['id','empresa_id','event_type','origin','occurred_at','actor_id','actor_kind','agent','decision','state','correlation_id','envelope_sha256','payload_sha256','payload'];
    const escape = (valor: unknown): string => `"${String(valor ?? '').replaceAll('"', '""')}"`;
    return [colunas.join(','), ...eventos.map((evento) => colunas.map((coluna) => escape(typeof evento[coluna] === 'object' ? JSON.stringify(evento[coluna]) : evento[coluna])).join(','))].join('\r\n');
  }
}
