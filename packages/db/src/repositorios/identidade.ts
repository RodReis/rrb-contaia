/**
 * Resolução da identidade OIDC. Único caminho que lê `app.usuario` antes de
 * existir contexto de tenant — por isso passa pela função dedicada do banco,
 * que devolve só o par do próprio `sub` (migration 0002).
 */
import type { PoolClient } from 'pg';

import type { StatusDoTenant } from '@contaia/domain';

export type IdentidadeResolvida = Readonly<{
  usuarioId: string;
  tenantId: string;
  papel: string;
  statusDoTenant: StatusDoTenant;
}>;

export const resolverIdentidade = async (
  cliente: PoolClient,
  sub: string,
): Promise<IdentidadeResolvida | null> => {
  const { rows } = await cliente.query<{
    usuario_id: string;
    tenant_id: string;
    papel: string;
    tenant_status: StatusDoTenant;
  }>('select * from app.resolver_identidade($1)', [sub]);

  const linha = rows[0];

  if (linha === undefined) {
    return null;
  }

  return {
    usuarioId: linha.usuario_id,
    tenantId: linha.tenant_id,
    papel: linha.papel,
    statusDoTenant: linha.tenant_status,
  };
};
