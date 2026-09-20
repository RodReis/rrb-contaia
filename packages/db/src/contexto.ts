/**
 * Contexto de tenant da requisição (ARCHITECTURE.md §5.1).
 *
 * Toda leitura ou escrita do produto passa por aqui: abre transação, define
 * `app.tenant_id` com `SET LOCAL` e só então executa. Sem o contexto as
 * políticas de RLS não encontram tenant e a consulta não retorna nada (I-2).
 */
import type { Pool, PoolClient } from 'pg';

export type ExecutarNaTransacao<T> = (cliente: PoolClient) => Promise<T>;

const executarEmTransacao = async <T>(
  pool: Pool,
  tenantId: string | null,
  executar: ExecutarNaTransacao<T>,
): Promise<T> => {
  const cliente = await pool.connect();

  try {
    await cliente.query('begin');

    if (tenantId !== null) {
      // `set_config(..., true)` é o `SET LOCAL`: vale só nesta transação e não
      // vaza para a próxima requisição que pegar a mesma conexão do pool.
      await cliente.query('select set_config($1, $2, true)', ['app.tenant_id', tenantId]);
    }

    const resultado = await executar(cliente);
    await cliente.query('commit');

    return resultado;
  } catch (erro) {
    await cliente.query('rollback');
    throw erro;
  } finally {
    cliente.release();
  }
};

/** Executa no escopo de um tenant. O caso de uso controla a transação. */
export const comContextoDeTenant = async <T>(
  pool: Pool,
  tenantId: string,
  executar: ExecutarNaTransacao<T>,
): Promise<T> => executarEmTransacao(pool, tenantId, executar);

/**
 * Executa sem contexto de tenant. Existe para o caminho de autenticação, que
 * precisa descobrir o tenant do usuário antes de tê-lo — e para os testes que
 * provam que, sem contexto, nada é retornado.
 */
export const semContexto = async <T>(pool: Pool, executar: ExecutarNaTransacao<T>): Promise<T> =>
  executarEmTransacao(pool, null, executar);
