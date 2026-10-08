/**
 * Contexto de acesso da transação (ARCHITECTURE.md §5.1, SPEC-010 §3, ADR-004).
 *
 * Toda leitura ou escrita do produto passa por aqui: abre transação, grava o
 * contexto validado com `set_config(..., true)` (= `SET LOCAL`) e só então
 * executa. As políticas de RLS leem esse contexto: sem ele nenhuma linha
 * protegida aparece e nenhuma escrita é aceita (I-2).
 *
 * O contexto vive só na transação. Confirmar ou reverter o elimina, então uma
 * conexão reaproveitada pelo pool nunca herda tenant, usuário, empresa ou
 * finalidade da operação anterior. Contexto incompleto ou incoerente falha aqui,
 * antes de qualquer consulta — nunca vira acesso ampliado.
 */
import {
  CODIGOS_DE_ERRO,
  ErroDeDominio,
  FINALIDADES_HUMANAS,
  contextoHumano,
  contextoTecnico,
  parametrosDeSessao,
} from '@contaia/domain';
import type {
  ContextoDeAcesso,
  EntradaDoContextoHumano,
  EntradaDoContextoTecnico,
  FinalidadeHumana,
} from '@contaia/domain';
import type { Pool, PoolClient } from 'pg';

export type ExecutarNaTransacao<T> = (cliente: PoolClient) => Promise<T>;

const gravarContexto = async (cliente: PoolClient, contexto: ContextoDeAcesso): Promise<void> => {
  const entradas = Object.entries(parametrosDeSessao(contexto));

  // Uma ida ao banco para as sete variáveis. `true` = local à transação.
  await cliente.query(
    `select ${entradas.map((_, i) => `set_config($${i * 2 + 1}, $${i * 2 + 2}, true)`).join(', ')}`,
    entradas.flat(),
  );
};

const executarEmTransacao = async <T>(
  pool: Pool,
  contexto: ContextoDeAcesso | null,
  executar: ExecutarNaTransacao<T>,
): Promise<T> => {
  const cliente = await pool.connect();

  try {
    await cliente.query('begin');

    if (contexto !== null) {
      await gravarContexto(cliente, contexto);
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

/** Executa com um contexto já validado pelo domínio (humano ou técnico). */
export const comContexto = async <T>(
  pool: Pool,
  contexto: ContextoDeAcesso,
  executar: ExecutarNaTransacao<T>,
): Promise<T> => executarEmTransacao(pool, contexto, executar);

/** Requisição humana: valida e abre a transação. `COMUM` salvo pedido do caso de uso. */
export const comContextoHumano = async <T>(
  pool: Pool,
  entrada: EntradaDoContextoHumano,
  executar: ExecutarNaTransacao<T>,
): Promise<T> => executarEmTransacao(pool, contextoHumano(entrada), executar);

/** Job técnico por empresa: valida identidade técnica, empresa e finalidade, abre transação. */
export const comContextoTecnico = async <T>(
  pool: Pool,
  entrada: EntradaDoContextoTecnico,
  executar: ExecutarNaTransacao<T>,
): Promise<T> => executarEmTransacao(pool, contextoTecnico(entrada), executar);

/**
 * Devolve a variável ao valor anterior mesmo quando o trecho falhou e o chamador segue na
 * mesma transação (savepoint). Transação já abortada não aceita comando: nesse caso o
 * ROLLBACK elimina o contexto inteiro e a falha original é a que importa.
 */
const restaurar = async (cliente: PoolClient, nome: string, valor: string): Promise<void> => {
  try {
    await cliente.query('select set_config($1, $2, true)', [nome, valor]);
  } catch {
    // transação abortada: o ROLLBACK do helper externo zera o contexto.
  }
};

const ehFinalidadeHumana = (valor: string): valor is FinalidadeHumana =>
  (FINALIDADES_HUMANAS as readonly string[]).includes(valor);

/**
 * Troca a finalidade de um trecho da MESMA transação e restaura a anterior ao
 * fim (ex.: criar a empresa e autoatribuí-la na gestão de acesso, e voltar ao
 * recorte comum). Só vale para contexto humano — job técnico não eleva finalidade.
 * Quem chama é código de caso de uso: controller e payload nunca escolhem.
 */
export const comFinalidade = async <T>(
  cliente: PoolClient,
  finalidade: FinalidadeHumana,
  executar: ExecutarNaTransacao<T>,
): Promise<T> => {
  const { rows } = await cliente.query<{ origem: string | null; finalidade: string | null }>(
    `select app.origem_atual() as origem, app.finalidade_atual() as finalidade`,
  );
  const atual = rows[0];

  if (
    atual === undefined ||
    atual.origem !== 'HUMANA' ||
    atual.finalidade === null ||
    !ehFinalidadeHumana(atual.finalidade) ||
    !ehFinalidadeHumana(finalidade)
  ) {
    throw new ErroDeDominio(
      CODIGOS_DE_ERRO.CONTEXTO_DE_ACESSO_INVALIDO,
      'Contexto de acesso inválido: só requisição humana troca de finalidade.',
    );
  }

  await cliente.query(`select set_config('app.finalidade', $1, true)`, [finalidade]);

  try {
    return await executar(cliente);
  } finally {
    await restaurar(cliente, 'app.finalidade', atual.finalidade);
  }
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/**
 * Marca a empresa que ESTA transação acabou de criar: o criador escreve nela
 * antes de existir vínculo de carteira (SPEC-009 §3.1), e só nela. A marca vale
 * até o fim do trecho e da transação; só requisição humana a usa.
 */
export const comEmpresaEmCriacao = async <T>(
  cliente: PoolClient,
  empresaId: string,
  executar: ExecutarNaTransacao<T>,
): Promise<T> => {
  const { rows } = await cliente.query<{ origem: string | null }>(
    `select app.origem_atual() as origem`,
  );

  if (rows[0]?.origem !== 'HUMANA' || !UUID.test(empresaId)) {
    throw new ErroDeDominio(
      CODIGOS_DE_ERRO.CONTEXTO_DE_ACESSO_INVALIDO,
      'Contexto de acesso inválido: a empresa em criação exige requisição humana e id válido.',
    );
  }

  await cliente.query(`select set_config('app.empresa_em_criacao', $1, true)`, [empresaId]);

  try {
    return await executar(cliente);
  } finally {
    await restaurar(cliente, 'app.empresa_em_criacao', '');
  }
};

/**
 * Executa sem contexto. Existe para o caminho de autenticação, que precisa
 * descobrir o tenant do usuário antes de tê-lo (funções SECURITY DEFINER) — e
 * para os testes que provam que, sem contexto, nada é retornado.
 */
export const semContexto = async <T>(pool: Pool, executar: ExecutarNaTransacao<T>): Promise<T> =>
  executarEmTransacao(pool, null, executar);
