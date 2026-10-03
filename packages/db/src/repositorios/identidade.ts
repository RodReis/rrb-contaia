/**
 * Resolução da identidade OIDC. Único caminho que lê `app.usuario` antes de
 * existir contexto de tenant — por isso passa pela função dedicada do banco,
 * que devolve só o par do próprio `sub` (migrations 0002, 0009 e 0010).
 *
 * A função lê estado, papéis padrão e a matriz vigente dos papéis personalizados
 * ativos a cada chamada: mudança de papel, de matriz, suspensão ou arquivamento
 * valem na próxima requisição, mesmo com o token ainda dentro da validade.
 */
import type { PoolClient } from 'pg';

import type { PapelPadrao, StatusDoTenant } from '@contaia/domain';

export type IdentidadeResolvida = Readonly<{
  usuarioId: string;
  tenantId: string;
  papeis: readonly PapelPadrao[];
  /** Chaves concedidas pelos papéis personalizados ativos (a validação contra o catálogo é do chamador). */
  permissoesPersonalizadas: readonly string[];
  statusDoTenant: StatusDoTenant;
}>;

export const resolverIdentidade = async (
  cliente: PoolClient,
  sub: string,
): Promise<IdentidadeResolvida | null> => {
  const { rows } = await cliente.query<{
    usuario_id: string;
    tenant_id: string;
    papeis: PapelPadrao[];
    permissoes_personalizadas: string[];
    tenant_status: StatusDoTenant;
  }>('select * from app.resolver_identidade($1)', [sub]);

  const linha = rows[0];

  if (linha === undefined) {
    return null;
  }

  return {
    usuarioId: linha.usuario_id,
    tenantId: linha.tenant_id,
    papeis: linha.papeis,
    permissoesPersonalizadas: linha.permissoes_personalizadas,
    statusDoTenant: linha.tenant_status,
  };
};

/**
 * Identidade de um usuário já conhecido (papéis padrão e matriz dos papéis personalizados
 * vigentes), para quem age em nome dele fora de uma sessão — o ticket de ingestão do cofre
 * (SPEC-011). Mesma função de banco da sessão, então a permissão vale AGORA, não a de quando
 * o ticket foi emitido. `null` quando o usuário não está ativo ou não é do tenant.
 */
export const identidadeDoUsuario = async (
  cliente: PoolClient,
  tenantId: string,
  usuarioId: string,
): Promise<IdentidadeResolvida | null> => {
  const { rows } = await cliente.query<{ sub_oidc: string }>(
    'select sub_oidc from app.usuario where tenant_id = $1 and id = $2',
    [tenantId, usuarioId],
  );
  const sub = rows[0]?.sub_oidc;

  if (sub === undefined) {
    return null;
  }

  const identidade = await resolverIdentidade(cliente, sub);

  return identidade !== null && identidade.usuarioId === usuarioId && identidade.tenantId === tenantId
    ? identidade
    : null;
};
