/**
 * Pendência "plano de contas incompleto" (SPEC-013 §3.10): aberta enquanto a empresa não tem
 * nenhuma conta válida, resolvida pela primeira. Roda na transação do chamador — na ativação da
 * empresa (quem nasce depois da migration também recebe a pendência) e depois de cada aplicação
 * confirmada.
 *
 * A leitura das abertas é SEMPRE filtrada pela origem `PLANO_CONTAS`: sem o filtro, a reconciliação
 * resolveria por engano pendências cadastrais, documentais ou do cofre (evento append-only, sem
 * volta).
 */
import { causasDoPlanoDeContas, dataCivilEmSaoPaulo, reconciliarPendencias } from '@contaia/domain';
import { contarContasValidas, listarAbertasDaEmpresa, reconciliar } from '@contaia/db';
import type { PoolClient } from 'pg';

export const reconciliarPendenciaDoPlano = async (
  cliente: PoolClient,
  entrada: Readonly<{ tenantId: string; empresaId: string; usuarioId: string | null; agora: Date }>,
): Promise<void> => {
  const contasValidas = await contarContasValidas(cliente, entrada.empresaId);
  const causas = causasDoPlanoDeContas({
    temContaValida: contasValidas > 0,
    hoje: dataCivilEmSaoPaulo(entrada.agora),
  });
  const abertas = await listarAbertasDaEmpresa(cliente, entrada.empresaId, 'PLANO_CONTAS');
  const { paraAbrir, paraResolver } = reconciliarPendencias(causas, abertas);

  await reconciliar(cliente, entrada.tenantId, entrada.empresaId, paraAbrir, paraResolver, entrada.usuarioId);
};
