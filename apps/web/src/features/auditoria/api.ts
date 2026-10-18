import { requisitar } from '@/lib/http';

export type FiltrosDeAuditoria = Readonly<Record<string, string | number | undefined>>;
export type EventoDeAuditoria = Readonly<{
  id: string; empresa_id: string; empresa: string | null; event_type: string; origin: string;
  occurred_at: string; actor_id: string | null; ator: string | null; actor_kind: string; actor_role: string | null;
  agent: string | null; agent_version: string | null; model: string | null; provider: string | null;
  source_type: string; source_id: string; decision: string | null; state: string | null; score: string | null;
  measured_cost_microusd: string | null; input_tokens: number | null; output_tokens: number | null;
  correlation_id: string; causation_id: string | null; envelope_sha256: string; payload_sha256: string | null;
  integridade: 'VALIDA' | 'INVALIDA' | 'NAO_VERIFICAVEL';
}>;
export type PaginaDeAuditoria = Readonly<{ eventos: readonly EventoDeAuditoria[]; total: number; pagina: number; limite: number }>;
export type DetalheDeAuditoria = Readonly<Record<string, unknown> & {
  id: string; event_type: string; occurred_at: string; envelope: Readonly<Record<string, unknown>>;
  payload: Readonly<Record<string, unknown>> | null; payload_status: string; envelope_valido: boolean; payload_valido: boolean;
}>;

const query = (filtros: FiltrosDeAuditoria): string => {
  const params = new URLSearchParams();
  for (const [chave, valor] of Object.entries(filtros)) if (valor !== undefined && valor !== '') params.set(chave, String(valor));
  return params.toString();
};

export const listarAuditoria = (filtros: FiltrosDeAuditoria): Promise<PaginaDeAuditoria> =>
  requisitar<PaginaDeAuditoria>('/fiscal/auditoria?' + query(filtros));

export const obterEventoDeAuditoria = (id: string): Promise<DetalheDeAuditoria> =>
  requisitar<DetalheDeAuditoria>('/fiscal/auditoria/' + id);

export const revelarPayloadDeAuditoria = (id: string, justificativa: string): Promise<Readonly<{ eventId: string; payload: unknown }>> =>
  requisitar('/fiscal/auditoria/' + id + '/revelacao', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ justificativa, confirmacao: true }),
  });

export type EstadoDaExportacao = Readonly<{
  id: string; estado: 'PENDENTE' | 'PROCESSANDO' | 'CONCLUIDA' | 'FALHA' | 'EXPIRADA'; format: 'JSON' | 'CSV';
  item_count: number | null; artifact_sha256: string | null; expires_at: string | null; error_code: string | null;
}>;

export const exportarAuditoria = (filtros: FiltrosDeAuditoria, formato: 'JSON' | 'CSV') =>
  requisitar<Readonly<{ id: string; estado: 'PENDENTE' }>>(
    '/fiscal/auditoria/exportacoes?' + query(filtros),
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ formato }) },
  );

export const obterEstadoDaExportacao = (id: string): Promise<EstadoDaExportacao> =>
  requisitar<EstadoDaExportacao>('/fiscal/auditoria/exportacoes/' + id);
