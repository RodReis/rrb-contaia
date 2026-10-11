import { pendenciasDoMapeamento, type PendenciaDoMapeamentoDe } from '../plano-contas/csv.js';
import { CAMPOS_DE_EMPREGADO, type CampoDeEmpregado, type MapeamentoDeEmpregados } from './campos.js';

export type PendenciaDoMapeamentoDeEmpregados = PendenciaDoMapeamentoDe<CampoDeEmpregado>;

export type ResultadoDoMapeamentoDeEmpregados =
  | Readonly<{ ok: true; mapeamento: MapeamentoDeEmpregados }>
  | Readonly<{ ok: false; pendencias: readonly PendenciaDoMapeamentoDeEmpregados[] }>;

/**
 * Confere um mapeamento vindo de fora (`unknown`) contra o cabeçalho do arquivo: os cinco campos
 * precisam apontar para colunas existentes e uma coluna não alimenta dois campos. Quando passa,
 * devolve o mapeamento canônico (nomes de coluna aparados).
 */
export const validarMapeamentoDeEmpregados = (
  mapeamento: unknown,
  cabecalho: readonly string[],
): ResultadoDoMapeamentoDeEmpregados => {
  const origem: Readonly<Record<string, unknown>> =
    typeof mapeamento === 'object' && mapeamento !== null ? (mapeamento as Record<string, unknown>) : {};
  const pendencias = pendenciasDoMapeamento(CAMPOS_DE_EMPREGADO, cabecalho, origem);

  if (pendencias.length > 0) {
    return { ok: false, pendencias };
  }

  return {
    ok: true,
    mapeamento: Object.fromEntries(
      CAMPOS_DE_EMPREGADO.map((campo) => [campo, String(origem[campo]).trim()]),
    ) as MapeamentoDeEmpregados,
  };
};
