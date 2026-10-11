/**
 * Pendência "empregados não importados" (SPEC-014 §3.10): aberta enquanto a empresa não tem nenhum
 * empregado confirmado, resolvida pelo primeiro. Roda na transação do chamador — na ativação da
 * empresa e depois de cada aplicação confirmada (o backfill das existentes é da migration 0017).
 *
 * A leitura das abertas é SEMPRE filtrada pela origem `EMPREGADOS`: sem o filtro, a reconciliação
 * resolveria por engano pendências de outras origens (evento append-only, sem volta).
 */
import { causasDeEmpregados, reconciliarPendencias } from '@contaia/domain';
import { contarEmpregadosConfirmados, listarAbertasDaEmpresa, reconciliar } from '@contaia/db';
import type { PoolClient } from 'pg';

export const reconciliarPendenciaDosEmpregados = async (
  cliente: PoolClient,
  entrada: Readonly<{ tenantId: string; empresaId: string; usuarioId: string | null; agora: Date }>,
): Promise<void> => {
  const causas = causasDeEmpregados(await contarEmpregadosConfirmados(cliente, entrada.empresaId));
  const abertas = await listarAbertasDaEmpresa(cliente, entrada.empresaId, 'EMPREGADOS');
  const { paraAbrir, paraResolver } = reconciliarPendencias(causas, abertas);

  await reconciliar(cliente, entrada.tenantId, entrada.empresaId, paraAbrir, paraResolver, entrada.usuarioId);
};
