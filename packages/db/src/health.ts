import type { Pool } from 'pg';

export type SaudeDoBanco = { readonly ok: true };

export type RoleDaAplicacao = {
  readonly existe: boolean;
  readonly bypassRls: boolean;
  readonly superusuario: boolean;
};

export const verificarSaudeDoBanco = async (pool: Pool): Promise<SaudeDoBanco> => {
  await pool.query('select 1');
  return { ok: true };
};

/**
 * O papel da aplicação nunca tem BYPASSRLS (ARCHITECTURE.md §5.1): com ele,
 * a RLS de dois níveis deixa de valer e o isolamento entre tenants some.
 */
export const verificarRoleDaAplicacao = async (
  pool: Pool,
  nome: string,
): Promise<RoleDaAplicacao> => {
  const { rows } = await pool.query<{ rolbypassrls: boolean; rolsuper: boolean }>(
    'select rolbypassrls, rolsuper from pg_roles where rolname = $1',
    [nome],
  );

  const role = rows[0];

  if (!role) {
    return { existe: false, bypassRls: false, superusuario: false };
  }

  return { existe: true, bypassRls: role.rolbypassrls, superusuario: role.rolsuper };
};
