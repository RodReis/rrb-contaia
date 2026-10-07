/**
 * Monitor global do Signer (SPEC-012 §3.10). O monitor é UM para todos os escritórios, então as
 * tabelas ficam fechadas para a aplicação e só estas funções SECURITY DEFINER entram — e cada uma
 * exige o contexto de serviço `MONITORAMENTO_DO_SIGNER` (sem tenant, empresa nem usuário).
 */
import type { PoolClient } from 'pg';

export type EstadoDoMonitorNoBanco = Readonly<{
  /** Falhas depois da última verificação válida. */
  falhasConsecutivas: number;
  incidenteId: string | null;
  incidenteAbertoEm: Date | null;
}>;

export const registrarVerificacao = async (
  cliente: PoolClient,
  verificacao: Readonly<{
    resultado: 'OK' | 'FALHA';
    latenciaMs: number | null;
    correlationId: string;
    /** A resposta foi válida, mas o Signer se disse `DEGRADADO` (ex.: Vault selado). */
    degradado?: boolean;
  }>,
): Promise<void> => {
  await cliente.query('select app.signer_registrar_verificacao($1, $2, $3, $4)', [
    verificacao.resultado,
    verificacao.latenciaMs,
    verificacao.correlationId,
    verificacao.degradado ?? false,
  ]);
};

export const estadoDoMonitor = async (cliente: PoolClient): Promise<EstadoDoMonitorNoBanco> => {
  const { rows } = await cliente.query<{
    falhas_consecutivas: number;
    incidente_id: string | null;
    incidente_aberto_em: Date | null;
  }>('select * from app.signer_estado_do_monitor()');
  const linha = rows[0];

  return {
    falhasConsecutivas: linha?.falhas_consecutivas ?? 0,
    incidenteId: linha?.incidente_id ?? null,
    incidenteAbertoEm: linha?.incidente_aberto_em ?? null,
  };
};

/** Abre o incidente; se já houver um aberto, devolve esse (nunca dois ao mesmo tempo). */
export const abrirIncidente = async (cliente: PoolClient): Promise<string> => {
  const { rows } = await cliente.query<{ id: string }>('select app.signer_abrir_incidente() as id');

  return (rows[0] as { id: string }).id;
};

export const encerrarIncidente = async (
  cliente: PoolClient,
  incidenteId: string,
  duracaoMs: number,
): Promise<void> => {
  await cliente.query('select app.signer_encerrar_incidente($1, $2)', [incidenteId, duracaoMs]);
};

/** Devolve quantas notificações criou; reprocessar não duplica. */
export const notificarIncidente = async (
  cliente: PoolClient,
  incidenteId: string,
  tipo: 'INDISPONIBILIDADE' | 'RECUPERACAO',
  duracaoMs: number | null,
): Promise<number> => {
  const { rows } = await cliente.query<{ n: number }>(
    'select app.signer_notificar_incidente($1, $2, $3) as n',
    [incidenteId, tipo, duracaoMs],
  );

  return rows[0]?.n ?? 0;
};
