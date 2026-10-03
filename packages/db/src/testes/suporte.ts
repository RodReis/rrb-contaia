/**
 * Apoio das suítes de banco: executa como a aplicação, com contexto humano real.
 *
 * Todo teste que roda com a role `contaia_app` passa por aqui, para que o
 * contexto (tenant, usuário e finalidade) seja o mesmo que a API grava.
 */
import { contextoHumano, parametrosDeSessao, type FinalidadeHumana } from '@contaia/domain';
import type { Pool, PoolClient } from 'pg';

import { comContextoHumano, comFinalidade, semContexto } from '../contexto.js';
import { criarEmpresa } from '../repositorios/empresa.js';

/** Usuário que não existe no banco: serve a tabelas de gestão, que só pedem contexto humano válido. */
export const USUARIO_AVULSO = '0197a1b2-0000-7000-8000-00000000ffff';

/** `tenantId` nulo = consulta sem contexto, para as provas de I-2. */
export const comoUsuario = <T>(
  pool: Pool,
  tenantId: string | null,
  usuarioId: string,
  executar: (cliente: PoolClient) => Promise<T>,
  finalidade: FinalidadeHumana = 'COMUM',
): Promise<T> =>
  tenantId === null
    ? semContexto(pool, executar)
    : comContextoHumano(
        pool,
        { tenantId, usuarioId, finalidade, correlationId: 'teste-de-banco' },
        executar,
      );

/**
 * Cria a empresa como a API: na gestão de acesso, com o criador já na carteira,
 * e devolve ao recorte comum para o que vier depois na mesma transação.
 */
export const criarEmpresaNaCarteira = (
  cliente: PoolClient,
  tenantId: string,
  usuarioId: string,
  cnpj: string,
): Promise<string> =>
  comFinalidade(cliente, 'ADMIN_ACESSO', async () => {
    const empresaId = await criarEmpresa(cliente, tenantId, cnpj);

    await cliente.query(
      `insert into app.carteira_vinculo (tenant_id, usuario_id, empresa_id) values ($1, $2, $3)`,
      [tenantId, usuarioId, empresaId],
    );

    return empresaId;
  });

/**
 * Grava o contexto humano numa conexão que o teste controla à mão (provas de
 * concorrência, com duas transações abertas ao mesmo tempo).
 */
export const aplicarContextoDeTeste = async (
  cliente: PoolClient,
  tenantId: string,
  usuarioId: string,
  finalidade: FinalidadeHumana = 'COMUM',
): Promise<void> => {
  const contexto = contextoHumano({ tenantId, usuarioId, finalidade, correlationId: 'teste-de-banco' });

  for (const [nome, valor] of Object.entries(parametrosDeSessao(contexto))) {
    await cliente.query('select set_config($1, $2, true)', [nome, valor]);
  }
};
