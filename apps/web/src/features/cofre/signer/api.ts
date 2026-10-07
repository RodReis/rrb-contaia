/**
 * Chamadas ao painel do Signer (SPEC-012 §5), todas pelo proxy da web. A API só consulta e
 * diagnostica: o navegador nunca recebe XML, resposta do destino, segredo nem a referência do
 * segredo (SPEC-012 §3.11).
 */
import { LIMITE_DE_EMPRESAS_POR_CONSULTA } from '@contaia/shared';
import type {
  EstadoDaEmpresaNoSigner,
  Finalidade,
  HistoricoPublicoDoSigner,
  PainelDoServicoSigner,
  RespostaDeEstados,
  ResultadoDoHistorico,
  ResultadoDoTesteManual,
} from '@contaia/shared';

import { requisitar } from '@/lib/http';

export type FiltroDoHistoricoDoSigner = Readonly<{
  /** Base 1, como `RespostaDeHistorico.pagina`. */
  pagina: number;
  finalidade: Finalidade | null;
  resultado: ResultadoDoHistorico | null;
}>;

export const consultarPainelDoSigner = (): Promise<PainelDoServicoSigner> =>
  requisitar('/signer/painel');

/** Em lote, no limite do contrato: uma página da lista do cofre cabe com folga. */
export const consultarEstadosDoSigner = (
  empresaIds: readonly string[],
): Promise<RespostaDeEstados> =>
  requisitar(
    `/signer/estados?empresaIds=${empresaIds.slice(0, LIMITE_DE_EMPRESAS_POR_CONSULTA).join(',')}`,
  );

export const consultarEstadoDaEmpresaNoSigner = (
  empresaId: string,
): Promise<EstadoDaEmpresaNoSigner> => requisitar(`/empresas/${empresaId}/signer`);

export const consultarHistoricoDoSigner = (
  empresaId: string,
  filtro: FiltroDoHistoricoDoSigner,
): Promise<HistoricoPublicoDoSigner> => {
  const busca = new URLSearchParams({ pagina: String(filtro.pagina) });

  if (filtro.finalidade !== null) {
    busca.set('finalidade', filtro.finalidade);
  }
  if (filtro.resultado !== null) {
    busca.set('resultado', filtro.resultado);
  }

  return requisitar(`/empresas/${empresaId}/signer/historico?${busca.toString()}`);
};

/** Sem finalidade, o teste cobre DF-e e eSocial; cada uma volta com o seu resultado. */
export const testarMtls = (
  empresaId: string,
  finalidade?: Finalidade,
): Promise<readonly ResultadoDoTesteManual[]> =>
  requisitar(`/empresas/${empresaId}/signer/testes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(finalidade === undefined ? {} : { finalidade }),
  });
